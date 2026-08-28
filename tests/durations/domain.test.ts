import { describe, expect, test } from "vitest";

import { normalizeIgdbDuration } from "../../src/domain/game-duration.js";

describe("game duration domain", () => {
  test("normalizes positive IGDB seconds into optional minute and hour estimates", () => {
    expect(
      normalizeIgdbDuration({
        appId: 620,
        igdbGameId: 3,
        igdbGameName: "Portal 2",
        hastilySeconds: 5_400,
        normallySeconds: 7_200,
        completelySeconds: 9_000,
        refreshedAt: "2026-08-28T12:00:00.000Z",
      }),
    ).toEqual({
      appId: 620,
      igdbGameId: 3,
      igdbGameName: "Portal 2",
      source: "igdb",
      refreshedAt: "2026-08-28T12:00:00.000Z",
      hastily: { minutes: 90, hours: 1.5 },
      normally: { minutes: 120, hours: 2 },
      completely: { minutes: 150, hours: 2.5 },
    });
  });

  test("rejects zero, negative, and non-finite provider times instead of persisting an estimate", () => {
    expect(
      normalizeIgdbDuration({
        appId: 620,
        igdbGameId: 3,
        igdbGameName: "Portal 2",
        hastilySeconds: 0,
        normallySeconds: -10,
        completelySeconds: Number.POSITIVE_INFINITY,
        refreshedAt: "2026-08-28T12:00:00.000Z",
      }),
    ).toBeUndefined();
  });
});
