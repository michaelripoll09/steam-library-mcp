import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import {
  createCoreServices,
  type CoreServiceOverrides,
  type CoreServices,
} from "./core-services.js";
import { registerGamingTools } from "./tools/register-gaming-tools.js";
import { registerAchievementTools } from "./tools/register-achievement-tools.js";
import { registerIntelligenceTools } from "./tools/register-intelligence-tools.js";
import { registerMetadataTools } from "./tools/register-metadata-tools.js";
import { registerSteamTools, type ToolRegistrar } from "./tools/register-steam-tools.js";
import { registerIntelligencePromptsAndResources } from "./intelligence-mcp-registration.js";
import { registerTaskResources, registerTaskTools } from "./tools/register-task-tools.js";

export type ServerOverrides = CoreServiceOverrides;

export type ServerRuntime = Readonly<{
  server: McpServer;
  close(): void;
}>;

type StartServerOptions = ServerOverrides &
  Readonly<{
    server?: Pick<McpServer, "connect">;
    transport?: Transport;
  }>;

export function createServerRuntime(overrides: ServerOverrides = {}): ServerRuntime {
  const services = createCoreServices(overrides);
  const server = createMcpServerFromServices(services);
  return Object.freeze({ server, close: services.close });
}

export function createServer(overrides: ServerOverrides = {}): McpServer {
  return createServerRuntime(overrides).server;
}

function createMcpServerFromServices(services: CoreServices): McpServer {
  const {
    steamService,
    achievementService,
    gamingTrackerService,
    metadataService,
    recommendationPreferencesService,
    playNowRecommendationService,
    backlogPlanService,
    taskRunner,
  } = services;
  const server = new McpServer({ name: "steam-library-mcp", version: "1.0.0" });

  registerSteamTools(server as unknown as ToolRegistrar, steamService);
  registerAchievementTools(server as unknown as ToolRegistrar, achievementService);
  registerGamingTools(server as unknown as ToolRegistrar, gamingTrackerService);
  registerMetadataTools(server as unknown as ToolRegistrar, metadataService);
  registerIntelligenceTools(server as unknown as ToolRegistrar, {
    preferences: recommendationPreferencesService,
    recommendations: playNowRecommendationService,
    plans: backlogPlanService,
  });
  registerTaskTools(server as unknown as ToolRegistrar, taskRunner);
  registerTaskResources(server, taskRunner);
  registerIntelligencePromptsAndResources(server, {
    preferences: recommendationPreferencesService,
    plans: backlogPlanService,
    steam: steamService,
  });
  return server;
}

export async function startStdioServer(options: StartServerOptions = {}): Promise<void> {
  const server = options.server ?? createServer(options);
  const transport = options.transport ?? new StdioServerTransport();
  await server.connect(transport);
}
