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
  const libraryGenerationRef = useRef(0);
  const lastAppliedLibraryGenerationRef = useRef(0);
  const pendingLibraryOperationsRef = useRef(0);
  const libraryRef = useRef<DashboardLibrary | undefined>(undefined);
  const syncGenerationRef = useRef(0);
  const manualGenerationRef = useRef(0);
  const statusGenerationRef = useRef(0);
  const selectedGameAppIdRef = useRef<number | undefined>(undefined);
  const achievementInflightRef = useRef<ReadonlySet<number>>(new Set());

  const claimLibraryGeneration = () => {
    pendingLibraryOperationsRef.current += 1;
    return ++libraryGenerationRef.current;
  };

  const settleLibraryOperation = () => {
    pendingLibraryOperationsRef.current = Math.max(0, pendingLibraryOperationsRef.current - 1);
  };

  const applyAuthoritativeLibrary = (nextLibrary: DashboardLibrary, generation: number) => {
    if (generation !== libraryGenerationRef.current) {
      const newerApplied = generation <= lastAppliedLibraryGenerationRef.current;
      const newerInflight = pendingLibraryOperationsRef.current > 1;
      if (newerApplied || newerInflight) {
        return false;
      }
    }
    lastAppliedLibraryGenerationRef.current = Math.max(
      lastAppliedLibraryGenerationRef.current,
      generation,
    );
    libraryRef.current = nextLibrary;
    setLibrary(nextLibrary);
    setIsLoading(false);
    setInitialError(undefined);
    return true;
  };

  const loadLibrary = async () => {
    const generation = claimLibraryGeneration();
    try {
      setIsLoading(true);
      setInitialError(undefined);
      try {
        const nextLibrary = await api.getLibrary();
        applyAuthoritativeLibrary(nextLibrary, generation);
      } catch (error) {
        if (generation === libraryGenerationRef.current) setInitialError(errorMessage(error));
      } finally {
        if (generation === libraryGenerationRef.current) setIsLoading(false);
      }
    } finally {
      settleLibraryOperation();
    }
  };

  useEffect(() => {
    void loadLibrary();
  }, [api]);

  useEffect(() => {
    if (!manualCollectionApi) return;
    const generation = ++manualGenerationRef.current;
    void api.getManualCollection().then(
      (collection) => {
        if (generation === manualGenerationRef.current) setManualCollection(collection);
      },
      () => {
        if (generation === manualGenerationRef.current) setManualCollection([]);
      },
    );
  }, [api, manualCollectionApi]);

  useEffect(() => {
    if (!intelligenceApi) return;
    void intelligenceState.refreshPlans();
  }, [api, intelligenceApi]);

  const addManual = async () => {
    if (!manualCollectionApi) return;
    const libraryGeneration = claimLibraryGeneration();
    const manualGeneration = ++manualGenerationRef.current;
    try {
      setIsSavingManual(true);
      setManualError(undefined);
      try {
        await api.addManualCollection(manualSteam);
        if (manualGeneration !== manualGenerationRef.current) return;
        setManualSteam("");
        const nextCollection = await api.getManualCollection();
        if (manualGeneration !== manualGenerationRef.current) return;
        setManualCollection(nextCollection);
        const nextLibrary = await api.getLibrary();
        applyAuthoritativeLibrary(nextLibrary, libraryGeneration);
      } catch (error) {
        if (manualGeneration === manualGenerationRef.current) setManualError(errorMessage(error));
      } finally {
        if (manualGeneration === manualGenerationRef.current) setIsSavingManual(false);
      }
    } finally {
      settleLibraryOperation();
    }
  };
  const updateManual = async (
    appId: number,
    patch: { accessType?: "manual" | "family"; isPlayable?: boolean },
  ) => {
    if (!manualCollectionApi) return;
    const libraryGeneration = claimLibraryGeneration();
    const manualGeneration = ++manualGenerationRef.current;
    try {
      setManualError(undefined);
      try {
        const updated = await api.updateManualCollection(appId, patch);
        if (manualGeneration !== manualGenerationRef.current) return;
        setManualCollection((collection) =>
          collection.map((game) => (game.appId === appId ? updated : game)),
        );
        const nextLibrary = await api.getLibrary();
        applyAuthoritativeLibrary(nextLibrary, libraryGeneration);
      } catch (error) {
        if (manualGeneration === manualGenerationRef.current) setManualError(errorMessage(error));
      }
    } finally {
      settleLibraryOperation();
    }
  };
  const removeManual = async (appId: number) => {
    if (!manualCollectionApi) return;
    const libraryGeneration = claimLibraryGeneration();
    const manualGeneration = ++manualGenerationRef.current;
    try {
      setManualError(undefined);
      try {
        await api.removeManualCollection(appId);
        if (manualGeneration !== manualGenerationRef.current) return;
        const nextCollection = await api.getManualCollection();
        if (manualGeneration !== manualGenerationRef.current) return;
        setManualCollection(nextCollection);
        const nextLibrary = await api.getLibrary();
        applyAuthoritativeLibrary(nextLibrary, libraryGeneration);
      } catch (error) {
        if (manualGeneration === manualGenerationRef.current) setManualError(errorMessage(error));
      }
    } finally {
      settleLibraryOperation();
    }
  };

  useEffect(() => {
    if (selectedGame !== undefined) closeButtonRef.current?.focus();
  }, [selectedGame]);

  const openGame = (game: DashboardGame, opener: HTMLButtonElement) => {
    openerRef.current = opener;
    selectedGameAppIdRef.current = game.appId;
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
    selectedGameAppIdRef.current = undefined;
    setSelectedGame(undefined);
    openerRef.current?.focus();
  };

  const syncLibrary = async () => {
    const libraryGeneration = claimLibraryGeneration();
    const syncGeneration = ++syncGenerationRef.current;
    try {
      setIsSyncing(true);
      setSyncError(undefined);
      try {
        const nextLibrary = await api.syncLibrary();
        applyAuthoritativeLibrary(nextLibrary, libraryGeneration);
      } catch (error) {
        if (syncGeneration === syncGenerationRef.current) setSyncError(errorMessage(error));
      } finally {
        if (syncGeneration === syncGenerationRef.current) setIsSyncing(false);
      }
    } finally {
      settleLibraryOperation();
    }
  };

  const updateStatus = async (status: DashboardMutableStatus) => {
    if (selectedGame === undefined) return;
    const requestAppId = selectedGame.appId;
    const statusGeneration = ++statusGenerationRef.current;
    const libraryGeneration = claimLibraryGeneration();
    try {
      setIsUpdatingStatus(true);
      setStatusError(undefined);
      setStatusMessage(undefined);
      try {
        const update = await api.updateGameStatus(requestAppId, status);
        applyAuthoritativeLibrary(update.library, libraryGeneration);
        if (
          statusGeneration !== statusGenerationRef.current ||
          selectedGameAppIdRef.current !== requestAppId
        )
          return;
        setSelectedGame(update.library.games.find((game) => game.appId === requestAppId));
        setStatusMessage("Estado guardado.");
      } catch (error) {
        if (
          statusGeneration === statusGenerationRef.current &&
          selectedGameAppIdRef.current === requestAppId
        )
          setStatusError(errorMessage(error));
      } finally {
        if (statusGeneration === statusGenerationRef.current) setIsUpdatingStatus(false);
      }
    } finally {
      settleLibraryOperation();
    }
  };

  const loadAchievements = async () => {
    if (selectedGame === undefined || !isAchievementsApi(api)) return;
    const appId = selectedGame.appId;
    if (achievementCache.has(appId) || achievementInflightRef.current.has(appId)) return;
    achievementInflightRef.current = new Set(achievementInflightRef.current).add(appId);
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
      achievementInflightRef.current = ((): ReadonlySet<number> => {
        const next = new Set(achievementInflightRef.current);
        next.delete(appId);
        return next;
      })();
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
