import { useEffect, useId, useRef, useState } from "react";

import type {
  DashboardGame,
  DashboardGameStatus,
  DashboardLibrary,
} from "../../src/dashboard/contracts.js";
import {
  clearLibraryFilters,
  formatPlaytime,
  LIBRARY_ACCESS_FILTER_OPTIONS,
  type LibraryFilters,
} from "./library-filters.js";

export function LibraryPanel({
  library,
  games,
  filters,
  isLoading,
  error,
  onFiltersChange,
  onRetryLoad,
  onOpen,
}: Readonly<{
  library: DashboardLibrary | undefined;
  games: readonly DashboardGame[];
  filters: LibraryFilters;
  isLoading: boolean;
  error: string | undefined;
  onFiltersChange: (filters: LibraryFilters) => void;
  onRetryLoad: () => void;
  onOpen: (game: DashboardGame, opener: HTMLButtonElement) => void;
}>) {
  return (
    <section className="library-panel" aria-labelledby="library-heading">
      <div className="library-panel-heading">
        <div>
          <p className="eyebrow">Colección</p>
          <h2 id="library-heading">Juegos</h2>
        </div>
        {library !== undefined && <p className="result-count">{games.length} mostrados</p>}
      </div>
      <LibraryToolbar filters={filters} onChange={onFiltersChange} />

      {isLoading && (
        <p className="loading-state" role="status" aria-label="Cargando biblioteca">
          Cargando biblioteca…
        </p>
      )}
      {error !== undefined && (
        <section className="empty-state" role="alert">
          <h2>No se pudo cargar tu biblioteca</h2>
          <p>{error}</p>
          <button type="button" onClick={onRetryLoad}>
            Reintentar carga de la biblioteca
          </button>
        </section>
      )}
      {!isLoading && error === undefined && library !== undefined && games.length === 0 && (
        <section className="empty-state" aria-live="polite">
          <h2>Ningún juego coincide con estos filtros</h2>
          <p>Limpia los filtros para volver a ver toda tu colección.</p>
          <button type="button" onClick={() => onFiltersChange(clearLibraryFilters())}>
            Limpiar filtros
          </button>
        </section>
      )}
      {!isLoading && error === undefined && games.length > 0 && (
        <div className="game-grid" aria-live="polite">
          {games.map((game) => (
            <GameCard key={game.appId} game={game} onOpen={onOpen} />
          ))}
        </div>
      )}
    </section>
  );
}

export function LibrarySummary({ library }: Readonly<{ library: DashboardLibrary }>) {
  return (
    <section className="summary-grid" aria-label="Totales de la biblioteca">
      <SummaryCard label="Juegos" value={String(library.totals.totalGames)} />
      <SummaryCard label="Jugados" value={String(library.totals.playedGames)} />
      <SummaryCard label="Sin jugar" value={String(library.totals.unplayedGames)} />
      <SummaryCard
        label="Tiempo invertido"
        value={formatPlaytime(library.totals.totalPlaytimeMinutes)}
      />
    </section>
  );
}

function SummaryCard({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="summary-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function LibraryToolbar({
  filters,
  onChange,
}: Readonly<{ filters: LibraryFilters; onChange: (filters: LibraryFilters) => void }>) {
  return (
    <form
      className="library-toolbar"
      onSubmit={(event) => event.preventDefault()}
      aria-label="Filtros de la biblioteca"
    >
      <label className="search-field">
        <span>Buscar juegos</span>
        <input
          type="search"
          value={filters.query}
          onChange={(event) => onChange({ ...filters, query: event.target.value })}
          placeholder="Buscar por título"
        />
      </label>
      <FilterSelect
        label="Estado"
        value={filters.status}
        onChange={(status) => onChange({ ...filters, status: status as LibraryFilters["status"] })}
        options={["all", "backlog", "playing", "completed", "paused", "dropped"]}
      />
      <FilterSelect
        label="Acceso"
        value={filters.accessType}
        onChange={(accessType) =>
          onChange({ ...filters, accessType: accessType as LibraryFilters["accessType"] })
        }
        options={LIBRARY_ACCESS_FILTER_OPTIONS}
      />
      <FilterSelect
        label="Historial de juego"
        value={filters.played}
        onChange={(played) => onChange({ ...filters, played: played as LibraryFilters["played"] })}
        options={["all", "played", "unplayed"]}
      />
      <button className="text-button" type="button" onClick={() => onChange(clearLibraryFilters())}>
        Restablecer
      </button>
    </form>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: Readonly<{
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}>) {
  const [isOpen, setIsOpen] = useState(false);
  const selectedIndex = Math.max(options.indexOf(value), 0);
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

  const choose = (option: string) => {
    onChange(option);
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
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (isOpen) choose(options[activeIndex] ?? value);
      else open();
    }
  };

  return (
    <div className="select-field" ref={rootRef}>
      <span id={labelId}>{label}</span>
      <button
        ref={buttonRef}
        className="filter-trigger"
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
        <span>{formatLabel(value)}</span>
        <span className="filter-trigger-chevron" aria-hidden="true" />
      </button>
      {isOpen && (
        <ul className="filter-menu" id={listboxId} role="listbox" aria-labelledby={labelId}>
          {options.map((option, index) => (
            <li key={option} role="none">
              <button
                id={`${listboxId}-option-${index}`}
                className={`filter-option${index === activeIndex ? " filter-option-active" : ""}`}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={option === value}
                onMouseMove={() => setActiveIndex(index)}
                onClick={() => choose(option)}
              >
                {formatLabel(option)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
function GameCard({
  game,
  onOpen,
}: Readonly<{
  game: DashboardGame;
  onOpen: (game: DashboardGame, opener: HTMLButtonElement) => void;
}>) {
  return (
    <article className="game-card" aria-label={game.name}>
      <button
        type="button"
        className="game-card-button"
        onClick={(event) => onOpen(game, event.currentTarget)}
        aria-label={`Ver detalles de ${game.name}`}
      >
        <CoverImage game={game} />
        <span className="cover-status">
          <StatusPill status={game.status} />
        </span>
        <span className="game-card-content">
          <strong className="game-card-title">{game.name}</strong>
          <span className="game-card-meta">
            {formatPlaytime(game.playtimeMinutes)} jugado · {formatLabel(game.accessType)}
          </span>
        </span>
      </button>
    </article>
  );
}

export function CoverImage({ game }: Readonly<{ game: DashboardGame }>) {
  const [failedSourceCount, setFailedSourceCount] = useState(0);
  const [isLandscape, setIsLandscape] = useState(false);
  const coverUrls = [game.coverUrl, officialSteamIconUrl(game.appId)].filter(
    (url, index, urls) => urls.indexOf(url) === index,
  );
  const coverUrl = coverUrls[failedSourceCount];

  if (coverUrl === undefined) {
    return (
      <div
        className="cover-frame cover-fallback"
        role="img"
        aria-label={`Portada no disponible para ${game.name}`}
        style={{ backgroundImage: coverGradient(game.appId) }}
      >
        <span className="cover-fallback-title" aria-hidden="true">
          {game.name}
        </span>
      </div>
    );
  }
  const image = (
    <img
      className={`cover-image${isLandscape ? " cover-landscape" : ""}`}
      src={coverUrl}
      alt={`Portada de ${game.name}`}
      onError={() => setFailedSourceCount((count) => count + 1)}
      onLoad={(event) =>
        setIsLandscape(event.currentTarget.naturalWidth > event.currentTarget.naturalHeight)
      }
    />
  );
  return <span className="cover-frame">{image}</span>;
}

function officialSteamIconUrl(appId: number): string {
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/icon.jpg`;
}

function StatusPill({ status }: Readonly<{ status: DashboardGameStatus }>) {
  return <span className={`status-pill status-${status}`}>{formatLabel(status)}</span>;
}

export function formatLabel(value: string): string {
  return (
    {
      all: "Todos",
      backlog: "Pendiente",
      playing: "Jugando",
      completed: "Completado",
      dropped: "Abandonado",
      paused: "Pausado",
      owned: "Propio",
      family: "Familia",
      manual: "Manual",
      played: "Jugados",
      unplayed: "Sin jugar",
    }[value] ?? value
  );
}

function coverGradient(appId: number): string {
  const hue = Math.abs(appId * 47) % 360;
  return `linear-gradient(145deg, hsl(${hue} 46% 30%), hsl(${(hue + 64) % 360} 52% 11%))`;
}
