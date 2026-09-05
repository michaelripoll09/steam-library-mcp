import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, test, vi } from "vitest";

import type { BacklogPlanService } from "../src/backlog/backlog-plan-service.js";
import { TtlCache } from "../src/cache/ttl-cache.js";
import { loadConfig } from "../src/config.js";
import type { GameDurationService } from "../src/durations/game-duration-service.js";
import type { PlayNowRecommendationService } from "../src/recommendations/play-now-recommendation-service.js";
import type { RecommendationPreferencesService } from "../src/recommendations/recommendation-preferences-service.js";
import { createServer } from "../src/server.js";
import type { SteamApiClient } from "../src/steam/client.js";
import type { GamingTrackerService } from "../src/tracker/gaming-tracker-service.js";

const config = loadConfig({ STEAM_API_KEY: "secret", STEAM_ID: "76561198000000000" });

function createServerForRegistration(preferencesUnavailable = false) {
  const steamClient: SteamApiClient = {
    getOwnedGames: vi.fn(async () => ({ response: { games: [] } })),
    getRecentGames: vi.fn(async () => ({ response: { games: [] } })),
  };
  const preferences: RecommendationPreferencesService = {
    get: vi.fn((appId) => ({
      appId: appId as number,
      priority: "normal",
      excludedFromRecommendations: false,
      playMode: "any",
    })),
    save: vi.fn(),
    list: vi.fn(() => {
      if (preferencesUnavailable) throw new Error("sqlite C:/private/secret-token.db");
      return [
        { appId: 620, priority: "high", excludedFromRecommendations: false, playMode: "solo" },
      ];
    }),
  } as unknown as RecommendationPreferencesService;
  const recommendations: PlayNowRecommendationService = {
    recommend: vi.fn(async (request) => ({
      request: request as {
        availableMinutes: number;
        maxResults: number;
        sessionMode: "solo" | "with_friends" | "any";
      },
      recommendations: [],
      exclusions: [],
    })),
  };
  const plans: BacklogPlanService = {
    create: vi.fn(),
    get: vi.fn(),
    listActive: vi.fn(() => [{ id: "weekly-1", cadence: "weekly", items: [] }]),
    setItemProgress: vi.fn(),
  } as unknown as BacklogPlanService;
  const tracker: GamingTrackerService = {
    getBacklog: vi.fn(async () => []),
    getCurrentGame: vi.fn(async () => null),
    getCompleted: vi.fn(async () => []),
    getStatuses: vi.fn(async () => []),
    mark: vi.fn(),
  };
  const duration: GameDurationService = { getEstimate: vi.fn() };
  return createServer({
    config,
    steamClient,
    cache: new TtlCache(),
    clock: { now: () => 0 },
    gamingTrackerService: tracker,
    recommendationPreferencesService: preferences,
    playNowRecommendationService: recommendations,
    backlogPlanService: plans,
    gameDurationService: duration,
  });
}

describe("intelligence MCP prompts and resources", () => {
  test("registers reusable planning prompts without issuing service calls", async () => {
    const server = createServerForRegistration();
    const client = new Client({ name: "test", version: "1.0.0" });
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    await expect(client.listPrompts()).resolves.toMatchObject({
      prompts: [
        { name: "play-now" },
        { name: "weekly-plan" },
        { name: "monthly-plan" },
        { name: "backlog-review" },
      ],
    });
    await expect(
      client.getPrompt({ name: "play-now", arguments: { availableMinutes: "60" } }),
    ).resolves.toMatchObject({
      messages: [
        {
          role: "user",
          content: { type: "text", text: expect.stringContaining("recommendation_get_play_now") },
        },
      ],
    });
    await client.close();
    await server.close();
  });

  test("clarifies session finishability and total planning budgets", async () => {
    const server = createServerForRegistration();
    const client = new Client({ name: "test", version: "1.0.0" });
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const tools = await client.listTools();
    expect(tools.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "recommendation_get_play_now",
          description:
            "Recommend games for the current play session using tracker state, preferences, session mode, and duration as a secondary finishability signal.",
        }),
        expect.objectContaining({
          name: "backlog_create_plan",
          description:
            "Create a weekly or monthly local backlog plan whose selected games fit within the requested total time budget when duration estimates are available.",
        }),
      ]),
    );

    const playNowPrompt = await client.getPrompt({
      name: "play-now",
      arguments: { availableMinutes: "60" },
    });
    const playNowText = playNowPrompt.messages[0]?.content;
    expect(playNowText).toMatchObject({ type: "text" });
    if (playNowText?.type === "text") {
      expect(playNowText.text).toContain("secondary finishability signal");
      expect(playNowText.text).not.toMatch(/entire game must fit/i);
    }

    const weeklyPrompt = await client.getPrompt({
      name: "weekly-plan",
      arguments: { availableMinutes: "300", targetGameCount: "3" },
    });
    const weeklyText = weeklyPrompt.messages[0]?.content;
    expect(weeklyText).toMatchObject({ type: "text" });
    if (weeklyText?.type === "text") {
      expect(weeklyText.text).toContain("total weekly time budget");
    }

    const monthlyPrompt = await client.getPrompt({
      name: "monthly-plan",
      arguments: { availableMinutes: "1200", targetGameCount: "5" },
    });
    const monthlyText = monthlyPrompt.messages[0]?.content;
    expect(monthlyText).toMatchObject({ type: "text" });
    if (monthlyText?.type === "text") {
      expect(monthlyText.text).toContain("total monthly time budget");
    }

    await client.close();
    await server.close();
  });

  test("registers local, read-only resources with sanitized snapshots", async () => {
    const server = createServerForRegistration();
    const client = new Client({ name: "test", version: "1.0.0" });
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const resources = await client.listResources();
    expect(resources.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ uri: "steam-library://intelligence/preferences" }),
        expect.objectContaining({ uri: "steam-library://intelligence/active-plans" }),
        expect.objectContaining({ uri: "steam-library://intelligence/library-insights" }),
      ]),
    );
    await expect(
      client.readResource({ uri: "steam-library://intelligence/preferences" }),
    ).resolves.toMatchObject({
      contents: [
        {
          uri: "steam-library://intelligence/preferences",
          mimeType: "application/json",
          text: expect.stringContaining('"appId":620'),
        },
      ],
    });
    await expect(
      client.readResource({ uri: "steam-library://intelligence/active-plans" }),
    ).resolves.toMatchObject({
      contents: [{ text: expect.stringContaining('"weekly-1"') }],
    });
    const insights = await client.readResource({
      uri: "steam-library://intelligence/library-insights",
    });
    expect(JSON.stringify(insights)).not.toContain("secret");
    await client.close();
    await server.close();
  });

  test("defaults play-now session mode to solo and accepts with_friends", async () => {
    const server = createServerForRegistration();
    const client = new Client({ name: "test", version: "1.0.0" });
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const withFriends = await client.callTool({
      name: "recommendation_get_play_now",
      arguments: { availableMinutes: 60, maxResults: 3, sessionMode: "with_friends" },
    });
    const defaultMode = await client.callTool({
      name: "recommendation_get_play_now",
      arguments: { availableMinutes: 60, maxResults: 3 },
    });

    expect(withFriends.isError).toBeUndefined();
    expect(JSON.stringify(withFriends)).toContain('\\"sessionMode\\":\\"with_friends\\"');
    expect(defaultMode.isError).toBeUndefined();
    expect(JSON.stringify(defaultMode)).toContain('\\"sessionMode\\":\\"solo\\"');

    await client.close();
    await server.close();
  });

  test("returns a safe local envelope when a resource snapshot is unavailable", async () => {
    const server = createServerForRegistration(true);
    const client = new Client({ name: "test", version: "1.0.0" });
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.readResource({ uri: "steam-library://intelligence/preferences" });
    const firstContent = result.contents[0];
    const text = firstContent !== undefined && "text" in firstContent ? firstContent.text : "";
    expect(text).toContain('"code":"STEAM_UNAVAILABLE"');
    expect(text).not.toContain("secret-token");

    await client.close();
    await server.close();
  });
});
