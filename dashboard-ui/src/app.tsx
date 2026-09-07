import { presentationError } from "./presentation.js";
import { useEffect, useRef, useState } from "react";

import type {
  DashboardGame,
  DashboardAchievementResult,
  DashboardLibrary,
  DashboardMutableStatus,
} from "../../src/dashboard/contracts.js";
import type { ManualLibraryGame } from "../../src/manual-library/manual-library.js";
import { createDashboardApi, type DashboardApi } from "./api.js";
import { GameDetailsDrawer } from "./game-details/game-details-drawer.js";
import { AppShell, type DashboardView } from "./navigation/app-shell.js";
import { HomeView } from "./views/home-view.js";
import { useIntelligenceState, type IntelligenceApi } from "./intelligence-state.js";
import { LibraryView } from "./views/library-view.js";
import { ManualCollectionView } from "./views/manual-collection-view.js";
import { useTaskState, type TaskApi } from "./task-state.js";
import { TasksView } from "./views/tasks-view.js";
import { BacklogView } from "./views/backlog-view.js";
import { PlayNowView } from "./views/play-now-view.js";
import {
  createLibraryFilters,
  filterLibraryGames,
  type LibraryFilters,
} from "./library-filters.js";

type DashboardAppProps = Readonly<{ api?: DashboardApi }>;
const EMPTY_GAMES: readonly DashboardGame[] = [];

export function DashboardApp({ api: suppliedApi }: DashboardAppProps) {
  const defaultApiRef = useRef<DashboardApi | undefined>(undefined);
  const api =
    suppliedApi ?? (defaultApiRef.current ??= createDashboardApi(window.fetch.bind(window)));
  const intelligenceApi = isIntelligenceApi(api);
  const taskApi = isTaskApi(api);
  const taskState = useTaskState(taskApi ? api : undefined);
  const manualCollectionApi = isManualCollectionApi(api);
  const [library, setLibrary] = useState<DashboardLibrary | undefined>();
  const intelligenceState = useIntelligenceState({
    api: api as IntelligenceApi,
    games: libraryGames(library),
  });
  const [filters, setFilters] = useState<LibraryFilters>(createLibraryFilters);
  const [activeView, setActiveView] = useState<DashboardView>("home");
  const [initialError, setInitialError] = useState<string | undefined>();
  const [syncError, setSyncError] = useState<string | undefined>();
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [selectedGame, setSelectedGame] = useState<DashboardGame | undefined>();
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | undefined>();
  const [statusError, setStatusError] = useState<string | undefined>();
  const [achievementCache, setAchievementCache] = useState<
    ReadonlyMap<number, DashboardAchievementResult>
  >(() => new Map());
  const [loadingAchievementAppIds, setLoadingAchievementAppIds] = useState<ReadonlySet<number>>(
    () => new Set(),
  );
  const [achievementErrors, setAchievementErrors] = useState<ReadonlyMap<number, string>>(
    () => new Map(),
  );
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

  useEffect(() => {
    if (!intelligenceApi) return;
    void intelligenceState.refreshPlans();
  }, [api, intelligenceApi]);

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
    setAchievementErrors((errors) => {
      const nextErrors = new Map(errors);
      nextErrors.delete(game.appId);
      return nextErrors;
    });
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

  const loadAchievements = async () => {
    if (selectedGame === undefined || !isAchievementsApi(api)) return;
    const appId = selectedGame.appId;
    if (achievementCache.has(appId)) return;
    setLoadingAchievementAppIds((appIds) => new Set(appIds).add(appId));
    setAchievementErrors((errors) => {
      const nextErrors = new Map(errors);
      nextErrors.delete(appId);
      return nextErrors;
    });
    try {
      const result = await api.getAchievements(appId);
      setAchievementCache((cache) => new Map(cache).set(appId, result));
    } catch (error) {
      setAchievementErrors((errors) => new Map(errors).set(appId, errorMessage(error)));
    } finally {
      setLoadingAchievementAppIds((appIds) => {
        const nextAppIds = new Set(appIds);
        nextAppIds.delete(appId);
        return nextAppIds;
      });
    }
  };

  const games = library === undefined ? [] : filterLibraryGames(library.games, filters);

  return (
    <AppShell activeView={activeView} onViewChange={setActiveView}>
      <main className="dashboard-main" data-view={activeView}>
        {activeView === "home" && (
          <HomeView
            library={library}
            isLoading={isLoading}
            error={initialError}
            intelligenceState={intelligenceState}
            taskSummary={taskState?.summary}
            onNavigate={setActiveView}
          />
        )}

        {activeView === "library" && (
          <LibraryView
            library={library}
            games={games}
            filters={filters}
            isLoading={isLoading}
            error={initialError}
            isSyncing={isSyncing}
            syncError={syncError}
            onFiltersChange={setFilters}
            onRetryLoad={() => void loadLibrary()}
            onSync={() => void syncLibrary()}
            onOpen={openGame}
          />
        )}
        {activeView === "play-now" && library !== undefined && intelligenceApi && (
          <PlayNowView games={library.games} state={intelligenceState} onOpenGame={openGame} />
        )}

        {activeView === "backlog" && library !== undefined && intelligenceApi && (
          <BacklogView state={intelligenceState} games={library.games} />
        )}

        {activeView === "manual" && manualCollectionApi && (
          <ManualCollectionView
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

        {activeView === "tasks" && taskState !== undefined && <TasksView state={taskState} />}

        {selectedGame !== undefined && (
          <GameDetailsDrawer
            game={selectedGame}
            closeButtonRef={closeButtonRef}
            isUpdatingStatus={isUpdatingStatus}
            statusError={statusError}
            statusMessage={statusMessage}
            achievementResult={achievementCache.get(selectedGame.appId)}
            isLoadingAchievements={loadingAchievementAppIds.has(selectedGame.appId)}
            achievementError={achievementErrors.get(selectedGame.appId)}
            onLoadAchievements={isAchievementsApi(api) ? loadAchievements : undefined}
            onClose={closeGame}
            onStatusChange={updateStatus}
          />
        )}
      </main>
    </AppShell>
  );
}

function libraryGames(library: DashboardLibrary | undefined): readonly DashboardGame[] {
  return library?.games ?? EMPTY_GAMES;
}

function errorMessage(error: unknown): string {
  return presentationError(error);
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

function isAchievementsApi(
  api: DashboardApi,
): api is DashboardApi & Required<Pick<DashboardApi, "getAchievements">> {
  return typeof api.getAchievements === "function";
}

function isTaskApi(api: DashboardApi): api is TaskApi {
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
