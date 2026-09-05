import { TtlCache, type Cache, type Clock } from "./cache/ttl-cache.js";
import { loadConfig, loadIgdbConfig, type AppConfig } from "./config.js";
import {
  createMetadataUnavailableEnvelope,
  InputError,
  TrackerPersistenceError,
} from "./errors.js";
import { createIgdbClient } from "./igdb/client.js";
import {
  createGameDurationService,
  createUnavailableGameDurationService,
  type GameDurationService,
} from "./durations/game-duration-service.js";
import { SqliteGameDurationRepository } from "./durations/sqlite/game-duration-repository.js";
import { createMetadataService, type MetadataService } from "./services/metadata-service.js";
import {
  createAchievementService,
  type AchievementService,
  type AchievementResult,
} from "./services/achievement-service.js";
import { createSteamService, type SteamService } from "./services/steam-service.js";
import { createSteamApiClient, type FetchLike, type SteamApiClient } from "./steam/client.js";
import {
  createGamingTrackerService,
  type GamingTrackerService,
} from "./tracker/gaming-tracker-service.js";
import { openTrackerDatabase, type TrackerDatabase } from "./tracker/sqlite/database.js";
import { SqliteTrackerRepository } from "./tracker/sqlite/tracker-repository.js";
import {
  createRecommendationPreferencesService,
  type RecommendationPreferencesService,
} from "./recommendations/recommendation-preferences-service.js";
import { SqliteRecommendationPreferenceRepository } from "./recommendations/sqlite/recommendation-preference-repository.js";
import {
  createPlayNowRecommendationService,
  type PlayNowRecommendationService,
} from "./recommendations/play-now-recommendation-service.js";
import {
  createBacklogPlanService,
  type BacklogPlanService,
} from "./backlog/backlog-plan-service.js";
import { SqliteBacklogPlanRepository } from "./backlog/sqlite/backlog-plan-repository.js";
import {
  createBacklogSelectionService,
  type BacklogSelectionService,
} from "./backlog/backlog-selection-service.js";
import { createTaskRunner, type TaskRunner } from "./tasks/task-runner.js";
import {
  createPublicSteamGameLookup,
  SqliteManualLibraryRepository,
} from "./manual-library/manual-library.js";

export type CoreServiceOverrides = Readonly<{
  config?: AppConfig;
  database?: TrackerDatabase;
  fetch?: FetchLike;
  clock?: Clock;
  cache?: Cache<ReturnType<SteamService["getLibrary"]> extends Promise<infer T> ? T : never>;
  steamClient?: SteamApiClient;
  steamService?: SteamService;
  achievementService?: AchievementService;
  gamingTrackerService?: GamingTrackerService;
  recommendationPreferencesService?: RecommendationPreferencesService;
  metadataService?: MetadataService;
  gameDurationService?: GameDurationService;
  playNowRecommendationService?: PlayNowRecommendationService;
  backlogSelectionService?: BacklogSelectionService;
  backlogPlanService?: BacklogPlanService;
  taskRunner?: TaskRunner;
}>;

export type CoreServices = Readonly<{
  steamService: SteamService;
  achievementService: AchievementService;
  gamingTrackerService: GamingTrackerService;
  recommendationPreferencesService: RecommendationPreferencesService;
  metadataService: MetadataService;
  gameDurationService: GameDurationService;
  playNowRecommendationService: PlayNowRecommendationService;
  backlogSelectionService: BacklogSelectionService;
  backlogPlanService: BacklogPlanService;
  taskRunner: TaskRunner;
  close(): void;
}>;

export function createCoreServices(overrides: CoreServiceOverrides = {}): CoreServices {
  let resolvedConfig: AppConfig | undefined;
  const config = (): AppConfig => {
    resolvedConfig ??= overrides.config ?? loadConfig();
    return resolvedConfig;
  };
  let resolvedSteamClient: SteamApiClient | undefined;
  const steamClient = (): SteamApiClient => {
    resolvedSteamClient ??=
      overrides.steamClient ?? createSteamApiClient({ config: config(), fetch: overrides.fetch });
    return resolvedSteamClient;
  };
  let resolvedDatabase: TrackerDatabase | undefined;
  let ownsDatabase = false;
  let databaseClosed = false;
  const database = (): TrackerDatabase => {
    if (resolvedDatabase !== undefined) return resolvedDatabase;
    if (overrides.database !== undefined) {
      resolvedDatabase = overrides.database;
      return resolvedDatabase;
    }
    try {
      resolvedDatabase = openTrackerDatabase(config().trackerDatabasePath);
      ownsDatabase = true;
      return resolvedDatabase;
    } catch (error) {
      throw new TrackerPersistenceError(error);
    }
  };
  const clock = overrides.clock ?? { now: Date.now };
  const steamService =
    overrides.steamService ??
    createSteamService({
      config: config(),
      steamClient: steamClient(),
      cache: overrides.cache ?? new TtlCache({ now: clock.now }),
      clock,
      manualRepository: createDefaultManualLibraryRepository(database()),
      publicGameLookup: createPublicSteamGameLookup(overrides.fetch),
    });
  const achievementService =
    overrides.achievementService ??
    createAchievementService({
      config: config(),
      steamService,
      steamClient: steamClient(),
      cache: new TtlCache<AchievementResult>({ now: clock.now }),
    });
  const gamingTrackerService =
    overrides.gamingTrackerService ??
    createDefaultGamingTrackerService(database(), clock, steamService);
  const recommendationPreferencesService =
    overrides.recommendationPreferencesService ??
    createDefaultRecommendationPreferencesService(database());
  const metadataService =
    overrides.metadataService ?? createDefaultMetadataService(steamService, clock, overrides.fetch);
  const gameDurationService =
    overrides.gameDurationService ??
    createDefaultGameDurationService(database(), clock, overrides.fetch);
  const playNowRecommendationService =
    overrides.playNowRecommendationService ??
    createDefaultPlayNowRecommendationService(database(), steamService, gameDurationService);
  const backlogSelectionService =
    overrides.backlogSelectionService ??
    createDefaultBacklogSelectionService(database(), steamService, gameDurationService);
  const backlogPlanService =
    overrides.backlogPlanService ??
    createDefaultBacklogPlanService(database(), clock, backlogSelectionService);
  const taskRunner =
    overrides.taskRunner ??
    (overrides.config === undefined && allCoreServicesAreOverridden(overrides)
      ? createUnavailableTaskRunner()
      : createDefaultTaskRunner(database(), steamService, gameDurationService, backlogPlanService));

  const close = () => {
    if (!ownsDatabase || databaseClosed || resolvedDatabase === undefined) return;
    resolvedDatabase.close();
    databaseClosed = true;
  };

  return Object.freeze({
    steamService,
    achievementService,
    gamingTrackerService,
    recommendationPreferencesService,
    metadataService,
    gameDurationService,
    playNowRecommendationService,
    backlogSelectionService,
    backlogPlanService,
    taskRunner,
    close,
  });
}

function createDefaultManualLibraryRepository(
  database: TrackerDatabase,
): SqliteManualLibraryRepository {
  try {
    return new SqliteManualLibraryRepository(database);
  } catch (error) {
    throw new TrackerPersistenceError(error);
  }
}

function allCoreServicesAreOverridden(overrides: CoreServiceOverrides): boolean {
  return (
    overrides.steamService !== undefined &&
    overrides.achievementService !== undefined &&
    overrides.gamingTrackerService !== undefined &&
    overrides.recommendationPreferencesService !== undefined &&
    overrides.metadataService !== undefined &&
    overrides.gameDurationService !== undefined &&
    overrides.playNowRecommendationService !== undefined &&
    overrides.backlogSelectionService !== undefined &&
    overrides.backlogPlanService !== undefined
  );
}

function createUnavailableTaskRunner(): TaskRunner {
  return Object.freeze({
    enqueue() {
      throw new InputError("Task storage is unavailable without application configuration.");
    },
    get() {
      return undefined;
    },
    list() {
      return [];
    },
    cancel() {
      return undefined;
    },
    start() {},
  });
}

function createDefaultTaskRunner(
  database: TrackerDatabase,
  steamService: SteamService,
  gameDurationService: GameDurationService,
  backlogPlanService: BacklogPlanService,
): TaskRunner {
  try {
    return createTaskRunner({
      database,
      handlers: {
        async sync_library(_request, context) {
          await steamService.refreshLibrary();
          context.reportProgress(1, 1);
        },
        async enrich_durations(_request, context) {
          const library = await steamService.getLibrary();
          context.reportProgress(0, library.games.length);
          for (const [index, game] of library.games.entries()) {
            if (context.signal.aborted) return;
            await gameDurationService.getEstimate(game);
            context.reportProgress(index + 1);
          }
        },
        async recalculate_plan(request, context) {
          const plan = backlogPlanService.get(request.planId);
          if (plan === undefined)
            throw new InputError("The requested backlog plan does not exist.");
          await backlogPlanService.create({
            cadence: plan.cadence,
            availableMinutes: plan.availableMinutes,
            targetGameCount: plan.targetGameCount,
          });
          context.reportProgress(1, 1);
        },
      },
    });
  } catch (error) {
    throw new TrackerPersistenceError(error);
  }
}

function createDefaultMetadataService(
  steamService: SteamService,
  clock: Clock,
  fetch: FetchLike | undefined,
): MetadataService {
  const metadataConfig = loadIgdbConfig();
  return metadataConfig.enabled
    ? createMetadataService({
        steamService,
        igdbClient: createIgdbClient({ credentials: metadataConfig, fetch }),
        clock,
      })
    : disabledMetadataService();
}

function disabledMetadataService(): MetadataService {
  const unavailable = () =>
    createMetadataUnavailableEnvelope({
      message: "Configure IGDB_CLIENT_ID and IGDB_CLIENT_SECRET to use metadata tools.",
      retryable: false,
    });
  return {
    getOwnedGameMetadata: async () => unavailable(),
    queryOwnedMetadata: async () => unavailable() as never,
  };
}

function createDefaultGameDurationService(
  database: TrackerDatabase,
  clock: Clock,
  fetch: FetchLike | undefined,
): GameDurationService {
  const metadataConfig = loadIgdbConfig();
  try {
    const repository = new SqliteGameDurationRepository(database);
    return metadataConfig.enabled
      ? createGameDurationService({
          clock,
          igdbClient: createIgdbClient({ credentials: metadataConfig, fetch }),
          repository,
        })
      : createUnavailableGameDurationService({ repository });
  } catch (error) {
    throw new TrackerPersistenceError(error);
  }
}

function createDefaultGamingTrackerService(
  database: TrackerDatabase,
  clock: Clock,
  steamService: SteamService,
): GamingTrackerService {
  try {
    return createGamingTrackerService({
      clock,
      ownershipLookup: { getOwnedGames: async () => (await steamService.getLibrary()).games },
      repository: new SqliteTrackerRepository(database),
    });
  } catch (error) {
    throw new TrackerPersistenceError(error);
  }
}

function createDefaultRecommendationPreferencesService(
  database: TrackerDatabase,
): RecommendationPreferencesService {
  try {
    return createRecommendationPreferencesService({
      repository: new SqliteRecommendationPreferenceRepository(database),
    });
  } catch (error) {
    throw new TrackerPersistenceError(error);
  }
}

function createDefaultPlayNowRecommendationService(
  database: TrackerDatabase,
  steamService: SteamService,
  gameDurationService: GameDurationService,
): PlayNowRecommendationService {
  try {
    return createPlayNowRecommendationService({
      library: steamService,
      trackerRepository: new SqliteTrackerRepository(database),
      preferenceRepository: new SqliteRecommendationPreferenceRepository(database),
      gameDurationService,
    });
  } catch (error) {
    throw new TrackerPersistenceError(error);
  }
}

function createDefaultBacklogPlanService(
  database: TrackerDatabase,
  clock: Clock,
  selectionService: BacklogSelectionService,
): BacklogPlanService {
  try {
    return createBacklogPlanService({
      clock,
      selectionService,
      repository: new SqliteBacklogPlanRepository(database),
    });
  } catch (error) {
    throw new TrackerPersistenceError(error);
  }
}

function createDefaultBacklogSelectionService(
  database: TrackerDatabase,
  steamService: SteamService,
  gameDurationService: GameDurationService,
): BacklogSelectionService {
  try {
    return createBacklogSelectionService({
      library: steamService,
      trackerRepository: new SqliteTrackerRepository(database),
      preferenceRepository: new SqliteRecommendationPreferenceRepository(database),
      gameDurationService,
    });
  } catch (error) {
    throw new TrackerPersistenceError(error);
  }
}
