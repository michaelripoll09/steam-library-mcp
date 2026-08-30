import { describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";

import { TtlCache } from "../src/cache/ttl-cache.js";
import { loadConfig } from "../src/config.js";
import { createCoreServices } from "../src/core-services.js";
import { registerSteamTools, type ToolRegistrar } from "../src/tools/register-steam-tools.js";
import type { GameDurationService } from "../src/durations/game-duration-service.js";
import type { BacklogPlanService } from "../src/backlog/backlog-plan-service.js";
import type { PlayNowRecommendationService } from "../src/recommendations/play-now-recommendation-service.js";
import type { RecommendationPreferencesService } from "../src/recommendations/recommendation-preferences-service.js";
import type { MetadataService } from "../src/services/metadata-service.js";
import type { SteamService } from "../src/services/steam-service.js";
import type { GamingTrackerService } from "../src/tracker/gaming-tracker-service.js";
import type { SteamApiClient } from "../src/steam/client.js";

describe("core services", () => {
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
      await dashboardServices.steamService.addManualCollection?.("413150");
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

  test("reuses injected services without reading environment or opening tracker storage", () => {
    const steamService = {} as SteamService;
    const gamingTrackerService = {} as GamingTrackerService;
    const recommendationPreferencesService = {} as RecommendationPreferencesService;
    const metadataService = {} as MetadataService;
    const gameDurationService = {} as GameDurationService;
    const playNowRecommendationService = {} as PlayNowRecommendationService;
    const backlogPlanService = {} as BacklogPlanService;

    const services = createCoreServices({
      steamService,
      gamingTrackerService,
      recommendationPreferencesService,
      metadataService,
      gameDurationService,
      playNowRecommendationService,
      backlogPlanService,
    });

    expect(services).toMatchObject({
      steamService,
      gamingTrackerService,
      recommendationPreferencesService,
      metadataService,
      gameDurationService,
      playNowRecommendationService,
      backlogPlanService,
    });
    expect(services.taskRunner.list()).toEqual([]);
  });
});
