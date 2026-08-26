import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import { TtlCache, type Cache, type Clock } from "./cache/ttl-cache.js";
import { loadConfig, type AppConfig } from "./config.js";
import { TrackerPersistenceError } from "./errors.js";
import { createSteamService, type SteamService } from "./services/steam-service.js";
import { createSteamApiClient, type FetchLike, type SteamApiClient } from "./steam/client.js";
import { registerSteamTools, type ToolRegistrar } from "./tools/register-steam-tools.js";
import { registerGamingTools } from "./tools/register-gaming-tools.js";
import {
  createGamingTrackerService,
  type GamingTrackerService,
} from "./tracker/gaming-tracker-service.js";
import { openTrackerDatabase } from "./tracker/sqlite/database.js";
import { SqliteTrackerRepository } from "./tracker/sqlite/tracker-repository.js";

export type ServerOverrides = Readonly<{
  config?: AppConfig;
  fetch?: FetchLike;
  clock?: Clock;
  cache?: Cache<ReturnType<SteamService["getLibrary"]> extends Promise<infer T> ? T : never>;
  steamClient?: SteamApiClient;
  steamService?: SteamService;
  gamingTrackerService?: GamingTrackerService;
}>;

type StartServerOptions = ServerOverrides &
  Readonly<{
    server?: Pick<McpServer, "connect">;
    transport?: Transport;
  }>;

export function createServer(overrides: ServerOverrides = {}): McpServer {
  const config = overrides.config ?? loadConfig();
  const clock = overrides.clock ?? { now: Date.now };
  const cache = overrides.cache ?? new TtlCache({ now: clock.now });
  const steamClient =
    overrides.steamClient ?? createSteamApiClient({ config, fetch: overrides.fetch });
  const steamService =
    overrides.steamService ?? createSteamService({ config, steamClient, cache, clock });
  const gamingTrackerService =
    overrides.gamingTrackerService ??
    createDefaultGamingTrackerService(config, clock, steamService);
  const server = new McpServer({ name: "steam-library-mcp", version: "0.1.0" });

  registerSteamTools(server as unknown as ToolRegistrar, steamService);
  registerGamingTools(server as unknown as ToolRegistrar, gamingTrackerService);
  return server;
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

export async function startStdioServer(options: StartServerOptions = {}): Promise<void> {
  const server = options.server ?? createServer(options);
  const transport = options.transport ?? new StdioServerTransport();
  await server.connect(transport);
}
