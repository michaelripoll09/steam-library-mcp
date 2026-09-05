import { describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadConfig } from "../../../src/config.js";
import { createCoreServices } from "../../../src/core-services.js";
import type { AchievementService } from "../../../src/services/achievement-service.js";
import type { BacklogPlanService } from "../../../src/backlog/backlog-plan-service.js";
import type { GameDurationService } from "../../../src/durations/game-duration-service.js";
import type { MetadataService } from "../../../src/services/metadata-service.js";
import type { PlayNowRecommendationService } from "../../../src/recommendations/play-now-recommendation-service.js";
import type { RecommendationPreferencesService } from "../../../src/recommendations/recommendation-preferences-service.js";
import type { SteamService } from "../../../src/services/steam-service.js";
import { openTrackerDatabase } from "../../../src/tracker/sqlite/database.js";
import type { TaskRunner } from "../../../src/tasks/task-runner.js";

describe("core service database lifecycle", () => {
  test("does not close an injected database", async () => {
    const database = openTrackerDatabase(":memory:");
    const services = createCoreServices({
      database,
      steamService: { getLibrary: async () => ({ games: [] }) } as unknown as SteamService,
      achievementService: {} as AchievementService,
      taskRunner: {} as TaskRunner,
      recommendationPreferencesService: {} as RecommendationPreferencesService,
      metadataService: {} as MetadataService,
      gameDurationService: {} as GameDurationService,
      playNowRecommendationService: {} as PlayNowRecommendationService,
      backlogPlanService: {} as BacklogPlanService,
    });

    try {
      await services.gamingTrackerService.getStatuses();
      services.close();
      expect(database.open).toBe(true);
    } finally {
      database.close();
    }
  });

  test("close is idempotent for a factory-owned database", () => {
    const directory = mkdtempSync(join(tmpdir(), "steam-library-database-lifecycle-"));
    const config = loadConfig({
      STEAM_API_KEY: "test-api-key",
      STEAM_ID: "76561198000000000",
      TRACKER_DATABASE_PATH: join(directory, "tracker.sqlite"),
    });
    const services = createCoreServices({ config });

    try {
      services.close();
      expect(() => services.close()).not.toThrow();
    } finally {
      try {
        rmSync(directory, { recursive: true, force: true });
      } catch {
        // The RED implementation has no lifecycle owner to release yet.
      }
    }
  });
});
