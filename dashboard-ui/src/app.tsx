import { useEffect, useId, useRef, useState } from "react";

import type {
  DashboardGame,
  DashboardGameStatus,
  DashboardLibrary,
  DashboardMutableStatus,
} from "../../src/dashboard/contracts.js";
import type { LocalTask } from "../../src/tasks/task-runner.js";
import { createDashboardApi, type DashboardApi } from "./api.js";
import type { ManualLibraryGame } from "../../src/manual-library/manual-library.js";
import { IntelligencePanel } from "./intelligence-panel.js";
import {
  clearLibraryFilters,
  createLibraryFilters,
  filterLibraryGames,
  formatPlaytime,
  LIBRARY_ACCESS_FILTER_OPTIONS,
  type LibraryFilters,
} from "./library-filters.js";

const MUTABLE_STATUSES: readonly DashboardMutableStatus[] = [
  "playing",
  "paused",
  "completed",
  "dropped",
];

type DashboardAppProps = Readonly<{ api?: DashboardApi }>;

export function DashboardApp({ api: suppliedApi }: DashboardAppProps) {
  const defaultApiRef = useRef<DashboardApi | undefined>(undefined);
  const api =
    suppliedApi ?? (defaultApiRef.current ??= createDashboardApi(window.fetch.bind(window)));
  const intelligenceApi = isIntelligenceApi(api);
  const taskApi = isTaskApi(api);
  const manualCollectionApi = isManualCollectionApi(api);
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
  const [manualCollection, setManualCollection] = useState<readonly ManualLibraryGame[]>([]);
  const [manualSteam, setManualSteam] = useState("");
  const [manualError, setManualError] = useState<string | undefined>();
  const [isSavingManual, setIsSavingManual] = useState(false);
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
    if (!manualCollectionApi) return;
    void api.getManualCollection().then(setManualCollection, () => setManualCollection([]));
  }, [api, manualCollectionApi]);

  const addManual = async () => {
    if (!manualCollectionApi) return;
    setIsSavingManual(true);
    setManualError(undefined);
    try {
      await api.addManualCollection(manualSteam);
      setManualSteam("");
      setManualCollection(await api.getManualCollection());
      setLibrary(await api.getLibrary());
    } catch (error) {
      setManualError(errorMessage(error));
    } finally {
      setIsSavingManual(false);
    }
  };
  const updateManual = async (
    appId: number,
    patch: { accessType?: "manual" | "family"; isPlayable?: boolean },
  ) => {
    if (!manualCollectionApi) return;
    setManualError(undefined);
    try {
      const updated = await api.updateManualCollection(appId, patch);
      setManualCollection((collection) =>
        collection.map((game) => (game.appId === appId ? updated : game)),
      );
      setLibrary(await api.getLibrary());
    } catch (error) {
      setManualError(errorMessage(error));
    }
  };
  const removeManual = async (appId: number) => {
    if (!manualCollectionApi) return;
    setManualError(undefined);
    try {
      await api.removeManualCollection(appId);
      setManualCollection(await api.getManualCollection());
      setLibrary(await api.getLibrary());
    } catch (error) {
      setManualError(errorMessage(error));
    }
  };

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

      {manualCollectionApi && (
        <ManualCollectionPanel
          collection={manualCollection}
          steam={manualSteam}
          error={manualError}
          saving={isSavingManual}
          onSteamChange={setManualSteam}
          onAdd={() => void addManual()}
          onUpdate={(appId, patch) => void updateManual(appId, patch)}
          onRemove={(appId) => void removeManual(appId)}
        />
      )}

      {syncError !== undefined && (
        <section className="notice notice-error" role="alert">
          <p>{syncError}</p>
          <button type="button" onClick={() => void syncLibrary()} disabled={isSyncing}>
            Reintentar sincronización
          </button>
        </section>
      )}

      {library !== undefined && <LibrarySummary library={library} />}
      {taskApi && <TaskPanel api={api} />}
      {library !== undefined && intelligenceApi && (
        <IntelligencePanel api={api} games={library.games} />
      )}

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

function TaskPanel({
  api,
}: Readonly<{
  api: DashboardApi & Required<Pick<DashboardApi, "getTasks" | "getTask" | "cancelTask">>;
}>) {
  const [tasks, setTasks] = useState<readonly LocalTask[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [cancellingTaskId, setCancellingTaskId] = useState<string | undefined>();
  const tasksRef = useRef(tasks);
  const taskRequestVersions = useRef(new Map<string, number>());
  const taskListRequestGeneration = useRef(0);
  const cancellingTaskIds = useRef(new Set<string>());
  tasksRef.current = tasks;

  const nextTaskRequestVersion = (id: string): number => {
    const version = (taskRequestVersions.current.get(id) ?? 0) + 1;
    taskRequestVersions.current.set(id, version);
    return version;
  };

  const applyTaskIfCurrent = (task: LocalTask, version: number) => {
    setTasks((current) => {
      if (taskRequestVersions.current.get(task.id) !== version) return current;
      return current.map((entry) => (entry.id === task.id ? task : entry));
    });
  };

  const loadTasks = async () => {
    const generation = taskListRequestGeneration.current + 1;
    taskListRequestGeneration.current = generation;
    const taskVersions = new Map(
      tasksRef.current.map((task) => [task.id, nextTaskRequestVersion(task.id)]),
    );
    try {
      const result = await api.getTasks();
      if (taskListRequestGeneration.current !== generation) return;
      if (Array.isArray(result)) {
        setTasks((current) =>
          reconcileTaskList(current, result, taskVersions, taskRequestVersions.current),
        );
      }
      setError(undefined);
    } catch (loadError) {
      if (taskListRequestGeneration.current === generation) setError(errorMessage(loadError));
    }
  };

  useEffect(() => {
    void loadTasks();
  }, [api]);

  useEffect(() => {
    if (!tasks.some(isActiveTask)) return;
    const poll = async () => {
      const activeTaskIds = tasksRef.current
        .filter((task) => isActiveTask(task) && !cancellingTaskIds.current.has(task.id))
        .map((task) => task.id);
      if (activeTaskIds.length === 0) return;
      try {
        const updates = await Promise.all(
          activeTaskIds.map((id) => {
            const version = nextTaskRequestVersion(id);
            return api.getTask(id).then((task) => ({ task, version }));
          }),
        );
        for (const update of updates) applyTaskIfCurrent(update.task, update.version);
        setError(undefined);
      } catch (pollError) {
        setError(errorMessage(pollError));
      }
    };
    const interval = window.setInterval(() => void poll(), 2_000);
    return () => window.clearInterval(interval);
  }, [api, tasks]);

  const cancelTask = async (id: string) => {
    setCancellingTaskId(id);
    cancellingTaskIds.current.add(id);
    nextTaskRequestVersion(id);
    try {
      const task = await api.cancelTask(id);
      applyTaskIfCurrent(task, nextTaskRequestVersion(id));
      setError(undefined);
    } catch (cancelError) {
      setError(errorMessage(cancelError));
    } finally {
      cancellingTaskIds.current.delete(id);
      setCancellingTaskId(undefined);
    }
  };

  return (
    <section className="intelligence-panel" aria-labelledby="tasks-heading">
      <div className="library-panel-heading">
        <div>
          <p className="eyebrow">Procesos locales</p>
          <h2 id="tasks-heading">Tareas locales</h2>
        </div>
        <button className="text-button" type="button" onClick={() => void loadTasks()}>
          Actualizar
        </button>
      </div>
      {error !== undefined && <p role="alert">{error}</p>}
      {tasks.length === 0 ? (
        <p>No hay tareas locales.</p>
      ) : (
        <ul className="task-list" aria-live="polite">
          {tasks.map((task) => (
            <li key={task.id}>
              <strong>{formatTaskType(task.type)}</strong>
              <span>{formatTaskState(task.state)}</span>
              <span>{formatTaskProgress(task)}</span>
              {isActiveTask(task) && (
                <button
                  type="button"
                  onClick={() => void cancelTask(task.id)}
                  disabled={cancellingTaskId === task.id}
                >
                  {cancellingTaskId === task.id ? "Cancelando…" : "Cancelar tarea"}
                </button>
              )}
              {task.error !== null && <span role="alert">{task.error.message}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function reconcileTaskList(
  current: readonly LocalTask[],
  incoming: readonly LocalTask[],
  taskVersions: ReadonlyMap<string, number>,
  currentVersions: ReadonlyMap<string, number>,
): readonly LocalTask[] {
  const currentById = new Map(current.map((task) => [task.id, task]));
  const tasks = incoming.map((task) => {
    const requestVersion = taskVersions.get(task.id);
    return requestVersion !== undefined && currentVersions.get(task.id) !== requestVersion
      ? (currentById.get(task.id) ?? task)
      : task;
  });
  const knownTaskIds = new Set(tasks.map((task) => task.id));
  for (const task of current) {
    const requestVersion = taskVersions.get(task.id);
    if (
      requestVersion !== undefined &&
      currentVersions.get(task.id) !== requestVersion &&
      !knownTaskIds.has(task.id)
    ) {
      tasks.push(task);
    }
  }
  return tasks;
}

function isActiveTask(task: LocalTask): boolean {
  return task.state === "queued" || task.state === "running";
}

function formatTaskType(type: LocalTask["type"]): string {
  return (
    {
      sync_library: "Sincronizando biblioteca",
      enrich_durations: "Actualizando duraciones",
      recalculate_plan: "Recalculando plan",
    }[type] ?? type
  );
}

function formatTaskState(state: LocalTask["state"]): string {
  return (
    {
      queued: "En cola",
      running: "En ejecución",
      completed: "Completada",
      failed: "Fallida",
      cancelled: "Cancelada",
    }[state] ?? state
  );
}

function formatTaskProgress(task: LocalTask): string {
  return task.progress.total === null
    ? `${task.progress.completed} completadas`
    : `${task.progress.completed} de ${task.progress.total}`;
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

function ManualCollectionPanel({
  collection,
  steam,
  error,
  saving,
  onSteamChange,
  onAdd,
  onUpdate,
  onRemove,
}: Readonly<{
  collection: readonly ManualLibraryGame[];
  steam: string;
  error: string | undefined;
  saving: boolean;
  onSteamChange: (value: string) => void;
  onAdd: () => void;
  onUpdate: (
    appId: number,
    patch: { accessType?: "manual" | "family"; isPlayable?: boolean },
  ) => void;
  onRemove: (appId: number) => void;
}>) {
  return (
    <section className="manual-collection-panel" aria-labelledby="manual-collection-heading">
      <div>
        <p className="eyebrow">Colección manual</p>
        <h2 id="manual-collection-heading">Juegos agregados manualmente</h2>
        <p>Esta lista no confirma que Steam te dé acceso ni que el juego esté disponible ahora.</p>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onAdd();
        }}
      >
        <label htmlFor="manual-steam-input">URL de Steam o AppID</label>
        <div className="manual-collection-form">
          <input
            id="manual-steam-input"
            value={steam}
            onChange={(event) => onSteamChange(event.target.value)}
            placeholder="https://store.steampowered.com/app/…"
            aria-describedby={error === undefined ? undefined : "manual-collection-error"}
          />
          <button type="submit" disabled={saving}>
            {saving ? "Agregando…" : "Agregar"}
          </button>
        </div>
      </form>
      {error !== undefined && (
        <p id="manual-collection-error" className="status-error" role="alert">
          {error}
        </p>
      )}
      {collection.length > 0 && (
        <ul className="manual-collection-list">
          {collection.map((game) => (
            <li key={game.appId}>
              <span>
                {game.name} <small>· AppID {game.appId}</small>
              </span>
              <label>
                Acceso de {game.name}
                <select
                  value={game.accessType}
                  onChange={(event) =>
                    onUpdate(game.appId, {
                      accessType: event.target.value as "manual" | "family",
                    })
                  }
                >
                  <option value="manual">Manual</option>
                  <option value="family">Familia</option>
                </select>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={game.isPlayable}
                  onChange={(event) => onUpdate(game.appId, { isPlayable: event.target.checked })}
                />
                Disponible para jugar: {game.name}
              </label>
              <span>{game.isPlayable ? "Listo para jugar" : "No disponible para jugar"}</span>
              <button
                type="button"
                onClick={() => onRemove(game.appId)}
                aria-label={`Quitar ${game.name}`}
              >
                Quitar
              </button>
            </li>
          ))}
        </ul>
      )}
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
          <p className="eyebrow">{`Juego ${formatLabel(game.accessType).toLowerCase()}`}</p>
          <h2 id="game-details-title">{game.name}</h2>
          <p>{formatPlaytime(game.playtimeMinutes)} jugado</p>
          {game.manualCollection && (
            <p className="manual-game-notice">
              Administrado manualmente: no confirma acceso ni disponibilidad actual en Steam.
            </p>
          )}
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
      paused: "Pausado",
      owned: "Propio",
      family: "Familia",
      manual: "Manual",
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

function isIntelligenceApi(api: DashboardApi): boolean {
  return (
    typeof api.getInsights === "function" &&
    typeof api.getRecommendations === "function" &&
    typeof api.getPreference === "function" &&
    typeof api.savePreference === "function" &&
    typeof api.getPlans === "function" &&
    typeof api.createPlan === "function" &&
    typeof api.updatePlanItemProgress === "function"
  );
}

function isTaskApi(
  api: DashboardApi,
): api is DashboardApi & Required<Pick<DashboardApi, "getTasks" | "getTask" | "cancelTask">> {
  return (
    typeof api.getTasks === "function" &&
    typeof api.getTask === "function" &&
    typeof api.cancelTask === "function"
  );
}

function isManualCollectionApi(
  api: DashboardApi,
): api is DashboardApi &
  Required<
    Pick<
      DashboardApi,
      | "getManualCollection"
      | "addManualCollection"
      | "updateManualCollection"
      | "removeManualCollection"
    >
  > {
  return (
    typeof api.getManualCollection === "function" &&
    typeof api.addManualCollection === "function" &&
    typeof api.updateManualCollection === "function" &&
    typeof api.removeManualCollection === "function"
  );
}
