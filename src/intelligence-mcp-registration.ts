import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GetPromptResult } from "@modelcontextprotocol/sdk/types.js";

import type { BacklogPlanService } from "./backlog/backlog-plan-service.js";
import {
  BACKLOG_MAX_AVAILABLE_MINUTES,
  BACKLOG_MAX_TARGET_GAME_COUNT,
  PLAY_NOW_MAX_AVAILABLE_MINUTES,
} from "./domain/input-limits.js";
import { AppError, InputError, SteamUnavailableError } from "./errors.js";
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
    ({ availableMinutes }) => {
      const minutes = parseBoundedPositiveIntegerPromptArgument(
        availableMinutes,
        PLAY_NOW_MAX_AVAILABLE_MINUTES,
        "availableMinutes",
      );
      return prompt(
        `Use recommendation_get_play_now with availableMinutes ${minutes} for this play session; treat duration as a secondary finishability signal rather than requiring the entire game to fit. Include a suitable maxResults, explain the ranked choices, and note any unknown durations.`,
      );
    },
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
        `Use backlog_create_plan with cadence weekly, availableMinutes ${parseBoundedPositiveIntegerPromptArgument(availableMinutes, BACKLOG_MAX_AVAILABLE_MINUTES, "availableMinutes")} as the total weekly time budget, and targetGameCount ${parseBoundedPositiveIntegerPromptArgument(targetGameCount, BACKLOG_MAX_TARGET_GAME_COUNT, "targetGameCount")}. Summarize the selected games and any shortfall.`,
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
        `Use backlog_create_plan with cadence monthly, availableMinutes ${parseBoundedPositiveIntegerPromptArgument(availableMinutes, BACKLOG_MAX_AVAILABLE_MINUTES, "availableMinutes")} as the total monthly time budget, and targetGameCount ${parseBoundedPositiveIntegerPromptArgument(targetGameCount, BACKLOG_MAX_TARGET_GAME_COUNT, "targetGameCount")}. Summarize the selected games and any shortfall.`,
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

export function parseBoundedPositiveIntegerPromptArgument(
  value: unknown,
  max: number,
  label: string,
): number {
  if (typeof value !== "string") {
    throw new InputError(`${label} must be a positive integer within the supported range.`);
  }
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new InputError(`${label} must be a positive integer within the supported range.`);
  }
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
    throw new InputError(`${label} must be a positive integer within the supported range.`);
  }
  return parsed;
}

function safeError(error: unknown): object {
  return error instanceof AppError ? error.toJSON() : new SteamUnavailableError(error).toJSON();
}
