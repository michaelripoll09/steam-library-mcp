import { describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";

import { TtlCache } from "../src/cache/ttl-cache.js";
import { loadConfig, type IgdbConfig } from "../src/config.js";
import { createCoreServices } from "../src/core-services.js";
import { registerSteamTools, type ToolRegistrar } from "../src/tools/register-steam-tools.js";
import type { GameDurationService } from "../src/durations/game-duration-service.js";
import type { BacklogPlanService } from "../src/backlog/backlog-plan-service.js";
import type { BacklogSelectionService } from "../src/backlog/backlog-selection-service.js";
import type { PlayNowRecommendationService } from "../src/recommendations/play-now-recommendation-service.js";
import type { RecommendationPreferencesService } from "../src/recommendations/recommendation-preferences-service.js";
import type { MetadataService } from "../src/services/metadata-service.js";
import type { SteamService } from "../src/services/steam-service.js";
import type { AchievementService } from "../src/services/achievement-service.js";
import type { GamingTrackerService } from "../src/tracker/gaming-tracker-service.js";
import type { SteamApiClient } from "../src/steam/client.js";
import { openTrackerDatabase } from "../src/tracker/sqlite/database.js";

function withIgdbEnvironment<T>(run: () => Promise<T>): Promise<T> {
  const previousClientId = process.env.IGDB_CLIENT_ID;
  const previousClientSecret = process.env.IGDB_CLIENT_SECRET;
  process.env.IGDB_CLIENT_ID = "environment-client";
  process.env.IGDB_CLIENT_SECRET = "environment-secret";
  return run().finally(() => {
    if (previousClientId === undefined) delete process.env.IGDB_CLIENT_ID;
    else process.env.IGDB_CLIENT_ID = previousClientId;
    if (previousClientSecret === undefined) delete process.env.IGDB_CLIENT_SECRET;
    else process.env.IGDB_CLIENT_SECRET = previousClientSecret;
  });
}

function createIgdbFetch() {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === "https://id.twitch.tv/oauth2/token") {
      return new Response(
        JSON.stringify({ access_token: "test-token", token_type: "bearer", expires_in: 3600 }),
        { status: 200 },
      );
    }
    if (url === "https://api.igdb.com/v4/games") {
      return new Response(
        JSON.stringify([
          {
            id: 3,
            external_games: [{ category: 1, uid: "620" }],
            genres: [{ name: "Puzzle" }],
            keywords: [{ name: "Portal" }],
            themes: [{ name: "Science fiction" }],
            first_release_date: 1_300_000_000,
          },
        ]),
        { status: 200 },
      );
    }
    if (url === "https://api.igdb.com/v4/game_time_to_beats") {
      return new Response(
        JSON.stringify([{ game_id: 3, hastily: 5_400, normally: 7_200, completely: 9_000 }]),
        { status: 200 },
      );
    }
    throw new Error(`Unexpected request: ${url}; ${String(init?.method)}`);
  });
}

describe("core services", () => {
  test("opens one shared database for all default repositories", async () => {
    const database = openTrackerDatabase(":memory:");
    const config = loadConfig({
      STEAM_API_KEY: "test-api-key",
      STEAM_ID: "76561198000000000",
      TRACKER_DATABASE_PATH: join(tmpdir(), "unused-core-services.sqlite"),
    });
    const playNowRecommendationService: PlayNowRecommendationService = {
      recommend: async (request) => ({
        request: {
          ...(request as { availableMinutes: number; maxResults: number }),
          sessionMode: "solo" as const,
        },
        recommendations: [
          {
            appId: 10,
            name: "Shared Game",
            durationEstimateMinutes: 90,
            estimatedRemainingMinutes: 90,
            reasons: [],
            explanation: "Shared database test recommendation.",
          },
        ],
        exclusions: [],
      }),
    };
    const backlogSelectionService: BacklogSelectionService = {
      select: async () => ({
        selections: [
          {
            appId: 10,
            name: "Shared Game",
            durationEstimateMinutes: 90,
            estimatedRemainingMinutes: 90,
            explanation: "Shared database test selection.",
          },
        ],
        allocatedMinutes: 90,
        unallocatedMinutes: 30,
        exclusions: [],
      }),
    };
    const services = createCoreServices({
      database,
      config,
      steamClient: {
        getOwnedGames: async () => ({
          response: { games: [{ appid: 10, name: "Shared Game", playtime_forever: 0 }] },
        }),
        getRecentGames: async () => ({ response: { games: [] } }),
        getPlayerAchievements: async () => ({ playerstats: { success: false, achievements: [] } }),
        getAchievementSchema: async () => ({
          game: { gameName: "Shared Game", availableGameStats: { achievements: [] } },
        }),
      },
      cache: new TtlCache(),
      fetch: async () =>
        new Response(
          JSON.stringify({ 20: { success: true, data: { name: "Manual Shared Game" } } }),
        ),
      clock: { now: () => 0 },
      metadataService: {} as MetadataService,
      gameDurationService: {} as GameDurationService,
      playNowRecommendationService,
      backlogSelectionService,
    });

    try {
      await services.gamingTrackerService.mark(10, "playing");
      services.recommendationPreferencesService.save(10, {
        priority: "high",
        excludedFromRecommendations: false,
        playMode: "solo",
      });
      await services.steamService.addManualCollection?.({ steam: "20" });
      await services.backlogPlanService.create({
        cadence: "weekly",
        availableMinutes: 120,
        targetGameCount: 1,
      });

      expect(database.prepare("SELECT COUNT(*) AS count FROM tracker_entries").get()).toEqual({
        count: 1,
      });
      expect(
        database.prepare("SELECT COUNT(*) AS count FROM recommendation_preferences").get(),
      ).toEqual({ count: 1 });
      expect(database.prepare("SELECT COUNT(*) AS count FROM manual_library_games").get()).toEqual({
        count: 1,
      });
      expect(database.prepare("SELECT COUNT(*) AS count FROM backlog_plans").get()).toEqual({
        count: 1,
      });
    } finally {
      services.close?.();
      database.close();
    }
  });

  test("shares an absolute manual collection database across independently composed services", async () => {
    const directory = mkdtempSync(join(tmpdir(), "steam-library-core-parity-"));
    const config = loadConfig({
      STEAM_API_KEY: "test-api-key",
      STEAM_ID: "76561198000000000",
      TRACKER_DATABASE_PATH: join(directory, "tracker.sqlite"),
    });
    const createSteamClient = (): SteamApiClient => ({
      getOwnedGames: vi.fn(async () => ({
        response: { games: [{ appid: 620, name: "Portal 2", playtime_forever: 135 }] },
      })),
      getRecentGames: vi.fn(async () => ({ response: { games: [] } })),
      getPlayerAchievements: vi.fn(async () => ({
        playerstats: { success: false, achievements: [] },
      })),
      getAchievementSchema: vi.fn(async () => ({
        game: { gameName: "Portal 2", availableGameStats: { achievements: [] } },
      })),
    });
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ 413150: { success: true, data: { name: "Stardew Valley" } } }),
        ),
    );
    const dashboardServices = createCoreServices({
      config,
      steamClient: createSteamClient(),
      cache: new TtlCache(),
      fetch,
      clock: { now: () => 0 },
    });
    const mcpServices = createCoreServices({
      config,
      steamClient: createSteamClient(),
      cache: new TtlCache(),
      fetch,
      clock: { now: () => 0 },
    });
    const tools = new Map<
      string,
      (input: unknown) => Promise<{ isError?: boolean; content: readonly { text: string }[] }>
    >();
    const registrar: ToolRegistrar = {
      registerTool(name, _configuration, handler) {
        tools.set(
          name,
          handler as (
            input: unknown,
          ) => Promise<{ isError?: boolean; content: readonly { text: string }[] }>,
        );
      },
    };
    registerSteamTools(registrar, mcpServices.steamService);

    try {
      await mcpServices.steamService.getLibrary();
      await dashboardServices.steamService.addManualCollection?.({ steam: "413150" });
      await expect(tools.get("steam_get_library")?.({})).resolves.toMatchObject({
        content: [expect.objectContaining({ text: expect.stringContaining('"appId":413150') })],
      });
      await expect(tools.get("steam_get_manual_collection")?.({})).resolves.toMatchObject({
        content: [expect.objectContaining({ text: expect.stringContaining('"appId":413150') })],
      });
      await expect(
        tools.get("steam_remove_manual_collection")?.({ appId: 413150 }),
      ).resolves.toEqual({
        content: [{ type: "text", text: "true" }],
      });
      await expect(dashboardServices.steamService.searchLibrary("Stardew")).resolves.toEqual([]);
      await expect(
        tools.get("steam_add_manual_collection")?.({ steam: "413150" }),
      ).resolves.toMatchObject({
        content: [expect.objectContaining({ text: expect.stringContaining('"appId":413150') })],
      });
      await expect(
        tools.get("steam_remove_manual_collection")?.({ appId: 0 }),
      ).resolves.toMatchObject({
        isError: true,
        content: [expect.objectContaining({ text: expect.stringContaining("INPUT_INVALID") })],
      });
    } finally {
      try {
        rmSync(directory, { recursive: true, force: true });
      } catch {
        // Better-sqlite3 connections are released when the test worker exits.
      }
    }
  });

  test("cancels default sync fetch before the refreshed library can update cache", async () => {
    const database = openTrackerDatabase(":memory:");
    let markFetchStarted!: () => void;
    let markAbortObserved!: () => void;
    let rejectFirstFetch!: (error: Error) => void;
    const fetchStarted = new Promise<void>((resolve) => {
      markFetchStarted = resolve;
    });
    const abortObserved = new Promise<void>((resolve) => {
      markAbortObserved = resolve;
    });
    const firstFetch = new Promise<Response>((_resolve, reject) => {
      rejectFirstFetch = reject;
    });
    const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (fetch.mock.calls.length === 1) {
        markFetchStarted();
        const signal = init?.signal;
        const rejectOnAbort = () => {
          markAbortObserved();
          rejectFirstFetch(new DOMException("The operation was aborted.", "AbortError"));
        };
        if (signal?.aborted) rejectOnAbort();
        else signal?.addEventListener("abort", rejectOnAbort, { once: true });
        return firstFetch;
      }
      return new Response(JSON.stringify({ response: { games: [] } }), { status: 200 });
    });
    const services = createCoreServices({
      config: loadConfig({ STEAM_API_KEY: "test-key", STEAM_ID: "test-steam-id" }),
      database,
      fetch: fetch as unknown as typeof globalThis.fetch,
      clock: { now: () => 0 },
    });

    try {
      const task = services.taskRunner.enqueue({ type: "sync_library" });
      await fetchStarted;
      const signal = fetch.mock.calls[0]?.[1]?.signal;
      expect(signal).toBeInstanceOf(AbortSignal);
      services.taskRunner.cancel(task.id);

      expect(services.taskRunner.get(task.id)).toMatchObject({ state: "cancelled", error: null });
      expect(signal?.aborted).toBe(true);
      await abortObserved;
    } finally {
      rejectFirstFetch(new DOMException("Test cleanup.", "AbortError"));
      await firstFetch.catch(() => undefined);
      services.close();
    }
  });

  test("explicitly disabled IGDB configuration beats valid environment credentials for metadata and duration", async () => {
    await withIgdbEnvironment(async () => {
      const fetch = vi.fn(async () => {
        throw new Error("IGDB fetch must not run when explicitly disabled");
      });
      const database = openTrackerDatabase(":memory:");
      const steamService = {
        getGame: vi.fn(async (appId: number) => ({
          appId,
          name: "Portal 2",
          playtimeMinutes: 0,
        })),
      } as unknown as SteamService;
      const igdbConfig: IgdbConfig = { enabled: false };
      const services = createCoreServices({
        config: loadConfig({ STEAM_API_KEY: "test-key", STEAM_ID: "test-id" }),
        database,
        steamService,
        fetch: fetch as unknown as typeof globalThis.fetch,
        igdbConfig,
      });

      try {
        await expect(services.metadataService.getOwnedGameMetadata(620)).resolves.toMatchObject({
          isError: true,
          error: { code: "METADATA_UNAVAILABLE" },
        });
        await expect(
          services.gameDurationService.getEstimate({
            appId: 620,
            name: "Portal 2",
            playtimeMinutes: 0,
          }),
        ).resolves.toMatchObject({
          isError: true,
          error: { code: "DURATION_UNAVAILABLE" },
        });
        expect(fetch).not.toHaveBeenCalled();
      } finally {
        services.close();
        database.close();
      }
    });
  });

  test("uses enabled injected IGDB credentials for metadata and duration without environment credentials", async () => {
    const previousClientId = process.env.IGDB_CLIENT_ID;
    const previousClientSecret = process.env.IGDB_CLIENT_SECRET;
    try {
      delete process.env.IGDB_CLIENT_ID;
      delete process.env.IGDB_CLIENT_SECRET;
      const fetch = createIgdbFetch();
      const database = openTrackerDatabase(":memory:");
      const steamService = {
        getGame: vi.fn(async (appId: number) => ({
          appId,
          name: "Portal 2",
          playtimeMinutes: 0,
        })),
      } as unknown as SteamService;
      const igdbConfig: IgdbConfig = {
        enabled: true,
        clientId: "injected-client",
        clientSecret: "injected-secret",
      };
      const services = createCoreServices({
        config: loadConfig({ STEAM_API_KEY: "test-key", STEAM_ID: "test-id" }),
        database,
        steamService,
        fetch: fetch as unknown as typeof globalThis.fetch,
        igdbConfig,
      });

      try {
        const [metadata, duration] = await Promise.all([
          services.metadataService.getOwnedGameMetadata(620),
          services.gameDurationService.getEstimate({
            appId: 620,
            name: "Portal 2",
            playtimeMinutes: 0,
          }),
        ]);
        expect.soft(metadata).toMatchObject({ metadataStatus: "complete" });
        expect.soft(duration).toMatchObject({ appId: 620, source: "igdb" });
        const tokenRequest = fetch.mock.calls.find(
          ([input]) => String(input) === "https://id.twitch.tv/oauth2/token",
        );
        expect.soft(String(tokenRequest?.[1]?.body)).toContain("client_id=injected-client");
        expect.soft(String(tokenRequest?.[1]?.body)).toContain("client_secret=injected-secret");
        const igdbRequests = fetch.mock.calls.filter(([input]) =>
          String(input).startsWith("https://api.igdb.com/"),
        );
        expect.soft(igdbRequests.length).toBeGreaterThan(0);
        for (const [, init] of igdbRequests) {
          expect(new Headers(init?.headers).get("Client-ID")).toBe("injected-client");
        }
      } finally {
        services.close();
        database.close();
      }
    } finally {
      if (previousClientId === undefined) delete process.env.IGDB_CLIENT_ID;
      else process.env.IGDB_CLIENT_ID = previousClientId;
      if (previousClientSecret === undefined) delete process.env.IGDB_CLIENT_SECRET;
      else process.env.IGDB_CLIENT_SECRET = previousClientSecret;
    }
  });

  test("reuses injected services without reading environment or opening tracker storage", () => {
    const steamService = {} as SteamService;
    const achievementService = {} as AchievementService;
    const gamingTrackerService = {} as GamingTrackerService;
    const recommendationPreferencesService = {} as RecommendationPreferencesService;
    const metadataService = {} as MetadataService;
    const gameDurationService = {} as GameDurationService;
    const playNowRecommendationService = {} as PlayNowRecommendationService;
    const backlogPlanService = {} as BacklogPlanService;
    const backlogSelectionService = {} as BacklogSelectionService;

    const services = createCoreServices({
      steamService,
      achievementService,
      gamingTrackerService,
      recommendationPreferencesService,
      metadataService,
      gameDurationService,
      playNowRecommendationService,
      backlogPlanService,
      backlogSelectionService,
    });

    expect(services).toMatchObject({
      steamService,
      achievementService,
      gamingTrackerService,
      recommendationPreferencesService,
      metadataService,
      gameDurationService,
      playNowRecommendationService,
      backlogPlanService,
      backlogSelectionService,
    });
    expect(services.taskRunner.list()).toEqual([]);
  });
});
