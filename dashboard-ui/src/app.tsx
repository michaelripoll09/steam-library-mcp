import { useEffect, useRef, useState } from "react";

import type {
  DashboardGame,
  DashboardGameStatus,
  DashboardLibrary,
  DashboardMutableStatus,
} from "../../src/dashboard/contracts.js";
import { createDashboardApi, type DashboardApi } from "./api.js";
import {
  clearLibraryFilters,
  createLibraryFilters,
  filterLibraryGames,
  formatPlaytime,
  type LibraryFilters,
} from "./library-filters.js";

const MUTABLE_STATUSES: readonly DashboardMutableStatus[] = ["playing", "completed", "dropped"];

type DashboardAppProps = Readonly<{ api?: DashboardApi }>;

export function DashboardApp({ api: suppliedApi }: DashboardAppProps) {
  const defaultApiRef = useRef<DashboardApi | undefined>(undefined);
  const api =
    suppliedApi ?? (defaultApiRef.current ??= createDashboardApi(window.fetch.bind(window)));
  const [library, setLibrary] = useState<DashboardLibrary | undefined>();
  const [filters, setFilters] = useState<LibraryFilters>(createLibraryFilters);
  const [initialError, setInitialError] = useState<string | undefined>();
  const [syncError, setSyncError] = useState<string | undefined>();
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [selectedGame, setSelectedGame] = useState<DashboardGame | undefined>();
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | undefined>();
  const [statusError, setStatusError] = useState<string | undefined>();
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  const loadLibrary = async () => {
    setIsLoading(true);
    setInitialError(undefined);
    try {
      setLibrary(await api.getLibrary());
    } catch (error) {
      setInitialError(errorMessage(error));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadLibrary();
  }, [api]);

  useEffect(() => {
    if (selectedGame !== undefined) closeButtonRef.current?.focus();
  }, [selectedGame]);

  const openGame = (game: DashboardGame, opener: HTMLButtonElement) => {
    openerRef.current = opener;
    setStatusError(undefined);
    setStatusMessage(undefined);
    setSelectedGame(game);
  };

  const closeGame = () => {
    setSelectedGame(undefined);
    openerRef.current?.focus();
  };

  const syncLibrary = async () => {
    setIsSyncing(true);
    setSyncError(undefined);
    try {
      setLibrary(await api.syncLibrary());
    } catch (error) {
      setSyncError(errorMessage(error));
    } finally {
      setIsSyncing(false);
    }
  };

  const updateStatus = async (status: DashboardMutableStatus) => {
    if (selectedGame === undefined) return;
    setIsUpdatingStatus(true);
    setStatusError(undefined);
    setStatusMessage(undefined);
    try {
      const update = await api.updateGameStatus(selectedGame.appId, status);
      setLibrary(update.library);
      setSelectedGame(update.library.games.find((game) => game.appId === selectedGame.appId));
      setStatusMessage("Estado guardado.");
    } catch (error) {
      setStatusError(errorMessage(error));
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const games = library === undefined ? [] : filterLibraryGames(library.games, filters);

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Archivo personal de juegos</p>
          <h1>Tu biblioteca de Steam</h1>
          <p className="subtitle">Una vista enfocada de qué jugar después y qué ya importa.</p>
        </div>
        <button
          className="sync-button"
          type="button"
          onClick={() => void syncLibrary()}
          disabled={isSyncing}
        >
          {isSyncing ? "Sincronizando biblioteca…" : "Sincronizar biblioteca"}
        </button>
      </header>

      {syncError !== undefined && (
        <section className="notice notice-error" role="alert">
          <p>{syncError}</p>
          <button type="button" onClick={() => void syncLibrary()} disabled={isSyncing}>
            Reintentar sincronización
          </button>
        </section>
      )}

      {library !== undefined && <LibrarySummary library={library} />}

      <section className="library-panel" aria-labelledby="library-heading">
        <div className="library-panel-heading">
          <div>
            <p className="eyebrow">Colección</p>
            <h2 id="library-heading">Juegos</h2>
          </div>
          {library !== undefined && <p className="result-count">{games.length} mostrados</p>}
        </div>
        <LibraryToolbar filters={filters} onChange={setFilters} />

        {isLoading && (
          <p className="loading-state" role="status" aria-label="Cargando biblioteca">
            Cargando biblioteca…
          </p>
        )}
        {initialError !== undefined && (
          <section className="empty-state" role="alert">
            <h2>No se pudo cargar tu biblioteca</h2>
            <p>{initialError}</p>
            <button type="button" onClick={() => void loadLibrary()}>
              Reintentar carga de la biblioteca
            </button>
          </section>
        )}
        {!isLoading &&
          initialError === undefined &&
          library !== undefined &&
          games.length === 0 && (
            <section className="empty-state" aria-live="polite">
              <h2>Ningún juego coincide con estos filtros</h2>
              <p>Limpia los filtros para volver a ver toda tu colección.</p>
              <button type="button" onClick={() => setFilters(clearLibraryFilters())}>
                Limpiar filtros
              </button>
            </section>
          )}
        {!isLoading && initialError === undefined && games.length > 0 && (
          <div className="game-grid" aria-live="polite">
            {games.map((game) => (
              <GameCard key={game.appId} game={game} onOpen={openGame} />
            ))}
          </div>
        )}
      </section>

      {selectedGame !== undefined && (
        <GameDetails
          game={selectedGame}
          closeButtonRef={closeButtonRef}
          isUpdatingStatus={isUpdatingStatus}
          statusError={statusError}
          statusMessage={statusMessage}
          onClose={closeGame}
          onStatusChange={updateStatus}
        />
      )}
    </main>
  );
}

function LibrarySummary({ library }: Readonly<{ library: DashboardLibrary }>) {
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
        options={["all", "owned", "family_shared"]}
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
  return (
    <label className="select-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option} value={option}>
            {formatLabel(option)}
          </option>
        ))}
      </select>
    </label>
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
        <span className="game-card-content">
          <span className="game-card-title-row">
            <strong>{game.name}</strong>
            <StatusPill status={game.status} />
          </span>
          <span className="game-card-meta">
            {formatPlaytime(game.playtimeMinutes)} jugado ·{" "}
            {game.accessType === "owned" ? "Propio" : "Compartido en familia"}
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
        className="cover-image cover-fallback"
        role="img"
        aria-label={`Portada no disponible para ${game.name}`}
        style={{ backgroundImage: coverGradient(game.appId) }}
      />
    );
  }
  return (
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
}

function officialSteamIconUrl(appId: number): string {
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/icon.jpg`;
}

function GameDetails({
  game,
  closeButtonRef,
  isUpdatingStatus,
  statusError,
  statusMessage,
  onClose,
  onStatusChange,
}: Readonly<{
  game: DashboardGame;
  closeButtonRef: React.RefObject<HTMLButtonElement | null>;
  isUpdatingStatus: boolean;
  statusError: string | undefined;
  statusMessage: string | undefined;
  onClose: () => void;
  onStatusChange: (status: DashboardMutableStatus) => Promise<void>;
}>) {
  const dialogRef = useRef<HTMLElement | null>(null);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;

    const focusableElements = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (focusableElements === undefined || focusableElements.length === 0) return;

    const first = focusableElements[0];
    const last = focusableElements[focusableElements.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className="game-details"
        role="dialog"
        aria-modal="true"
        aria-label={`Detalles de ${game.name}`}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <button
          ref={closeButtonRef}
          className="dialog-close"
          type="button"
          onClick={onClose}
          aria-label="Cerrar detalles"
        >
          ×
        </button>
        <CoverImage game={game} />
        <div className="details-copy">
          <p className="eyebrow">
            {game.accessType === "owned" ? "Juego propio" : "Compartido en familia"}
          </p>
          <h2 id="game-details-title">{game.name}</h2>
          <p>{formatPlaytime(game.playtimeMinutes)} jugado</p>
          {game.lastPlayedAt !== undefined && (
            <p>Última vez jugado: {formatLastPlayed(game.lastPlayedAt)}</p>
          )}
          <p>{game.isPlayable ? "Listo para jugar" : "No se puede jugar actualmente"}</p>
          <label className="status-control">
            <span>Estado</span>
            <select
              value={game.status}
              disabled={isUpdatingStatus}
              aria-busy={isUpdatingStatus}
              onChange={(event) =>
                void onStatusChange(event.target.value as DashboardMutableStatus)
              }
            >
              {!MUTABLE_STATUSES.includes(game.status as DashboardMutableStatus) && (
                <option value={game.status} disabled>
                  {formatLabel(game.status)}
                </option>
              )}
              {MUTABLE_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {formatLabel(status)}
                </option>
              ))}
            </select>
          </label>
          <div className="dialog-live-region" aria-live="polite">
            {isUpdatingStatus && "Guardando estado…"}
            {statusMessage}
          </div>
          {statusError !== undefined && (
            <p className="status-error" role="alert">
              {statusError}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

function StatusPill({ status }: Readonly<{ status: DashboardGameStatus }>) {
  return <span className={`status-pill status-${status}`}>{formatLabel(status)}</span>;
}

function formatLabel(value: string): string {
  return (
    {
      all: "Todos",
      backlog: "Pendiente",
      playing: "Jugando",
      completed: "Completado",
      dropped: "Abandonado",
      paused: "En pausa",
      owned: "Propio",
      family_shared: "Compartido en familia",
      played: "Jugados",
      unplayed: "Sin jugar",
    }[value] ?? value
  );
}

function formatLastPlayed(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "en una fecha desconocida";
  return new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeZone: "UTC" }).format(date);
}

function coverGradient(appId: number): string {
  const hue = Math.abs(appId * 47) % 360;
  return `linear-gradient(145deg, hsl(${hue} 46% 30%), hsl(${(hue + 64) % 360} 52% 11%))`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message !== ""
    ? error.message
    : "Algo salió mal. Inténtalo de nuevo.";
}
