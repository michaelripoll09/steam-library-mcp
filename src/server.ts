import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import { createCoreServices, type CoreServiceOverrides } from "./core-services.js";
import { registerGamingTools } from "./tools/register-gaming-tools.js";
import { registerIntelligenceTools } from "./tools/register-intelligence-tools.js";
import { registerMetadataTools } from "./tools/register-metadata-tools.js";
import { registerSteamTools, type ToolRegistrar } from "./tools/register-steam-tools.js";
import { registerIntelligencePromptsAndResources } from "./intelligence-mcp-registration.js";

export type ServerOverrides = CoreServiceOverrides;

type StartServerOptions = ServerOverrides &
  Readonly<{
    server?: Pick<McpServer, "connect">;
    transport?: Transport;
  }>;

export function createServer(overrides: ServerOverrides = {}): McpServer {
  const {
    steamService,
    gamingTrackerService,
    metadataService,
    recommendationPreferencesService,
    playNowRecommendationService,
    backlogPlanService,
  } = createCoreServices(overrides);
  const server = new McpServer({ name: "steam-library-mcp", version: "0.1.0" });

  registerSteamTools(server as unknown as ToolRegistrar, steamService);
  registerGamingTools(server as unknown as ToolRegistrar, gamingTrackerService);
  registerMetadataTools(server as unknown as ToolRegistrar, metadataService);
  registerIntelligenceTools(server as unknown as ToolRegistrar, {
    preferences: recommendationPreferencesService,
    recommendations: playNowRecommendationService,
    plans: backlogPlanService,
  });
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
