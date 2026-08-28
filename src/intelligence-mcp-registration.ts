import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GetPromptResult } from "@modelcontextprotocol/sdk/types.js";

import type { BacklogPlanService } from "./backlog/backlog-plan-service.js";
import { AppError, SteamUnavailableError } from "./errors.js";
import type { RecommendationPreferencesService } from "./recommendations/recommendation-preferences-service.js";
import type { SteamService } from "./services/steam-service.js";

const preferencesUri = "steam-library://intelligence/preferences";
const activePlansUri = "steam-library://intelligence/active-plans";
const libraryInsightsUri = "steam-library://intelligence/library-insights";

type IntelligenceResourceServices = Readonly<{
  preferences: RecommendationPreferencesService;
  plans: BacklogPlanService;
  steam: Pick<SteamService, "getLibraryStats">;
}>;

export function registerIntelligencePromptsAndResources(
  server: Pick<McpServer, "registerPrompt" | "registerResource">,
  services: IntelligenceResourceServices,
): void {
  server.registerPrompt(
    "play-now",
    {
      description: "Compose a user request for a time-boxed play-now recommendation.",
      argsSchema: { availableMinutes: z.string().trim().min(1) },
    },
    ({ availableMinutes }) =>
      prompt(
        `Use recommendation_get_play_now with availableMinutes ${availableMinutes} and a suitable maxResults. Explain the ranked choices and note any unknown durations.`,
      ),
  );
  server.registerPrompt(
    "weekly-plan",
    {
      description: "Compose a user request for a weekly backlog plan.",
      argsSchema: {
        availableMinutes: z.string().trim().min(1),
        targetGameCount: z.string().trim().min(1),
      },
    },
    ({ availableMinutes, targetGameCount }) =>
      prompt(
        `Use backlog_create_plan with cadence weekly, availableMinutes ${availableMinutes}, and targetGameCount ${targetGameCount}. Summarize the selected games and any shortfall.`,
      ),
  );
  server.registerPrompt(
    "monthly-plan",
    {
      description: "Compose a user request for a monthly backlog plan.",
      argsSchema: {
        availableMinutes: z.string().trim().min(1),
        targetGameCount: z.string().trim().min(1),
      },
    },
    ({ availableMinutes, targetGameCount }) =>
      prompt(
        `Use backlog_create_plan with cadence monthly, availableMinutes ${availableMinutes}, and targetGameCount ${targetGameCount}. Summarize the selected games and any shortfall.`,
      ),
  );
  server.registerPrompt(
    "backlog-review",
    { description: "Compose a user request to review local active backlog plans." },
    () =>
      prompt(
        "Use backlog_list_active_plans and summarize progress, stalled items, and the next practical action. Do not modify tracker or Steam status.",
      ),
  );

  registerJsonResource(
    server,
    "current-preferences",
    preferencesUri,
    "Read-only local recommendation preferences.",
    () => services.preferences.list(),
  );
  registerJsonResource(
    server,
    "active-backlog-plans",
    activePlansUri,
    "Read-only local active backlog plans.",
    () => services.plans.listActive(),
  );
  registerJsonResource(
    server,
    "library-insight-snapshot",
    libraryInsightsUri,
    "A concise normalized library insight snapshot.",
    async () => {
      try {
        return { library: await services.steam.getLibraryStats() };
      } catch (error) {
        return { error: safeError(error) };
      }
    },
  );
}

function registerJsonResource(
  server: Pick<McpServer, "registerPrompt" | "registerResource">,
  name: string,
  uri: string,
  description: string,
  getValue: () => unknown | Promise<unknown>,
): void {
  server.registerResource(name, uri, { description, mimeType: "application/json" }, async () => {
    let value: unknown;
    try {
      value = await getValue();
    } catch (error) {
      value = { error: safeError(error) };
    }
    return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(value) }] };
  });
}

function prompt(text: string): GetPromptResult {
  return { messages: [{ role: "user", content: { type: "text", text } }] };
}

function safeError(error: unknown): object {
  return error instanceof AppError ? error.toJSON() : new SteamUnavailableError(error).toJSON();
}
