import { describe, expect, test, vi } from "vitest";

import type { RecommendationPreferenceRepository } from "../../src/domain/recommendation-preferences.js";
import { InputError, TrackerInputError } from "../../src/errors.js";
import { createRecommendationPreferencesService } from "../../src/recommendations/recommendation-preferences-service.js";

function createRepository(): RecommendationPreferenceRepository {
  return {
    get: vi.fn(() => undefined),
    list: vi.fn(() => []),
    save: vi.fn(),
    remove: vi.fn(),
  };
}

describe("RecommendationPreferencesService", () => {
  test("returns defaults without materializing a preference row", () => {
    const repository = createRepository();
    const service = createRecommendationPreferencesService({ repository });

    expect(service.get(620)).toEqual({
      appId: 620,
      priority: "normal",
      excludedFromRecommendations: false,
      playMode: "any",
    });
    expect(repository.get).toHaveBeenCalledWith(620);
    expect(repository.save).not.toHaveBeenCalled();
  });

  test.each([undefined, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid app ID %p before repository access",
    (appId) => {
      const repository = createRepository();
      const service = createRecommendationPreferencesService({ repository });

      expect(() => service.get(appId)).toThrow(TrackerInputError);
      expect(repository.get).not.toHaveBeenCalled();
      expect(repository.save).not.toHaveBeenCalled();
    },
  );

  test.each([
    { priority: "urgent", excludedFromRecommendations: false, playMode: "any" },
    { priority: "normal", excludedFromRecommendations: false, playMode: "co_op" },
    { priority: "normal", excludedFromRecommendations: "false", playMode: "any" },
  ])("rejects invalid preference values before persistence", (preference) => {
    const repository = createRepository();
    const service = createRecommendationPreferencesService({ repository });

    expect(() => service.save(620, preference)).toThrow(InputError);
    expect(repository.save).not.toHaveBeenCalled();
  });

  test("persists a validated complete preference", () => {
    const repository = createRepository();
    const service = createRecommendationPreferencesService({ repository });

    expect(
      service.save(620, {
        priority: "high",
        excludedFromRecommendations: true,
        playMode: "with_friends",
      }),
    ).toEqual({
      appId: 620,
      priority: "high",
      excludedFromRecommendations: true,
      playMode: "with_friends",
    });
    expect(repository.save).toHaveBeenCalledWith({
      appId: 620,
      priority: "high",
      excludedFromRecommendations: true,
      playMode: "with_friends",
    });
  });

  test("removes a stored preference when saving the defaults", () => {
    const repository = createRepository();
    const service = createRecommendationPreferencesService({ repository });

    expect(
      service.save(620, {
        priority: "normal",
        excludedFromRecommendations: false,
        playMode: "any",
      }),
    ).toEqual({
      appId: 620,
      priority: "normal",
      excludedFromRecommendations: false,
      playMode: "any",
    });
    expect(repository.remove).toHaveBeenCalledWith(620);
    expect(repository.save).not.toHaveBeenCalled();
  });
});
