import { describe, expect, test } from "vitest";

import { loadConfig } from "../../src/config.js";
import {
  TRACKER_ERROR_MESSAGES,
  TRACKER_STATUSES,
  createTrackerGame,
} from "../../src/domain/tracker.js";

describe("tracker foundation configuration", () => {
  test("uses a stable local tracker database path by default", () => {
    expect(
      loadConfig({
        STEAM_API_KEY: "test-api-key",
        STEAM_ID: "76561198000000000",
      }).trackerDatabasePath,
    ).toBe(".steam-library/tracker.sqlite");
  });

  test("uses the configured tracker database path", () => {
    expect(
      loadConfig({
        STEAM_API_KEY: "test-api-key",
        STEAM_ID: "76561198000000000",
        TRACKER_DATABASE_PATH: "D:/data/tracker.sqlite",
      }).trackerDatabasePath,
    ).toBe("D:/data/tracker.sqlite");
  });
});

describe("tracker domain contracts", () => {
  test("exports the fixed status vocabulary and safe error messages", () => {
    expect(TRACKER_STATUSES).toEqual(["backlog", "playing", "completed", "dropped", "paused"]);
    expect(TRACKER_ERROR_MESSAGES.invalidInput).toBe("appId must be a positive safe integer.");
    expect(Object.isFrozen(TRACKER_STATUSES)).toBe(true);
    expect(Object.isFrozen(TRACKER_ERROR_MESSAGES)).toBe(true);
  });

  test("serializes only documented tracker game fields", () => {
    const game = createTrackerGame({
      appId: 620,
      name: "Portal 2",
      status: "completed",
      createdAt: "2026-08-25T00:00:00.000Z",
      updatedAt: "2026-08-25T01:00:00.000Z",
      sqlitePath: "C:/private/tracker.sqlite",
    });

    expect(game).toEqual({
      appId: 620,
      name: "Portal 2",
      status: "completed",
      createdAt: "2026-08-25T00:00:00.000Z",
      updatedAt: "2026-08-25T01:00:00.000Z",
    });
    expect(JSON.stringify(game)).not.toContain("sqlitePath");
    expect(Object.isFrozen(game)).toBe(true);
  });
});
