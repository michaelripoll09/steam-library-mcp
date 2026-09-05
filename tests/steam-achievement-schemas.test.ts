import { describe, expect, test } from "vitest";

import {
  playerAchievementsResponseSchema,
  gameSchemaResponseSchema,
} from "../src/steam/schemas.js";

describe("Steam achievement response schemas", () => {
  test("parses successful player achievements", () => {
    const result = playerAchievementsResponseSchema.parse({
      playerstats: {
        steamID: "76561198000000000",
        gameName: "Portal 2",
        success: true,
        achievements: [{ apiname: "ACH_PORTAL", achieved: 1, unlocktime: 1_700_000_000 }],
      },
    });

    expect(result.playerstats.achievements).toEqual([
      { apiname: "ACH_PORTAL", achieved: 1, unlocktime: 1_700_000_000 },
    ]);
  });

  test("defaults absent achievements to an empty list when Steam reports no achievements", () => {
    const result = playerAchievementsResponseSchema.parse({
      playerstats: { success: false },
    });

    expect(result.playerstats).toMatchObject({ success: false, achievements: [] });
  });

  test("preserves a locked achievement unlock time of zero", () => {
    const result = playerAchievementsResponseSchema.parse({
      playerstats: {
        success: true,
        achievements: [{ apiname: "ACH_LOCKED", achieved: 0, unlocktime: 0 }],
      },
    });

    expect(result.playerstats.achievements[0]?.unlocktime).toBe(0);
  });

  test("parses schema achievements with omitted descriptions", () => {
    const result = gameSchemaResponseSchema.parse({
      game: {
        gameName: "Portal 2",
        availableGameStats: {
          achievements: [
            {
              name: "ACH_HIDDEN",
              defaultvalue: 0,
              displayName: "Hidden achievement",
              hidden: 1,
              icon: "https://cdn.example.test/icon.jpg",
              icongray: "https://cdn.example.test/icon-gray.jpg",
            },
          ],
        },
      },
    });

    expect(result.game.availableGameStats.achievements[0]).toMatchObject({
      name: "ACH_HIDDEN",
      hidden: 1,
    });
    expect(result.game.availableGameStats.achievements[0]).not.toHaveProperty("description");
  });

  test("defaults missing schema achievements to an empty list", () => {
    const result = gameSchemaResponseSchema.parse({
      game: { gameName: "Portal 2", availableGameStats: {} },
    });

    expect(result.game.availableGameStats.achievements).toEqual([]);
  });
});
