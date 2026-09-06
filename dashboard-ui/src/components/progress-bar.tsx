export function ProgressBar({
  value,
  max,
  label,
}: Readonly<{
  value: number;
  max: number;
  label: string;
}>) {
  const normalizedMax = Math.max(0, max);
  const normalizedValue = Math.min(normalizedMax, Math.max(0, value));
  const percentage = normalizedMax === 0 ? 0 : Math.round((normalizedValue / normalizedMax) * 100);
  return (
    <div
      className="progress-bar"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={normalizedMax}
      aria-valuenow={normalizedValue}
    >
      <span className="progress-bar-track" aria-hidden="true">
        <span className="progress-bar-value" style={{ width: `${percentage}%` }} />
      </span>
      <span>
        {value} de {max} completados
      </span>
    </div>
  );
}
