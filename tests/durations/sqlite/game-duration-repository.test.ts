import { describe, expect, test } from "vitest";

import { SqliteGameDurationRepository } from "../../../src/durations/sqlite/game-duration-repository.js";
import { openTrackerDatabase } from "../../../src/tracker/sqlite/database.js";

describe("SQLite game duration repository", () => {
  test("stores normalized estimates by Steam AppID with verified IGDB identity", () => {
    const database = openTrackerDatabase(":memory:");
    const repository = new SqliteGameDurationRepository(database);

    try {
      repository.save({
        appId: 620,
        igdbGameId: 3,
        igdbGameName: "Portal 2",
        source: "igdb",
        refreshedAt: "2026-08-28T12:00:00.000Z",
        hastily: { minutes: 90, hours: 1.5 },
        normally: { minutes: 120, hours: 2 },
      });

      expect(repository.get(620)).toEqual({
        appId: 620,
        igdbGameId: 3,
        igdbGameName: "Portal 2",
        source: "igdb",
        refreshedAt: "2026-08-28T12:00:00.000Z",
        hastily: { minutes: 90, hours: 1.5 },
        normally: { minutes: 120, hours: 2 },
      });
      expect(
        database
          .prepare(
            "SELECT app_id, igdb_game_id, igdb_game_name, normally_minutes, refreshed_at FROM game_duration_estimates",
          )
          .get(),
      ).toEqual({
        app_id: 620,
        igdb_game_id: 3,
        igdb_game_name: "Portal 2",
        normally_minutes: 120,
        refreshed_at: "2026-08-28T12:00:00.000Z",
      });
    } finally {
      database.close();
    }
  });
});
