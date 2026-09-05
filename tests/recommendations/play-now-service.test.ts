import { describe, expect, test, vi } from "vitest";

import type { GameDurationEstimate } from "../../src/domain/game-duration.js";
import type { SteamGame, SteamLibrary } from "../../src/domain/models.js";
import type { RecommendationPreferenceRepository } from "../../src/domain/recommendation-preferences.js";
import type { TrackerEntry, TrackerRepository } from "../../src/domain/tracker.js";
import { InputError } from "../../src/errors.js";
import { createPlayNowRecommendationService } from "../../src/recommendations/play-now-recommendation-service.js";

const fetchedAt = "2026-08-28T12:00:00.000Z";

function createService({
  games,
  trackerEntries = [],
  preferences = new Map(),
  durationByAppId = new Map<number, GameDurationEstimate>(),
}: {
  games: SteamLibrary["games"];
  trackerEntries?: readonly TrackerEntry[];
  preferences?: ReadonlyMap<number, ReturnType<RecommendationPreferenceRepository["get"]>>;
  durationByAppId?: ReadonlyMap<number, GameDurationEstimate>;
}) {
  const library = { steamId: "76561198000000000", games, fetchedAt };
  const trackerRepository: Pick<TrackerRepository, "list"> = { list: vi.fn(() => trackerEntries) };
  const preferenceRepository: Pick<RecommendationPreferenceRepository, "get"> = {
    get: vi.fn((appId: number) => preferences.get(appId)),
  };
  const gameDurationService = {
    getEstimate: vi.fn(
      async (game: SteamGame) => durationByAppId.get(game.appId) ?? unavailableDuration(),
    ),
  };

  return {
    service: createPlayNowRecommendationService({
      library: { getLibrary: vi.fn(async () => library) },
      trackerRepository,
      preferenceRepository,
      gameDurationService,
    }),
    trackerRepository,
    preferenceRepository,
    gameDurationService,
  };
}

function estimate(appId: number, normallyMinutes: number): GameDurationEstimate {
  return {
    appId,
    igdbGameId: appId,
    source: "igdb",
    refreshedAt: fetchedAt,
    normally: { minutes: normallyMinutes, hours: normallyMinutes / 60 },
  };
}

function unavailableDuration() {
  return {
    isError: true as const,
    error: {
      code: "DURATION_UNAVAILABLE" as const,
      message: "No duration estimate is available for this game.",
      retryable: false,
    },
  };
}

describe("PlayNowRecommendationService", () => {
  test("does not rank a long playing game below an unstarted short game only because total duration exceeds the session", async () => {
    const { service } = createService({
      games: [
        {
          appId: 20,
          name: "Long playing game",
          playtimeMinutes: 120,
          accessType: "owned",
          isPlayable: true,
        },
        {
          appId: 10,
          name: "Short untouched game",
          playtimeMinutes: 0,
          accessType: "owned",
          isPlayable: true,
        },
      ],
      trackerEntries: [
        { appId: 20, status: "playing", createdAt: fetchedAt, updatedAt: fetchedAt },
      ],
      durationByAppId: new Map([
        [10, estimate(10, 45)],
        [20, estimate(20, 1_200)],
      ]),
    });

    const result = await service.recommend({
      availableMinutes: 60,
      maxResults: 2,
      sessionMode: "solo",
    });

    expect(result.recommendations.map((recommendation) => recommendation.appId)).toEqual([20, 10]);
    expect(result.recommendations[0]).toMatchObject({
      estimatedRemainingMinutes: 1_080,
      reasons: [{ code: "status_playing" }],
    });
  });

  test("ranks paused before untouched games", async () => {
    const { service } = createService({
      games: [
        { appId: 1, name: "Untouched", playtimeMinutes: 0, accessType: "owned", isPlayable: true },
        { appId: 2, name: "Paused", playtimeMinutes: 10, accessType: "owned", isPlayable: true },
      ],
      trackerEntries: [{ appId: 2, status: "paused", createdAt: fetchedAt, updatedAt: fetchedAt }],
    });

    const result = await service.recommend({
      availableMinutes: 60,
      maxResults: 2,
      sessionMode: "solo",
    });

    expect(result.recommendations.map((recommendation) => recommendation.appId)).toEqual([2, 1]);
    expect(result.recommendations[0]?.reasons).toContainEqual({ code: "status_paused" });
  });

  test("uses high priority before finishability within the same status tier", async () => {
    const { service } = createService({
      games: [
        { appId: 1, name: "Finishable", playtimeMinutes: 0, accessType: "owned", isPlayable: true },
        {
          appId: 2,
          name: "High priority",
          playtimeMinutes: 0,
          accessType: "owned",
          isPlayable: true,
        },
      ],
      preferences: new Map([
        [2, { appId: 2, priority: "high", excludedFromRecommendations: false, playMode: "any" }],
      ]),
      durationByAppId: new Map([
        [1, estimate(1, 45)],
        [2, estimate(2, 180)],
      ]),
    });

    const result = await service.recommend({
      availableMinutes: 60,
      maxResults: 2,
      sessionMode: "solo",
    });

    expect(result.recommendations.map((recommendation) => recommendation.appId)).toEqual([2, 1]);
  });

  test("uses finishability only as a tie-breaker", async () => {
    const { service } = createService({
      games: [
        {
          appId: 2,
          name: "Not finishable",
          playtimeMinutes: 0,
          accessType: "owned",
          isPlayable: true,
        },
        { appId: 1, name: "Finishable", playtimeMinutes: 0, accessType: "owned", isPlayable: true },
      ],
      durationByAppId: new Map([
        [1, estimate(1, 45)],
        [2, estimate(2, 180)],
      ]),
    });

    const result = await service.recommend({
      availableMinutes: 60,
      maxResults: 2,
      sessionMode: "solo",
    });

    expect(result.recommendations.map((recommendation) => recommendation.appId)).toEqual([1, 2]);
    expect(result.recommendations[0]?.reasons).toContainEqual({
      code: "finishable_in_session",
      estimatedRemainingMinutes: 45,
      availableMinutes: 60,
    });
  });

  test("includes with-friends-only games when sessionMode is with_friends", async () => {
    const { service } = createService({
      games: [
        { appId: 1, name: "Co-op", playtimeMinutes: 0, accessType: "owned", isPlayable: true },
      ],
      preferences: new Map([
        [
          1,
          {
            appId: 1,
            priority: "normal",
            excludedFromRecommendations: false,
            playMode: "with_friends",
          },
        ],
      ]),
    });

    await expect(
      service.recommend({ availableMinutes: 60, maxResults: 1, sessionMode: "with_friends" }),
    ).resolves.toMatchObject({ recommendations: [{ appId: 1 }] });
  });

  test("reports play mode incompatibility when a with-friends game is requested solo", async () => {
    const { service } = createService({
      games: [
        { appId: 1, name: "Co-op", playtimeMinutes: 0, accessType: "owned", isPlayable: true },
      ],
      preferences: new Map([
        [
          1,
          {
            appId: 1,
            priority: "normal",
            excludedFromRecommendations: false,
            playMode: "with_friends",
          },
        ],
      ]),
    });

    await expect(
      service.recommend({ availableMinutes: 60, maxResults: 1, sessionMode: "solo" }),
    ).resolves.toMatchObject({
      recommendations: [],
      exclusions: [{ reason: "play_mode_incompatible", count: 1 }],
    });
  });

  test("reports play mode incompatibility when a solo game is requested with friends", async () => {
    const { service } = createService({
      games: [
        { appId: 1, name: "Solo", playtimeMinutes: 0, accessType: "owned", isPlayable: true },
      ],
      preferences: new Map([
        [
          1,
          {
            appId: 1,
            priority: "normal",
            excludedFromRecommendations: false,
            playMode: "solo",
          },
        ],
      ]),
    });

    await expect(
      service.recommend({ availableMinutes: 60, maxResults: 1, sessionMode: "with_friends" }),
    ).resolves.toMatchObject({
      recommendations: [],
      exclusions: [{ reason: "play_mode_incompatible", count: 1 }],
    });
  });

  test("accepts games with any play mode in every session mode", async () => {
    const { service } = createService({
      games: [
        { appId: 1, name: "Flexible", playtimeMinutes: 0, accessType: "owned", isPlayable: true },
      ],
      preferences: new Map([
        [
          1,
          {
            appId: 1,
            priority: "normal",
            excludedFromRecommendations: false,
            playMode: "any",
          },
        ],
      ]),
    });

    await expect(
      service.recommend({ availableMinutes: 60, maxResults: 1, sessionMode: "solo" }),
    ).resolves.toMatchObject({ recommendations: [{ appId: 1 }], exclusions: [] });
    await expect(
      service.recommend({ availableMinutes: 60, maxResults: 1, sessionMode: "with_friends" }),
    ).resolves.toMatchObject({ recommendations: [{ appId: 1 }], exclusions: [] });
  });

  test("accepts solo and with-friends games when the session mode is any", async () => {
    const { service } = createService({
      games: [
        { appId: 1, name: "Solo", playtimeMinutes: 0, accessType: "owned", isPlayable: true },
        { appId: 2, name: "Co-op", playtimeMinutes: 0, accessType: "owned", isPlayable: true },
      ],
      preferences: new Map([
        [1, { appId: 1, priority: "normal", excludedFromRecommendations: false, playMode: "solo" }],
        [
          2,
          {
            appId: 2,
            priority: "normal",
            excludedFromRecommendations: false,
            playMode: "with_friends",
          },
        ],
      ]),
    });

    await expect(
      service.recommend({ availableMinutes: 60, maxResults: 2, sessionMode: "any" }),
    ).resolves.toMatchObject({
      recommendations: [{ appId: 1 }, { appId: 2 }],
      exclusions: [],
    });
  });

  test("does not exclude unknown-duration games", async () => {
    const { service } = createService({
      games: [
        { appId: 1, name: "Unknown", playtimeMinutes: 0, accessType: "owned", isPlayable: true },
      ],
    });

    await expect(
      service.recommend({ availableMinutes: 60, maxResults: 1, sessionMode: "solo" }),
    ).resolves.toMatchObject({
      recommendations: [
        { appId: 1, durationEstimateMinutes: null, estimatedRemainingMinutes: null },
      ],
      exclusions: [],
    });
  });

  test("reports every ineligible reason as an exclusion count instead of hiding filters", async () => {
    const { service } = createService({
      games: [
        {
          appId: 1,
          name: "Not playable",
          playtimeMinutes: 0,
          accessType: "manual",
          isPlayable: false,
          manualCollection: true,
        },
        { appId: 2, name: "Excluded", playtimeMinutes: 0, accessType: "owned", isPlayable: true },
        {
          appId: 3,
          name: "Friends only",
          playtimeMinutes: 0,
          accessType: "owned",
          isPlayable: true,
        },
        { appId: 4, name: "Completed", playtimeMinutes: 0, accessType: "owned", isPlayable: true },
        { appId: 5, name: "Dropped", playtimeMinutes: 0, accessType: "owned", isPlayable: true },
      ],
      trackerEntries: [
        { appId: 4, status: "completed", createdAt: fetchedAt, updatedAt: fetchedAt },
        { appId: 5, status: "dropped", createdAt: fetchedAt, updatedAt: fetchedAt },
      ],
      preferences: new Map([
        [2, { appId: 2, priority: "normal", excludedFromRecommendations: true, playMode: "any" }],
        [
          3,
          {
            appId: 3,
            priority: "normal",
            excludedFromRecommendations: false,
            playMode: "with_friends",
          },
        ],
      ]),
    });

    await expect(
      service.recommend({ availableMinutes: 60, maxResults: 5, sessionMode: "solo" }),
    ).resolves.toMatchObject({
      recommendations: [],
      exclusions: [
        { reason: "not_playable", count: 1 },
        { reason: "preference_excluded", count: 1 },
        { reason: "play_mode_incompatible", count: 1 },
        { reason: "completed", count: 1 },
        { reason: "dropped", count: 1 },
      ],
    });
  });

  test("uses unknown-duration candidates only after known candidates and explains uncertainty", async () => {
    const { service } = createService({
      games: [
        { appId: 2, name: "Unknown", playtimeMinutes: 0, accessType: "owned", isPlayable: true },
        { appId: 1, name: "Known", playtimeMinutes: 0, accessType: "owned", isPlayable: true },
      ],
      durationByAppId: new Map([[1, estimate(1, 45)]]),
    });

    const result = await service.recommend({
      availableMinutes: 60,
      maxResults: 2,
      sessionMode: "solo",
    });

    expect(result.recommendations.map((recommendation) => recommendation.appId)).toEqual([1, 2]);
    expect(result.recommendations[1]).toMatchObject({
      durationEstimateMinutes: null,
      estimatedRemainingMinutes: null,
      reasons: [{ code: "duration_unknown" }],
      explanation: "Duration is unknown.",
    });
  });

  test("breaks otherwise equal rankings by ascending AppID", async () => {
    const { service } = createService({
      games: [
        { appId: 30, name: "Thirty", playtimeMinutes: 0, accessType: "owned", isPlayable: true },
        { appId: 10, name: "Ten", playtimeMinutes: 0, accessType: "owned", isPlayable: true },
      ],
      durationByAppId: new Map([
        [10, estimate(10, 60)],
        [30, estimate(30, 60)],
      ]),
    });

    await expect(
      service.recommend({ availableMinutes: 60, maxResults: 2, sessionMode: "solo" }),
    ).resolves.toMatchObject({
      recommendations: [{ appId: 10 }, { appId: 30 }],
    });
  });

  test.each([
    { availableMinutes: 0, maxResults: 1 },
    { availableMinutes: -1, maxResults: 1 },
    { availableMinutes: 1.5, maxResults: 1 },
    { availableMinutes: 60, maxResults: 0 },
    { availableMinutes: 60, maxResults: Number.MAX_SAFE_INTEGER + 1 },
  ])("rejects invalid request values before accessing injected ports", async (request) => {
    const { service, trackerRepository, preferenceRepository, gameDurationService } = createService(
      {
        games: [],
      },
    );

    await expect(service.recommend(request)).rejects.toBeInstanceOf(InputError);
    expect(trackerRepository.list).not.toHaveBeenCalled();
    expect(preferenceRepository.get).not.toHaveBeenCalled();
    expect(gameDurationService.getEstimate).not.toHaveBeenCalled();
  });

  test("provides a concise visible explanation alongside structured reasons", async () => {
    const { service } = createService({
      games: [
        { appId: 1, name: "Portal", playtimeMinutes: 0, accessType: "owned", isPlayable: true },
      ],
      preferences: new Map([
        [1, { appId: 1, priority: "high", excludedFromRecommendations: false, playMode: "any" }],
      ]),
      durationByAppId: new Map([[1, estimate(1, 45)]]),
    });

    await expect(
      service.recommend({ availableMinutes: 60, maxResults: 1, sessionMode: "solo" }),
    ).resolves.toMatchObject({
      recommendations: [
        {
          appId: 1,
          explanation:
            "High priority. Can be finished in your 60 minutes (about 45 minutes remaining).",
          reasons: [
            { code: "priority_high" },
            {
              code: "finishable_in_session",
              estimatedRemainingMinutes: 45,
              availableMinutes: 60,
            },
          ],
        },
      ],
    });
  });
});
