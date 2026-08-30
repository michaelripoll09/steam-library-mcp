import { useEffect, useId, useRef, useState } from "react";

export type CustomSelectOption<Value extends string> = Readonly<{
  value: Value;
  label: string;
}>;

export function CustomSelect<Value extends string>({
  label,
  value,
  options,
  onChange,
}: Readonly<{
  label: string;
  value: Value;
  options: readonly CustomSelectOption<Value>[];
  onChange: (value: Value) => void;
}>) {
  const [isOpen, setIsOpen] = useState(false);
  const selectedIndex = Math.max(
    options.findIndex((option) => option.value === value),
    0,
  );
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const labelId = useId();
  const listboxId = useId();

  useEffect(() => {
    if (!isOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target))
        setIsOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [isOpen]);

  const open = (index = selectedIndex) => {
    setActiveIndex(index);
    setIsOpen(true);
  };

  const choose = (nextValue: Value) => {
    onChange(nextValue);
    setIsOpen(false);
    buttonRef.current?.focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Escape") {
      setIsOpen(false);
      return;
    }
    if (event.key === "Tab") {
      setIsOpen(false);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const nextIndex = Math.max(
        0,
        Math.min(
          options.length - 1,
          (isOpen ? activeIndex : selectedIndex) + (event.key === "ArrowDown" ? 1 : -1),
        ),
      );
      open(nextIndex);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      open(event.key === "Home" ? 0 : options.length - 1);
      return;
    }
    if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      if (isOpen) choose(options[activeIndex]?.value ?? value);
      else open();
    }
  };

  const selectedOption = options[selectedIndex];

  return (
    <div className="intelligence-select" ref={rootRef}>
      <span className="intelligence-select-label" id={labelId}>
        {label}
      </span>
      <button
        ref={buttonRef}
        className="intelligence-select-trigger"
        type="button"
        role="combobox"
        aria-labelledby={labelId}
        aria-controls={listboxId}
        aria-activedescendant={isOpen ? `${listboxId}-option-${activeIndex}` : undefined}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        onClick={() => (isOpen ? setIsOpen(false) : open())}
        onKeyDown={handleKeyDown}
      >
        <span>{selectedOption?.label}</span>
        <span className="intelligence-select-chevron" aria-hidden="true" />
      </button>
      {isOpen && (
        <ul
          className="intelligence-select-menu"
          id={listboxId}
          role="listbox"
          aria-labelledby={labelId}
        >
          {options.map((option, index) => (
            <li key={option.value} role="none">
              <button
                id={`${listboxId}-option-${index}`}
                className={`intelligence-select-option${index === activeIndex ? " intelligence-select-option-active" : ""}`}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={option.value === value}
                onMouseMove={() => setActiveIndex(index)}
                onClick={() => choose(option.value)}
              >
                {option.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
