import { type Server } from "node:http";

import { createCoreServices, type CoreServiceOverrides } from "../core-services.js";
import { loadConfig, type AppConfig } from "../config.js";
import { createDashboardService, type DashboardService } from "./dashboard-service.js";
import {
  createDashboardHttpServer,
  DASHBOARD_HOST,
  dashboardStaticRootFromModule,
} from "./http/server.js";

export type DashboardStartOptions = CoreServiceOverrides &
  Readonly<{
    config?: AppConfig;
    dashboardService?: DashboardService;
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
