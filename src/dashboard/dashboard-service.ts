import type { SteamGame, SteamLibrary } from "../domain/models.js";
import type { BacklogPlanService } from "../backlog/backlog-plan-service.js";
import type { BacklogPlan, BacklogPlanItem } from "../domain/backlog-plan.js";
import type { GameRecommendationPreference } from "../domain/recommendation-preferences.js";
import { InputError, TaskNotFoundError, TrackerInputError } from "../errors.js";
import type { LocalTask, TaskRunner } from "../tasks/task-runner.js";
import type {
  PlayNowRecommendation,
  PlayNowRecommendationService,
} from "../recommendations/play-now-recommendation-service.js";
import type { RecommendationPreferencesService } from "../recommendations/recommendation-preferences-service.js";
import type { SteamService } from "../services/steam-service.js";
import type { ManualLibraryGame } from "../manual-library/manual-library.js";
import type { GamingTrackerService, TrackerMarkResult } from "../tracker/gaming-tracker-service.js";
import type { TrackerGame } from "../domain/tracker.js";
import {
  DASHBOARD_MUTABLE_STATUSES,
  type DashboardGame,
  type DashboardGameStatus,
  type DashboardLibrary,
  type DashboardMarkResult,
  type DashboardMutableStatus,
  type DashboardStatusStats,
  type DashboardStatusUpdate,
  type DashboardTotals,
  type DashboardInsightSnapshot,
  type DashboardPlan,
  type DashboardPlanCreateResult,
  type DashboardPlanItem,
  type DashboardPlanItemProgress,
  type DashboardRecommendation,
  type DashboardRecommendationPreference,
  type DashboardRecommendations,
} from "./contracts.js";

type DashboardServiceDependencies = Readonly<{
  steamService: Pick<
    SteamService,
    | "getLibrary"
    | "refreshLibrary"
    | "getLibraryStats"
    | "getManualCollection"
    | "addManualCollection"
    | "updateManualCollection"
    | "removeManualCollection"
  >;
  gamingTrackerService: Pick<GamingTrackerService, "getStatuses" | "mark">;
  recommendationPreferencesService: Pick<RecommendationPreferencesService, "get" | "list" | "save">;
  playNowRecommendationService: Pick<PlayNowRecommendationService, "recommend">;
  backlogPlanService: Pick<BacklogPlanService, "create" | "listActive" | "setItemProgress">;
  taskRunner?: Pick<TaskRunner, "list" | "get" | "cancel">;
}>;

export type DashboardService = Readonly<{
  getLibrary(): Promise<DashboardLibrary>;
  syncLibrary(): Promise<DashboardLibrary>;
  updateStatus(appId: unknown, status: unknown): Promise<DashboardStatusUpdate>;
  getManualCollection(): readonly ManualLibraryGame[];
  addManualCollection(steam: unknown): Promise<ManualLibraryGame>;
  updateManualCollection(
    appId: unknown,
    patch: { accessType?: "manual" | "family"; isPlayable?: boolean },
  ): Promise<ManualLibraryGame>;
  removeManualCollection(appId: unknown): boolean;
  getIntelligenceSnapshot(): Promise<DashboardInsightSnapshot>;
  getRecommendations(availableMinutes: unknown): Promise<DashboardRecommendations>;
  getPreference(appId: unknown): DashboardRecommendationPreference;
  savePreference(appId: unknown, preference: unknown): DashboardRecommendationPreference;
  listPlans(): readonly DashboardPlan[];
  createPlan(request: unknown): Promise<DashboardPlanCreateResult>;
  updatePlanItemProgress(
    planId: unknown,
    itemId: unknown,
    progress: unknown,
  ): Promise<DashboardPlanItem>;
  listTasks(): readonly LocalTask[];
  getTask(id: unknown): LocalTask;
  cancelTask(id: unknown): LocalTask;
}>;

export function createDashboardService({
  steamService,
  gamingTrackerService,
  recommendationPreferencesService,
  playNowRecommendationService,
  backlogPlanService,
  taskRunner,
}: DashboardServiceDependencies): DashboardService {
  async function project(library: SteamLibrary): Promise<DashboardLibrary> {
    const statuses = await gamingTrackerService.getStatuses();
    return createDashboardLibrary(library.games, statuses);
  }

  return Object.freeze({
    async getLibrary() {
      return project(await steamService.getLibrary());
    },
    async syncLibrary() {
      return project(await steamService.refreshLibrary());
    },
    async updateStatus(appId, status) {
      assertAppId(appId);
      assertMutableStatus(status);
      const mark = await gamingTrackerService.mark(appId, status);
      return Object.freeze({
        mark: toDashboardMarkResult(mark),
        library: await project(await steamService.getLibrary()),
      });
    },
    getManualCollection() {
      return steamService.getManualCollection?.() ?? [];
    },
    addManualCollection(steam) {
      if (steamService.addManualCollection === undefined)
        throw new InputError("Manual collections are unavailable.");
      if (typeof steam !== "string")
        throw new InputError("Provide a positive Steam app ID or a Steam store app URL.");
      return steamService.addManualCollection({ steam });
    },
    updateManualCollection(appId, patch) {
      assertAppId(appId);
      if (steamService.updateManualCollection === undefined)
        throw new InputError("Manual collections are unavailable.");
      assertManualCollectionPatch(patch);
      return steamService.updateManualCollection({ appId, ...patch });
    },
    removeManualCollection(appId) {
      assertAppId(appId);
      if (steamService.removeManualCollection === undefined)
        throw new InputError("Manual collections are unavailable.");
      return steamService.removeManualCollection(appId);
    },
    async getIntelligenceSnapshot() {
      const [library, preferences, plans] = await Promise.all([
        steamService.getLibraryStats(),
        Promise.resolve(recommendationPreferencesService.list()),
        Promise.resolve(backlogPlanService.listActive()),
      ]);
      return Object.freeze({
        library: Object.freeze({ ...library }),
        activePlans: Object.freeze(plans.map(toDashboardPlanSummary)),
        preferences: createPreferenceSummary(preferences),
      });
    },
    async getRecommendations(availableMinutes) {
      assertPositiveSafeInteger(
        availableMinutes,
        "Available minutes must be a positive safe integer.",
      );
      const result = await playNowRecommendationService.recommend({
        availableMinutes,
        maxResults: 5,
      });
      return Object.freeze({
        availableMinutes: result.request.availableMinutes,
        recommendations: Object.freeze(result.recommendations.map(toDashboardRecommendation)),
      });
    },
    getPreference(appId) {
      return toDashboardPreference(recommendationPreferencesService.get(appId));
    },
    savePreference(appId, preference) {
      return toDashboardPreference(recommendationPreferencesService.save(appId, preference));
    },
    listPlans() {
      return Object.freeze(backlogPlanService.listActive().map(toDashboardPlan));
    },
    async createPlan(request) {
      const result = await backlogPlanService.create(request);
      return Object.freeze({
        plan: toDashboardPlan(result.plan),
        shortfall: result.shortfall === null ? null : Object.freeze({ ...result.shortfall }),
      });
    },
    async updatePlanItemProgress(planId, itemId, progress) {
      return toDashboardPlanItem(
        await backlogPlanService.setItemProgress(planId, itemId, progress),
      );
    },
    listTasks() {
      return taskRunner?.list() ?? [];
    },
    getTask(id) {
      assertTaskId(id);
      const task = taskRunner?.get(id);
      if (task === undefined) throw new TaskNotFoundError();
      return task;
    },
    cancelTask(id) {
      assertTaskId(id);
      const task = taskRunner?.cancel(id);
      if (task === undefined) throw new TaskNotFoundError();
      return task;
    },
  });
}

function createPreferenceSummary(
  preferences: readonly GameRecommendationPreference[],
): DashboardInsightSnapshot["preferences"] {
  return Object.freeze({
    configuredGames: preferences.length,
    highPriorityGames: preferences.filter((preference) => preference.priority === "high").length,
    excludedGames: preferences.filter((preference) => preference.excludedFromRecommendations)
      .length,
    soloGames: preferences.filter((preference) => preference.playMode === "solo").length,
    withFriendsGames: preferences.filter((preference) => preference.playMode === "with_friends")
      .length,
  });
}

function toDashboardPlanSummary(
  plan: BacklogPlan,
): DashboardInsightSnapshot["activePlans"][number] {
  return Object.freeze({
    id: plan.id,
    cadence: plan.cadence,
    itemCount: plan.items.length,
    completedItemCount: plan.items.filter((item) => item.progress === "done").length,
  });
}

function toDashboardRecommendation(recommendation: PlayNowRecommendation): DashboardRecommendation {
  return Object.freeze({
    appId: recommendation.appId,
    name: recommendation.name,
    durationEstimateMinutes: recommendation.durationEstimateMinutes,
    reasons: Object.freeze(recommendation.reasons.map((reason) => reason.code)),
    explanation: recommendation.explanation,
  });
}

function toDashboardPreference(
  preference: GameRecommendationPreference,
): DashboardRecommendationPreference {
  return Object.freeze({
    appId: preference.appId,
    priority: preference.priority,
    excludedFromRecommendations: preference.excludedFromRecommendations,
    playMode: preference.playMode,
  });
}

function toDashboardPlan(plan: BacklogPlan): DashboardPlan {
  return Object.freeze({
    id: plan.id,
    cadence: plan.cadence,
    availableMinutes: plan.availableMinutes,
    targetGameCount: plan.targetGameCount,
    items: Object.freeze(plan.items.map(toDashboardPlanItem)),
  });
}

function toDashboardPlanItem(item: BacklogPlanItem): DashboardPlanItem {
  return Object.freeze({
    id: item.id,
    rank: item.rank,
    appId: item.appId,
    name: item.name,
    durationEstimateMinutes: item.durationEstimateMinutes,
    explanation: item.explanation,
    progress: item.progress as DashboardPlanItemProgress,
  });
}

function createDashboardLibrary(
  games: readonly SteamGame[],
  trackerGames: readonly TrackerGame[],
): DashboardLibrary {
  const statusesByAppId = new Map(trackerGames.map((game) => [game.appId, game.status]));
  const dashboardGames = Object.freeze(
    games.map((game) => toDashboardGame(game, statusesByAppId.get(game.appId) ?? "backlog")),
  );
  return Object.freeze({
    games: dashboardGames,
    totals: createTotals(dashboardGames),
    statusStats: createStatusStats(dashboardGames),
  });
}

function toDashboardGame(game: SteamGame, status: DashboardGameStatus): DashboardGame {
  return Object.freeze({
    appId: game.appId,
    name: game.name,
    status,
    coverUrl: `/api/artwork/${game.appId}`,
    accessType: game.accessType ?? "owned",
    isPlayable: game.isPlayable ?? true,
    ...(game.manualCollection === true ? { manualCollection: true } : {}),
    playtimeMinutes: game.playtimeMinutes,
    ...(game.recentPlaytimeMinutes === undefined
      ? {}
      : { recentPlaytimeMinutes: game.recentPlaytimeMinutes }),
    ...(game.lastPlayedAt === undefined ? {} : { lastPlayedAt: game.lastPlayedAt }),
  });
}

function createTotals(games: readonly DashboardGame[]): DashboardTotals {
  return Object.freeze({
    totalGames: games.length,
    playedGames: games.filter((game) => game.playtimeMinutes > 0).length,
    unplayedGames: games.filter((game) => game.playtimeMinutes === 0).length,
    totalPlaytimeMinutes: games.reduce((total, game) => total + game.playtimeMinutes, 0),
  });
}

function createStatusStats(games: readonly DashboardGame[]): DashboardStatusStats {
  const stats: Record<DashboardGameStatus, number> = {
    backlog: 0,
    playing: 0,
    completed: 0,
    dropped: 0,
    paused: 0,
  };
  for (const game of games) {
    stats[game.status] += 1;
  }
  return Object.freeze(stats);
}

function toDashboardMarkResult(
  result: TrackerMarkResult<DashboardMutableStatus>,
): DashboardMarkResult {
  return result.outcome === "not_owned"
    ? Object.freeze({ outcome: result.outcome, appId: result.appId })
    : Object.freeze({ outcome: result.outcome, appId: result.appId, status: result.status });
}

function assertAppId(appId: unknown): asserts appId is number {
  if (typeof appId !== "number" || !Number.isSafeInteger(appId) || appId <= 0) {
    throw new TrackerInputError();
  }
}

function assertManualCollectionPatch(
  patch: unknown,
): asserts patch is { accessType?: "manual" | "family"; isPlayable?: boolean } {
  if (
    patch === null ||
    typeof patch !== "object" ||
    Array.isArray(patch) ||
    Object.keys(patch).length === 0 ||
    Object.keys(patch).some((key) => key !== "accessType" && key !== "isPlayable") ||
    ("accessType" in patch &&
      patch.accessType !== undefined &&
      patch.accessType !== "manual" &&
      patch.accessType !== "family") ||
    ("isPlayable" in patch &&
      patch.isPlayable !== undefined &&
      typeof patch.isPlayable !== "boolean")
  ) {
    throw new InputError("At least one access field must be provided.");
  }
}

function assertTaskId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.trim().length === 0 || id.length > 255) {
    throw new InputError("Task ID must be a non-empty string up to 255 characters.");
  }
}

function assertPositiveSafeInteger(value: unknown, message: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new InputError(message);
  }
}

function assertMutableStatus(status: unknown): asserts status is DashboardMutableStatus {
  if (!DASHBOARD_MUTABLE_STATUSES.includes(status as DashboardMutableStatus)) {
    throw new InputError("Status must be one of playing, paused, completed, or dropped.");
  }
}
