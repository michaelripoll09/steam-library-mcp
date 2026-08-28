import { describe, expect, test } from "vitest";

import { openTrackerDatabase } from "../../../src/tracker/sqlite/database.js";
import { SqliteRecommendationPreferenceRepository } from "../../../src/recommendations/sqlite/recommendation-preference-repository.js";

describe("SQLite recommendation preference repository", () => {
  test("stores typed preferences by Steam AppID and keeps absent preferences absent", () => {
    const database = openTrackerDatabase(":memory:");
    const repository = new SqliteRecommendationPreferenceRepository(database);

    try {
      expect(repository.get(620)).toBeUndefined();
      repository.save({
        appId: 620,
        priority: "high",
        excludedFromRecommendations: true,
        playMode: "with_friends",
      });

      expect(repository.get(620)).toEqual({
        appId: 620,
        priority: "high",
        excludedFromRecommendations: true,
        playMode: "with_friends",
      });
      expect(
        database
          .prepare(
            "SELECT priority, excluded_from_recommendations, play_mode FROM recommendation_preferences WHERE app_id = ?",
          )
          .get(620),
      ).toEqual({
        priority: "high",
        excluded_from_recommendations: 1,
        play_mode: "with_friends",
      });
    } finally {
      database.close();
    }
  });

  test("updates an existing AppID without adding a second preference row", () => {
    const database = openTrackerDatabase(":memory:");
    const repository = new SqliteRecommendationPreferenceRepository(database);

    try {
      repository.save({
        appId: 730,
        priority: "normal",
        excludedFromRecommendations: false,
        playMode: "any",
      });
      repository.save({
        appId: 730,
        priority: "high",
        excludedFromRecommendations: false,
        playMode: "solo",
      });

      expect(repository.get(730)).toEqual({
        appId: 730,
        priority: "high",
        excludedFromRecommendations: false,
        playMode: "solo",
      });
      expect(
        database.prepare("SELECT COUNT(*) AS count FROM recommendation_preferences").get(),
      ).toEqual({ count: 1 });
    } finally {
      database.close();
    }
  });

  test("removes an existing preference and safely no-ops when it is absent", () => {
    const database = openTrackerDatabase(":memory:");
    const repository = new SqliteRecommendationPreferenceRepository(database);

    try {
      repository.save({
        appId: 730,
        priority: "high",
        excludedFromRecommendations: true,
        playMode: "solo",
      });

      repository.remove(730);
      repository.remove(730);

      expect(repository.get(730)).toBeUndefined();
    } finally {
      database.close();
    }
  });
});
