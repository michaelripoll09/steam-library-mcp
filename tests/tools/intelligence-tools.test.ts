import { describe, expect, test, vi } from "vitest";

import type { BacklogPlanService } from "../../src/backlog/backlog-plan-service.js";
import { InputError } from "../../src/errors.js";
import type { PlayNowRecommendationService } from "../../src/recommendations/play-now-recommendation-service.js";
import type { RecommendationPreferencesService } from "../../src/recommendations/recommendation-preferences-service.js";
import { registerIntelligenceTools } from "../../src/tools/register-intelligence-tools.js";
import type { ToolRegistrar } from "../../src/tools/register-steam-tools.js";
import type { GamingTrackerService } from "../../src/tracker/gaming-tracker-service.js";

type Result = { content: readonly { type: "text"; text: string }[]; isError?: boolean };

function setup() {
  const tools = new Map<string, (input: unknown) => Promise<Result>>();
  const configurations = new Map<string, { inputSchema?: unknown; annotations?: unknown }>();
  const registrar: ToolRegistrar = {
    registerTool(name, config, handler) {
      tools.set(name, handler);
      configurations.set(name, config);
    },
  };
  const preferences: RecommendationPreferencesService = {
    get: vi.fn(() => ({
      appId: 620,
      priority: "normal" as const,
      excludedFromRecommendations: false,
      playMode: "any" as const,
    })),
    list: vi.fn(() => []),
    save: vi.fn((appId, preference) => ({
      appId: appId as number,
      ...(preference as {
        priority: "normal" | "high";
        excludedFromRecommendations: boolean;
        playMode: "any" | "solo" | "with_friends";
      }),
    })),
  };
  const recommendations: PlayNowRecommendationService = {
    recommend: vi.fn(async () => ({
      request: { availableMinutes: 60, maxResults: 3, sessionMode: "solo" as const },
      recommendations: [
        {
          appId: 620,
          name: "Portal 2",
          durationEstimateMinutes: null,
          estimatedRemainingMinutes: null,
          reasons: [{ code: "duration_unknown" as const }],
          explanation:
            "Duration is unknown, so this is a lower-confidence fit for your 60 minutes.",
        },
      ],
      exclusions: [],
    })),
  };
  const plans: BacklogPlanService = {
    create: vi.fn(async () => ({
      plan: { id: "weekly-1", cadence: "weekly", items: [], lifecycle: "active" },
      shortfall: null,
    })),
    get: vi.fn(),
    listActive: vi.fn(() => []),
    setItemProgress: vi.fn(async () => ({ id: "weekly-1:1", progress: "in_progress" })),
  } as unknown as BacklogPlanService;
  const tracker: GamingTrackerService = {
    getBacklog: vi.fn(async () => []),
    getCurrentGame: vi.fn(async () => null),
    getCompleted: vi.fn(async () => []),
    getStatuses: vi.fn(async () => []),
    mark: vi.fn(),
  };
  registerIntelligenceTools(registrar, { preferences, recommendations, plans });
  return { configurations, plans, preferences, recommendations, tools, tracker };
}

describe("intelligence MCP tools", () => {
  test("registers six strict preference, recommendation, and backlog tools", () => {
    const { configurations, tools } = setup();

    expect([...tools.keys()]).toEqual([
      "recommendation_get_game_preference",
      "recommendation_set_game_preference",
      "recommendation_get_play_now",
      "backlog_create_plan",
      "backlog_list_active_plans",
      "backlog_update_plan_item_progress",
    ]);
    const preferenceSchema = configurations.get("recommendation_get_game_preference")
      ?.inputSchema as {
      safeParse(value: unknown): { success: boolean };
    };
    const listPlansSchema = configurations.get("backlog_list_active_plans")?.inputSchema as {
      safeParse(value: unknown): { success: boolean };
    };
    expect(preferenceSchema.safeParse({ appId: 620 }).success).toBe(true);
    expect(preferenceSchema.safeParse({ appId: 0 }).success).toBe(false);
    expect(listPlansSchema.safeParse({ unexpected: true }).success).toBe(false);
  });

  test("validates tool input before preference and planning mutations", async () => {
    const { plans, preferences, recommendations, tools } = setup();

    await expect(
      tools.get("recommendation_set_game_preference")?.({ appId: 0 }),
    ).resolves.toMatchObject({
      isError: true,
    });
    await expect(
      tools.get("recommendation_get_play_now")?.({ availableMinutes: 0, maxResults: 3 }),
    ).resolves.toMatchObject({
      isError: true,
    });
    await expect(
      tools.get("backlog_create_plan")?.({
        cadence: "daily",
        availableMinutes: 60,
        targetGameCount: 1,
      }),
    ).resolves.toMatchObject({
      isError: true,
    });
    await expect(
      tools.get("backlog_update_plan_item_progress")?.({
        planId: "",
        itemId: "one",
        progress: "done",
      }),
    ).resolves.toMatchObject({
      isError: true,
    });

    expect(preferences.save).not.toHaveBeenCalled();
    expect(recommendations.recommend).not.toHaveBeenCalled();
    expect(plans.create).not.toHaveBeenCalled();
    expect(plans.setItemProgress).not.toHaveBeenCalled();
  });

  test("writes only through explicit mutation tools and never touch tracker status", async () => {
    const { plans, preferences, tools, tracker } = setup();

    await expect(
      tools.get("recommendation_set_game_preference")?.({
        appId: 620,
        priority: "high",
        excludedFromRecommendations: true,
        playMode: "solo",
      }),
    ).resolves.toMatchObject({ content: [{ text: expect.stringContaining('"appId":620') }] });
    await tools.get("backlog_create_plan")?.({
      cadence: "weekly",
      availableMinutes: 120,
      targetGameCount: 3,
    });
    await tools.get("backlog_update_plan_item_progress")?.({
      planId: "weekly-1",
      itemId: "weekly-1:1",
      progress: "in_progress",
    });

    expect(preferences.save).toHaveBeenCalledWith(620, {
      priority: "high",
      excludedFromRecommendations: true,
      playMode: "solo",
    });
    expect(plans.create).toHaveBeenCalledWith({
      cadence: "weekly",
      availableMinutes: 120,
      targetGameCount: 3,
    });
    expect(plans.setItemProgress).toHaveBeenCalledWith("weekly-1", "weekly-1:1", "in_progress");
    expect(tracker.mark).not.toHaveBeenCalled();
  });

  test("returns lower-confidence recommendations when duration data is unavailable and sanitizes failures", async () => {
    const { recommendations, tools } = setup();
    await expect(
      tools.get("recommendation_get_play_now")?.({ availableMinutes: 60, maxResults: 3 }),
    ).resolves.toMatchObject({
      content: [{ text: expect.stringContaining('"duration_unknown"') }],
    });

    vi.mocked(recommendations.recommend).mockRejectedValueOnce(
      new Error("IGDB_CLIENT_SECRET=private"),
    );
    const failure = await tools.get("recommendation_get_play_now")?.({
      availableMinutes: 60,
      maxResults: 3,
    });
    expect(failure).toMatchObject({ isError: true });
    expect(failure?.content[0]?.text).not.toContain("IGDB_CLIENT_SECRET");
  });

  test("preserves safe application errors", async () => {
    const { plans, tools } = setup();
    vi.mocked(plans.create).mockRejectedValueOnce(
      new InputError("The requested plan item does not exist."),
    );

    await expect(
      tools.get("backlog_create_plan")?.({
        cadence: "weekly",
        availableMinutes: 60,
        targetGameCount: 1,
      }),
    ).resolves.toMatchObject({
      isError: true,
      content: [{ text: expect.stringContaining("The requested plan item does not exist.") }],
    });
  });
});
