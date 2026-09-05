import { describe, expect, it } from "vitest";

import { createBacklogSelectionService } from "../../src/backlog/backlog-selection-service.js";
import type { SteamGame } from "../../src/domain/models.js";
import type { GameRecommendationPreference } from "../../src/domain/recommendation-preferences.js";
import type { TrackerEntry } from "../../src/domain/tracker.js";

type GameInput = Readonly<{
  appId: number;
  name?: string;
  playtimeMinutes?: number;
  isPlayable?: boolean;
  durationEstimateMinutes?: number;
  priority?: "normal" | "high";
  excludedFromRecommendations?: boolean;
  playMode?: "any" | "solo" | "with_friends";
  status?: TrackerEntry["status"];
}>;

function createService(games: readonly GameInput[]) {
  const gamesByAppId = new Map(games.map((game) => [game.appId, game]));
  return createBacklogSelectionService({
    library: {
      getLibrary: async () => ({
        steamId: "test-steam-id",
        games: games.map(toSteamGame),
        fetchedAt: "2026-09-04T00:00:00.000Z",
      }),
    },
    trackerRepository: {
      list: () =>
        games.flatMap((game): TrackerEntry[] =>
          game.status === undefined
            ? []
            : [
                {
                  appId: game.appId,
                  status: game.status,
                  createdAt: "2026-09-04T00:00:00.000Z",
                  updatedAt: "2026-09-04T00:00:00.000Z",
                },
              ],
        ),
    },
    preferenceRepository: {
      get: (appId): GameRecommendationPreference | undefined => {
        const game = gamesByAppId.get(appId);
        if (game === undefined) return undefined;
        return {
          appId,
          priority: game.priority ?? "normal",
          excludedFromRecommendations: game.excludedFromRecommendations ?? false,
          playMode: game.playMode ?? "any",
        };
      },
    },
    gameDurationService: {
      getEstimate: async (game) => {
        const durationEstimateMinutes = gamesByAppId.get(game.appId)?.durationEstimateMinutes;
        return durationEstimateMinutes === undefined
          ? {
              isError: true as const,
              error: {
                code: "DURATION_UNAVAILABLE" as const,
                message: "Duration unavailable for test.",
                retryable: false,
              },
            }
          : {
              appId: game.appId,
              igdbGameId: game.appId,
              source: "igdb" as const,
              refreshedAt: "2026-09-04T00:00:00.000Z",
              normally: { minutes: durationEstimateMinutes, hours: durationEstimateMinutes / 60 },
            };
      },
    },
  });
}

function toSteamGame(game: GameInput): SteamGame {
  return {
    appId: game.appId,
    name: game.name ?? `Game ${game.appId}`,
    playtimeMinutes: game.playtimeMinutes ?? 0,
    isPlayable: game.isPlayable ?? true,
  };
}

describe("BacklogSelectionService", () => {
  it("never exceeds availableMinutes", async () => {
    const result = await createService([
      { appId: 1, durationEstimateMinutes: 60 },
      { appId: 2, durationEstimateMinutes: 50 },
    ]).select({ availableMinutes: 100, targetGameCount: 2 });

    expect(result.allocatedMinutes).toBe(50);
    expect(result.unallocatedMinutes).toBe(50);
    expect(result.selections.map((selection) => selection.appId)).toEqual([2]);
  });

  it("uses estimated remaining time instead of total duration", async () => {
    const result = await createService([
      { appId: 1, durationEstimateMinutes: 120, playtimeMinutes: 90 },
    ]).select({ availableMinutes: 45, targetGameCount: 1 });

    expect(result.selections).toMatchObject([
      { appId: 1, durationEstimateMinutes: 120, estimatedRemainingMinutes: 30 },
    ]);
    expect(result.allocatedMinutes).toBe(30);
  });

  it("prefers high-priority games before normal games", async () => {
    const result = await createService([
      { appId: 1, durationEstimateMinutes: 20, priority: "normal" },
      { appId: 2, durationEstimateMinutes: 40, priority: "high" },
    ]).select({ availableMinutes: 40, targetGameCount: 1 });

    expect(result.selections.map((selection) => selection.appId)).toEqual([2]);
  });

  it("prefers playing or paused games within the same priority", async () => {
    const result = await createService([
      { appId: 1, durationEstimateMinutes: 20 },
      { appId: 2, durationEstimateMinutes: 40, status: "paused" },
      { appId: 3, durationEstimateMinutes: 50, status: "playing" },
    ]).select({ availableMinutes: 70, targetGameCount: 2 });

    expect(result.selections.map((selection) => selection.appId)).toEqual([2, 1]);
  });

  it("does not exclude with-friends preference from a weekly plan", async () => {
    const result = await createService([
      { appId: 1, durationEstimateMinutes: 30, playMode: "with_friends" },
    ]).select({ availableMinutes: 30, targetGameCount: 1 });

    expect(result.selections.map((selection) => selection.appId)).toEqual([1]);
    expect(result.exclusions).not.toContainEqual({ reason: "preference_excluded", count: 1 });
  });

  it("reports unknown duration instead of pretending it fits", async () => {
    const result = await createService([{ appId: 1 }]).select({
      availableMinutes: 30,
      targetGameCount: 1,
    });

    expect(result.selections).toEqual([]);
    expect(result.allocatedMinutes).toBe(0);
    expect(result.unallocatedMinutes).toBe(30);
    expect(result.exclusions).toEqual([{ reason: "duration_unknown", count: 1 }]);
  });

  it("skips an over-budget candidate and can select a later candidate that fits", async () => {
    const result = await createService([
      { appId: 1, durationEstimateMinutes: 80, priority: "high" },
      { appId: 2, durationEstimateMinutes: 30, priority: "normal" },
    ]).select({ availableMinutes: 40, targetGameCount: 1 });

    expect(result.selections.map((selection) => selection.appId)).toEqual([2]);
    expect(result.exclusions).toEqual([{ reason: "over_budget", count: 1 }]);
  });
});
