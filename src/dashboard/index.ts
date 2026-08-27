import { type Server } from "node:http";
import { dirname, resolve } from "node:path";

import { createCoreServices, type CoreServiceOverrides } from "../core-services.js";
import { DEFAULT_TRACKER_DATABASE_PATH, loadConfig, type AppConfig } from "../config.js";
import { createDashboardService, type DashboardService } from "./dashboard-service.js";
import { createArtworkResolver, type ArtworkResolver } from "./artwork-resolver.js";
import {
  createDashboardHttpServer,
  DASHBOARD_HOST,
  dashboardStaticRootFromModule,
} from "./http/server.js";

export type DashboardStartOptions = CoreServiceOverrides &
  Readonly<{
    config?: AppConfig;
    dashboardService?: DashboardService;
    artworkResolver?: ArtworkResolver;
    staticRoot?: string;
    port?: number;
    installSignalHandlers?: boolean;
  }>;

export async function startDashboardServer(options: DashboardStartOptions = {}): Promise<Server> {
  const config = options.config ?? loadConfig();
  const dashboardService =
    options.dashboardService ?? createDashboardService(createCoreServices({ ...options, config }));
  const server = createDashboardHttpServer({
    dashboardService,
    artworkResolver:
      options.artworkResolver ??
      createArtworkResolver({
        cacheDirectory: resolve(
          dirname(config.trackerDatabasePath ?? DEFAULT_TRACKER_DATABASE_PATH),
          "artwork",
        ),
        ...(config.steamGridDbApiKey === undefined
          ? {}
          : { steamGridDbApiKey: config.steamGridDbApiKey }),
        fetch: options.fetch,
      }),
    staticRoot: options.staticRoot ?? dashboardStaticRootFromModule(import.meta.url),
    host: DASHBOARD_HOST,
    port: options.port ?? config.dashboardPort,
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? config.dashboardPort, DASHBOARD_HOST, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  if (options.installSignalHandlers !== false) {
    const close = () => {
      server.close(() => process.exit(0));
    };
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
  }
  return server;
}

export async function runDashboard(): Promise<void> {
  try {
    await startDashboardServer();
  } catch {
    process.stderr.write("Dashboard server failed to start.\n");
    process.exitCode = 1;
  }
}

export function isDashboardEntrypoint(argv1: string | undefined): boolean {
  if (argv1 === undefined) return false;
  const segments = argv1.replaceAll("\\", "/").toLocaleLowerCase().split("/");
  return segments.at(-2) === "dashboard" && segments.at(-1) === "index.js";
}

if (isDashboardEntrypoint(process.argv[1])) {
  void runDashboard();
}
