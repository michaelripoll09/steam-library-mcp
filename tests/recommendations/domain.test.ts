import { describe, expect, test } from "vitest";

import {
  DEFAULT_RECOMMENDATION_PREFERENCE,
  PLAY_MODES,
  RECOMMENDATION_PRIORITIES,
  createGameRecommendationPreference,
} from "../../src/domain/recommendation-preferences.js";

describe("recommendation preference domain", () => {
  test("defines immutable supported values and creates an immutable preference model", () => {
    expect(RECOMMENDATION_PRIORITIES).toEqual(["normal", "high"]);
    expect(PLAY_MODES).toEqual(["any", "solo", "with_friends"]);
    expect(DEFAULT_RECOMMENDATION_PREFERENCE).toEqual({
      priority: "normal",
      excludedFromRecommendations: false,
      playMode: "any",
    });
    expect(Object.isFrozen(DEFAULT_RECOMMENDATION_PREFERENCE)).toBe(true);

    const preference = createGameRecommendationPreference({
      appId: 620,
      priority: "high",
      excludedFromRecommendations: true,
      playMode: "with_friends",
      ignoredField: "not serialized",
    });

    expect(preference).toEqual({
      appId: 620,
      priority: "high",
      excludedFromRecommendations: true,
      playMode: "with_friends",
    });
    expect(Object.isFrozen(preference)).toBe(true);
  });
});
