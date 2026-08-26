import { describe, expect, test } from "vitest";

import { loadConfig } from "../../src/config.js";

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
