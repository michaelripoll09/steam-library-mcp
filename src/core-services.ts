import { TtlCache, type Cache, type Clock } from "./cache/ttl-cache.js";
import { loadConfig, loadIgdbConfig, type AppConfig } from "./config.js";
import { createMetadataUnavailableEnvelope, TrackerPersistenceError } from "./errors.js";
import { createIgdbClient } from "./igdb/client.js";
import {
  createGameDurationService,
  createUnavailableGameDurationService,
  type GameDurationService,
} from "./durations/game-duration-service.js";
import { SqliteGameDurationRepository } from "./durations/sqlite/game-duration-repository.js";
import { createMetadataService, type MetadataService } from "./services/metadata-service.js";
import { createSteamService, type SteamService } from "./services/steam-service.js";
import { createSteamApiClient, type FetchLike, type SteamApiClient } from "./steam/client.js";
import {
  createGamingTrackerService,
  type GamingTrackerService,
} from "./tracker/gaming-tracker-service.js";
import { openTrackerDatabase } from "./tracker/sqlite/database.js";
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

export type CoreServiceOverrides = Readonly<{
  config?: AppConfig;
  fetch?: FetchLike;
  clock?: Clock;
  cache?: Cache<ReturnType<SteamService["getLibrary"]> extends Promise<infer T> ? T : never>;
  steamClient?: SteamApiClient;
  steamService?: SteamService;
  gamingTrackerService?: GamingTrackerService;
  recommendationPreferencesService?: RecommendationPreferencesService;
  metadataService?: MetadataService;
  gameDurationService?: GameDurationService;
  playNowRecommendationService?: PlayNowRecommendationService;
  backlogPlanService?: BacklogPlanService;
}>;

export type CoreServices = Readonly<{
  steamService: SteamService;
  gamingTrackerService: GamingTrackerService;
  recommendationPreferencesService: RecommendationPreferencesService;
  metadataService: MetadataService;
  gameDurationService: GameDurationService;
  playNowRecommendationService: PlayNowRecommendationService;
  backlogPlanService: BacklogPlanService;
}>;

export function createCoreServices(overrides: CoreServiceOverrides = {}): CoreServices {
  let resolvedConfig: AppConfig | undefined;
  const config = (): AppConfig => {
    resolvedConfig ??= overrides.config ?? loadConfig();
    return resolvedConfig;
  };
  const clock = overrides.clock ?? { now: Date.now };
  const steamService =
    overrides.steamService ??
    createSteamService({
      config: config(),
      steamClient:
        overrides.steamClient ?? createSteamApiClient({ config: config(), fetch: overrides.fetch }),
      cache: overrides.cache ?? new TtlCache({ now: clock.now }),
      clock,
    });
  const gamingTrackerService =
    overrides.gamingTrackerService ??
    createDefaultGamingTrackerService(config(), clock, steamService);
  const recommendationPreferencesService =
    overrides.recommendationPreferencesService ??
    createDefaultRecommendationPreferencesService(config());
  const metadataService =
    overrides.metadataService ?? createDefaultMetadataService(steamService, clock, overrides.fetch);
  const gameDurationService =
    overrides.gameDurationService ??
    createDefaultGameDurationService(config(), clock, overrides.fetch);
  const playNowRecommendationService =
    overrides.playNowRecommendationService ??
    createDefaultPlayNowRecommendationService(config(), steamService, gameDurationService);
  const backlogPlanService =
    overrides.backlogPlanService ??
    createDefaultBacklogPlanService(config(), clock, playNowRecommendationService);

  return Object.freeze({
    steamService,
    gamingTrackerService,
    recommendationPreferencesService,
    metadataService,
    gameDurationService,
    playNowRecommendationService,
    backlogPlanService,
  });
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
  config: AppConfig,
  clock: Clock,
  fetch: FetchLike | undefined,
): GameDurationService {
  const metadataConfig = loadIgdbConfig();
  try {
    const repository = new SqliteGameDurationRepository(
      openTrackerDatabase(config.trackerDatabasePath),
    );
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
  config: AppConfig,
  clock: Clock,
  steamService: SteamService,
): GamingTrackerService {
  try {
    return createGamingTrackerService({
      clock,
      ownershipLookup: { getOwnedGames: async () => (await steamService.getLibrary()).games },
      repository: new SqliteTrackerRepository(openTrackerDatabase(config.trackerDatabasePath)),
    });
  } catch (error) {
    throw new TrackerPersistenceError(error);
  }
}

function createDefaultRecommendationPreferencesService(
  config: AppConfig,
): RecommendationPreferencesService {
  try {
    return createRecommendationPreferencesService({
      repository: new SqliteRecommendationPreferenceRepository(
        openTrackerDatabase(config.trackerDatabasePath),
      ),
    });
  } catch (error) {
    throw new TrackerPersistenceError(error);
  }
}

function createDefaultPlayNowRecommendationService(
  config: AppConfig,
  steamService: SteamService,
  gameDurationService: GameDurationService,
): PlayNowRecommendationService {
  try {
    const database = openTrackerDatabase(config.trackerDatabasePath);
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
  config: AppConfig,
  clock: Clock,
  recommendationService: PlayNowRecommendationService,
): BacklogPlanService {
  try {
    return createBacklogPlanService({
      clock,
      recommendationService,
      repository: new SqliteBacklogPlanRepository(openTrackerDatabase(config.trackerDatabasePath)),
    });
  } catch (error) {
    throw new TrackerPersistenceError(error);
  }
}
