import { z } from "zod";

import type { BacklogPlanService } from "../backlog/backlog-plan-service.js";
import { BACKLOG_PLAN_CADENCES, BACKLOG_PLAN_ITEM_PROGRESS } from "../domain/backlog-plan.js";
import { PLAY_MODES, RECOMMENDATION_PRIORITIES } from "../domain/recommendation-preferences.js";
import { AppError, InputError, SteamUnavailableError } from "../errors.js";
import type { PlayNowRecommendationService } from "../recommendations/play-now-recommendation-service.js";
import type { RecommendationPreferencesService } from "../recommendations/recommendation-preferences-service.js";
import type { ToolRegistrar } from "./register-steam-tools.js";

const appIdSchema = z.number().int().safe().positive();
const getPreferenceSchema = z.object({ appId: appIdSchema }).strict();
const setPreferenceSchema = z
  .object({
    appId: appIdSchema,
    priority: z.enum(RECOMMENDATION_PRIORITIES),
    excludedFromRecommendations: z.boolean(),
    playMode: z.enum(PLAY_MODES),
  })
  .strict();
const playNowSchema = z
  .object({
    availableMinutes: z.number().int().safe().positive(),
    maxResults: z.number().int().safe().positive(),
    sessionMode: z.enum(["solo", "with_friends", "any"]).default("solo"),
  })
  .strict();
const createPlanSchema = z
  .object({
    cadence: z.enum(BACKLOG_PLAN_CADENCES),
    availableMinutes: z.number().int().safe().positive(),
    targetGameCount: z.number().int().safe().positive(),
  })
  .strict();
const listPlansSchema = z.object({}).strict();
const updatePlanItemSchema = z
  .object({
    planId: z.string().trim().min(1),
    itemId: z.string().trim().min(1),
    progress: z.enum(BACKLOG_PLAN_ITEM_PROGRESS),
  })
  .strict();

type ToolResult = Readonly<{
  content: readonly Readonly<{ type: "text"; text: string }>[];
  isError?: boolean;
}>;

type IntelligenceServices = Readonly<{
  preferences: RecommendationPreferencesService;
  recommendations: PlayNowRecommendationService;
  plans: BacklogPlanService;
}>;

export function registerIntelligenceTools(
  server: ToolRegistrar,
  services: IntelligenceServices,
): void {
  register(
    server,
    "recommendation_get_game_preference",
    "Get the recommendation preference stored for one Steam game.",
    getPreferenceSchema,
    ({ appId }) => services.preferences.get(appId),
  );
  register(
    server,
    "recommendation_set_game_preference",
    "Explicitly save a recommendation preference for one Steam game. This does not change Steam or tracker status.",
    setPreferenceSchema,
    ({ appId, priority, excludedFromRecommendations, playMode }) =>
      services.preferences.save(appId, { priority, excludedFromRecommendations, playMode }),
    false,
  );
  register(
    server,
    "recommendation_get_play_now",
    "Get play-now recommendations using stored preferences, tracker status, and safe duration estimates.",
    playNowSchema,
    (request) => services.recommendations.recommend(request),
  );
  register(
    server,
    "backlog_create_plan",
    "Explicitly create a weekly or monthly backlog plan. This does not change Steam or tracker status.",
    createPlanSchema,
    (request) => services.plans.create(request),
    false,
  );
  register(
    server,
    "backlog_list_active_plans",
    "List active local backlog plans.",
    listPlansSchema,
    () => services.plans.listActive(),
  );
  register(
    server,
    "backlog_update_plan_item_progress",
    "Explicitly update a backlog plan item progress value. This does not change Steam or tracker status.",
    updatePlanItemSchema,
    ({ planId, itemId, progress }) => services.plans.setItemProgress(planId, itemId, progress),
    false,
  );
}

function register<TInput extends object>(
  server: ToolRegistrar,
  name: string,
  description: string,
  schema: z.ZodType<TInput>,
  operation: (input: TInput) => unknown | Promise<unknown>,
  readOnlyHint = true,
): void {
  server.registerTool(
    name,
    { description, inputSchema: schema, annotations: { readOnlyHint } },
    async (input): Promise<ToolResult> => {
      try {
        const value = await operation(schema.parse(input));
        return { content: [{ type: "text", text: JSON.stringify(value) }] };
      } catch (error) {
        const safe = toSafeError(error);
        return { content: [{ type: "text", text: JSON.stringify(safe) }], isError: true };
      }
    },
  );
}

function toSafeError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof z.ZodError) {
    return new InputError(error.issues[0]?.message ?? "Tool arguments are invalid.");
  }
  return new SteamUnavailableError(error);
}
