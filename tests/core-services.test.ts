import { describe, expect, test } from "vitest";

import { createCoreServices } from "../src/core-services.js";
import type { GameDurationService } from "../src/durations/game-duration-service.js";
import type { BacklogPlanService } from "../src/backlog/backlog-plan-service.js";
import type { PlayNowRecommendationService } from "../src/recommendations/play-now-recommendation-service.js";
import type { RecommendationPreferencesService } from "../src/recommendations/recommendation-preferences-service.js";
import type { MetadataService } from "../src/services/metadata-service.js";
import type { SteamService } from "../src/services/steam-service.js";
import type { GamingTrackerService } from "../src/tracker/gaming-tracker-service.js";

describe("core services", () => {
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
