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
  test("ranks duration fits before over-budget games, then high priority and ongoing play", async () => {
    const { service } = createService({
      games: [
        {
          appId: 40,
          name: "Over budget",
          playtimeMinutes: 0,
          accessType: "owned",
          isPlayable: true,
        },
        {
          appId: 30,
          name: "Normal fit",
          playtimeMinutes: 0,
          accessType: "owned",
          isPlayable: true,
        },
        {
          appId: 20,
          name: "Playing fit",
          playtimeMinutes: 10,
          accessType: "owned",
          isPlayable: true,
        },
        { appId: 10, name: "High fit", playtimeMinutes: 0, accessType: "owned", isPlayable: true },
      ],
      trackerEntries: [
        { appId: 20, status: "playing", createdAt: fetchedAt, updatedAt: fetchedAt },
      ],
      preferences: new Map([
        [10, { appId: 10, priority: "high", excludedFromRecommendations: false, playMode: "solo" }],
      ]),
      durationByAppId: new Map([
        [10, estimate(10, 60)],
        [20, estimate(20, 60)],
        [30, estimate(30, 60)],
        [40, estimate(40, 180)],
      ]),
    });

    const result = await service.recommend({ availableMinutes: 120, maxResults: 4 });

    expect(result.recommendations.map((recommendation) => recommendation.appId)).toEqual([
      10, 20, 30, 40,
    ]);
    expect(result.recommendations[0].reasons.map((reason) => reason.code)).toEqual([
      "duration_within_budget",
      "priority_high",
    ]);
    expect(result.recommendations[1].reasons.map((reason) => reason.code)).toEqual([
      "duration_within_budget",
      "status_ongoing",
    ]);
  });

  test("reports every ineligible reason as an exclusion count instead of hiding filters", async () => {
    const { service } = createService({
      games: [
        {
          appId: 1,
          name: "Not playable",
          playtimeMinutes: 0,
          accessType: "family_shared",
          isPlayable: false,
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

    await expect(service.recommend({ availableMinutes: 60, maxResults: 5 })).resolves.toMatchObject(
      {
        recommendations: [],
        exclusions: [
          { reason: "not_playable", count: 1 },
          { reason: "preference_excluded", count: 1 },
          { reason: "with_friends_only", count: 1 },
          { reason: "completed", count: 1 },
          { reason: "dropped", count: 1 },
        ],
      },
    );
  });

  test("uses unknown-duration candidates only after known candidates and explains uncertainty", async () => {
    const { service } = createService({
      games: [
        { appId: 2, name: "Unknown", playtimeMinutes: 0, accessType: "owned", isPlayable: true },
        { appId: 1, name: "Known", playtimeMinutes: 0, accessType: "owned", isPlayable: true },
      ],
      durationByAppId: new Map([[1, estimate(1, 45)]]),
    });

    const result = await service.recommend({ availableMinutes: 60, maxResults: 2 });

    expect(result.recommendations.map((recommendation) => recommendation.appId)).toEqual([1, 2]);
    expect(result.recommendations[1]).toMatchObject({
      durationEstimateMinutes: null,
      reasons: [{ code: "duration_unknown" }],
      explanation: "Duration is unknown, so this is a lower-confidence fit for your 60 minutes.",
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

    await expect(service.recommend({ availableMinutes: 60, maxResults: 2 })).resolves.toMatchObject(
      {
        recommendations: [{ appId: 10 }, { appId: 30 }],
      },
    );
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

    await expect(service.recommend({ availableMinutes: 60, maxResults: 1 })).resolves.toMatchObject(
      {
        recommendations: [
          {
            appId: 1,
            explanation: "Fits your 60 minutes (about 45 minutes). High priority.",
            reasons: [
              { code: "duration_within_budget", durationMinutes: 45, availableMinutes: 60 },
              { code: "priority_high" },
            ],
          },
        ],
      },
    );
  });
});
