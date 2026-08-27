import { TtlCache, type Cache, type Clock } from "./cache/ttl-cache.js";
import { loadConfig, loadIgdbConfig, type AppConfig } from "./config.js";
import { createMetadataUnavailableEnvelope, TrackerPersistenceError } from "./errors.js";
import { createIgdbClient } from "./igdb/client.js";
import { createMetadataService, type MetadataService } from "./services/metadata-service.js";
import { createSteamService, type SteamService } from "./services/steam-service.js";
import { createSteamApiClient, type FetchLike, type SteamApiClient } from "./steam/client.js";
import {
  createGamingTrackerService,
  type GamingTrackerService,
} from "./tracker/gaming-tracker-service.js";
import { openTrackerDatabase } from "./tracker/sqlite/database.js";
import { SqliteTrackerRepository } from "./tracker/sqlite/tracker-repository.js";

export type CoreServiceOverrides = Readonly<{
  config?: AppConfig;
  fetch?: FetchLike;
  clock?: Clock;
  cache?: Cache<ReturnType<SteamService["getLibrary"]> extends Promise<infer T> ? T : never>;
  steamClient?: SteamApiClient;
  steamService?: SteamService;
  gamingTrackerService?: GamingTrackerService;
  metadataService?: MetadataService;
}>;

export type CoreServices = Readonly<{
  steamService: SteamService;
  gamingTrackerService: GamingTrackerService;
  metadataService: MetadataService;
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
  const metadataService =
    overrides.metadataService ?? createDefaultMetadataService(steamService, clock, overrides.fetch);

  return Object.freeze({ steamService, gamingTrackerService, metadataService });
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
