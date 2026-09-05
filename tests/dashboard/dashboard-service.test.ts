import { describe, expect, test, vi } from "vitest";

import type { SteamLibrary } from "../../src/domain/models.js";
import type { AchievementResult } from "../../src/services/achievement-service.js";
import type { TrackerGame } from "../../src/domain/tracker.js";
import { InputError, TrackerInputError } from "../../src/errors.js";
import { createDashboardService } from "../../src/dashboard/dashboard-service.js";
import type {
  TrackerMarkResult,
  TrackerMarkStatus,
} from "../../src/tracker/gaming-tracker-service.js";

const library: SteamLibrary = {
  steamId: "private-steam-id",
  fetchedAt: "2025-01-01T00:00:00.000Z",
  games: [
    {
      appId: 10,
      name: "Owned game",
      playtimeMinutes: 0,
      accessType: "owned",
      isPlayable: true,
      imageUrl: "https://private.example/ignored.jpg",
    },
    {
      appId: 20,
      name: "Manual game",
      playtimeMinutes: 0,
      accessType: "manual",
      isPlayable: false,
      manualCollection: true,
    },
    {
      appId: 30,
      name: "Dropped game",
      playtimeMinutes: 30,
      lastPlayedAt: "2024-12-31T00:00:00.000Z",
      accessType: "owned",
      isPlayable: true,
    },
  ],
};

type TrackerMark = <TStatus extends TrackerMarkStatus>(
  appId: unknown,
  status: TStatus,
) => Promise<TrackerMarkResult<TStatus>>;

function createFakes(
  overrides: {
    readonly getLibrary?: () => Promise<SteamLibrary>;
    readonly refreshLibrary?: () => Promise<SteamLibrary>;
    readonly getStatuses?: () => Promise<readonly TrackerGame[]>;
    readonly mark?: TrackerMark;
  } = {},
) {
  return {
    steamService: {
      getLibrary: vi.fn(overrides.getLibrary ?? (async () => library)),
      refreshLibrary: vi.fn(overrides.refreshLibrary ?? (async () => library)),
      getLibraryStats: vi.fn(async () => ({
        totalGames: 3,
        playedGames: 1,
        unplayedGames: 2,
        totalPlaytimeMinutes: 30,
        recentlyPlayedGames: 0,
      })),
    },
    gamingTrackerService: {
      getStatuses: vi.fn(overrides.getStatuses ?? (async () => [])),
      mark: vi.fn(
        overrides.mark ??
          (async <TStatus extends TrackerMarkStatus>(
            appId: unknown,
            status: TStatus,
          ): Promise<TrackerMarkResult<TStatus>> => ({
            outcome: "updated",
            appId: appId as number,
            status,
          })),
      ) as unknown as TrackerMark,
    },
    recommendationPreferencesService: {
      get: vi.fn((appId: unknown) => ({
        appId: appId as number,
        priority: "normal" as const,
        excludedFromRecommendations: false,
        playMode: "any" as const,
      })),
      list: vi.fn(() => []),
      save: vi.fn((appId: unknown, preference: unknown) => ({
        appId: appId as number,
        priority: (preference as { priority: "normal" | "high" }).priority,
        excludedFromRecommendations: (preference as { excludedFromRecommendations: boolean })
          .excludedFromRecommendations,
        playMode: (preference as { playMode: "any" | "solo" | "with_friends" }).playMode,
      })),
    },
    playNowRecommendationService: {
      recommend: vi.fn(async () => ({
        request: { availableMinutes: 1, maxResults: 5, sessionMode: "solo" as const },
        recommendations: [],
        exclusions: [],
      })),
    },
    backlogPlanService: {
      create: vi.fn(),
      listActive: vi.fn(() => []),
      setItemProgress: vi.fn(),
    },
    achievementService: {
      getGameAchievements: vi.fn(),
    },
  };
}

type StatusFixture = Readonly<{
  appId: number;
  name: string;
  status: "backlog" | "playing" | "completed" | "dropped" | "paused";
  createdAt: string | null;
  updatedAt: string | null;
}>;

describe("DashboardService", () => {
  test("returns normalized achievement progress from the achievement service", async () => {
    const result: AchievementResult = {
      status: "available",
      progress: {
        appId: 10,
        name: "Owned game",
        unlockedCount: 1,
        totalCount: 2,
        completionPercent: 50,
        achievements: [
          {
            apiName: "FIRST",
            displayName: "First steps",
            description: null,
            achieved: true,
            unlockTime: "2026-09-05T00:00:00.000Z",
            iconUrl: "https://cdn.example/first.jpg",
            iconGrayUrl: "https://cdn.example/first-gray.jpg",
          },
        ],
      },
    };
    const fakes = createFakes();
    fakes.achievementService.getGameAchievements.mockResolvedValue(result);
    const service = createDashboardService(fakes as never) as unknown as {
      getAchievements: (appId: unknown) => Promise<AchievementResult>;
    };

    await expect(service.getAchievements(10)).resolves.toEqual(result);
    expect(fakes.achievementService.getGameAchievements).toHaveBeenCalledWith(10);
  });

  test("updates a manual collection entry with family access and playability", async () => {
    const updateManualCollection = vi.fn(
      async (patch: { appId: number; accessType?: "manual" | "family"; isPlayable?: boolean }) => ({
        appId: patch.appId,
        name: "Manual game",
        accessType: patch.accessType ?? "manual",
        isPlayable: patch.isPlayable ?? false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      }),
    );
    const fakes = createFakes();
    const service = createDashboardService({
      ...fakes,
      steamService: { ...fakes.steamService, updateManualCollection },
    } as never) as unknown as {
      updateManualCollection: (
        appId: unknown,
        patch: unknown,
      ) => Promise<{ accessType: string; isPlayable: boolean }>;
    };

    const game = await service.updateManualCollection(20, {
      accessType: "family",
      isPlayable: true,
    });

    expect(updateManualCollection).toHaveBeenCalledWith({
      appId: 20,
      accessType: "family",
      isPlayable: true,
    });
    expect(game.accessType).toBe("family");
    expect(game.isPlayable).toBe(true);
  });

  test("does not label an official library winner as manual", async () => {
    const fakes = createFakes();
    const service = createDashboardService({
      ...fakes,
      steamService: {
        ...fakes.steamService,
        getManualCollection: vi.fn(() => [
          {
            appId: 10,
            name: "Old manual",
            accessType: "manual" as const,
            isPlayable: false,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ]),
      },
    });
    const result = await service.getLibrary();
    expect(result.games.find((game) => game.appId === 10)).not.toHaveProperty("manualCollection");
  });

  test("projects local recommendations, plans, and preferences into a browser-safe intelligence snapshot", async () => {
    const fakes = createFakes();
    const service = createDashboardService({
      ...fakes,
      steamService: {
        ...fakes.steamService,
        getLibraryStats: vi.fn(async () => ({
          totalGames: 3,
          playedGames: 2,
          unplayedGames: 1,
          totalPlaytimeMinutes: 150,
          recentlyPlayedGames: 1,
        })),
      },
      recommendationPreferencesService: {
        list: vi.fn(() => [
          {
            appId: 10,
            priority: "high" as const,
            excludedFromRecommendations: false,
            playMode: "solo" as const,
          },
          {
            appId: 20,
            priority: "normal" as const,
            excludedFromRecommendations: true,
            playMode: "with_friends" as const,
          },
        ]),
        get: vi.fn(),
        save: vi.fn(),
      },
      playNowRecommendationService: {
        recommend: vi.fn(async () => ({
          request: {
            availableMinutes: 45,
            maxResults: 5,
            sessionMode: "with_friends" as const,
          },
          recommendations: [
            {
              appId: 10,
              name: "Owned game",
              durationEstimateMinutes: null,
              estimatedRemainingMinutes: null,
              reasons: [{ code: "duration_unknown" as const }],
              explanation: "Duration is unknown.",
            },
          ],
          exclusions: [],
        })),
      },
      backlogPlanService: {
        listActive: vi.fn(() => [
          {
            id: "weekly-1",
            cadence: "weekly" as const,
            availableMinutes: 45,
            targetGameCount: 2,
            lifecycle: "active" as const,
            createdAt: "2026-08-28T00:00:00.000Z",
            updatedAt: "2026-08-28T00:00:00.000Z",
            archivedAt: null,
            items: [],
          },
        ]),
        create: vi.fn(),
        get: vi.fn(),
        setItemProgress: vi.fn(),
      },
    } as never) as unknown as {
      getIntelligenceSnapshot: () => Promise<unknown>;
      getRecommendations: (minutes: unknown, sessionMode: unknown) => Promise<unknown>;
    };

    await expect(service.getIntelligenceSnapshot()).resolves.toEqual({
      library: {
        totalGames: 3,
        playedGames: 2,
        unplayedGames: 1,
        totalPlaytimeMinutes: 150,
        recentlyPlayedGames: 1,
      },
      activePlans: [{ id: "weekly-1", cadence: "weekly", itemCount: 0, completedItemCount: 0 }],
      preferences: {
        configuredGames: 2,
        highPriorityGames: 1,
        excludedGames: 1,
        soloGames: 1,
        withFriendsGames: 1,
      },
    });
    await expect(service.getRecommendations(45, "with_friends")).resolves.toEqual({
      availableMinutes: 45,
      sessionMode: "with_friends",
      recommendations: [
        {
          appId: 10,
          name: "Owned game",
          durationEstimateMinutes: null,
          estimatedRemainingMinutes: null,
          reasons: ["duration_unknown"],
          explanation: "Duration is unknown.",
        },
      ],
    });
  });
  test("projects Steam and tracker data into browser-safe games, totals, and status stats", async () => {
    const fakes = createFakes({
      getStatuses: async () => [
        {
          appId: 20,
          name: "Manual game",
          status: "paused",
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-03T00:00:00.000Z",
        },
        {
          appId: 30,
          name: "Dropped game",
          status: "dropped",
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-04T00:00:00.000Z",
        },
      ],
    });
    const service = createDashboardService(fakes);

    await expect(service.getLibrary()).resolves.toEqual({
      games: [
        {
          appId: 10,
          name: "Owned game",
          status: "backlog",
          coverUrl: "/api/artwork/10",
          accessType: "owned",
          isPlayable: true,
          playtimeMinutes: 0,
        },
        {
          appId: 20,
          name: "Manual game",
          status: "paused",
          coverUrl: "/api/artwork/20",
          accessType: "manual",
          isPlayable: false,
          manualCollection: true,
          playtimeMinutes: 0,
        },
        {
          appId: 30,
          name: "Dropped game",
          status: "dropped",
          coverUrl: "/api/artwork/30",
          accessType: "owned",
          isPlayable: true,
          playtimeMinutes: 30,
          lastPlayedAt: "2024-12-31T00:00:00.000Z",
        },
      ],
      totals: {
        totalGames: 3,
        playedGames: 1,
        unplayedGames: 2,
        totalPlaytimeMinutes: 30,
      },
      statusStats: { backlog: 1, playing: 0, completed: 0, dropped: 1, paused: 1 },
    });

    const projection = await service.getLibrary();
    expect(JSON.stringify(projection)).not.toContain("private-steam-id");
    expect(JSON.stringify(projection)).not.toContain("private.example");
    expect(JSON.stringify(projection)).not.toContain("createdAt");
    expect(JSON.stringify(projection)).not.toContain("updatedAt");
  });

  test("syncs through refreshLibrary only and joins newly read statuses", async () => {
    const refreshedLibrary = { ...library, games: [library.games[0]] };
    const fakes = createFakes({
      getLibrary: async () => {
        throw new Error("getLibrary must not be used by syncLibrary");
      },
      refreshLibrary: async () => refreshedLibrary,
      getStatuses: async () => [
        {
          appId: 10,
          name: "Owned game",
          status: "completed",
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-05T00:00:00.000Z",
        },
      ],
    });
    const service = createDashboardService(fakes);

    await expect(service.syncLibrary()).resolves.toMatchObject({
      games: [expect.objectContaining({ appId: 10, status: "completed" })],
      totals: {
        totalGames: 1,
        playedGames: 0,
        unplayedGames: 1,
        totalPlaytimeMinutes: 0,
      },
      statusStats: { backlog: 0, playing: 0, completed: 1, dropped: 0, paused: 0 },
    });
    expect(fakes.steamService.refreshLibrary).toHaveBeenCalledTimes(1);
    expect(fakes.steamService.getLibrary).not.toHaveBeenCalled();
    expect(fakes.gamingTrackerService.getStatuses).toHaveBeenCalledTimes(1);
  });

  test("updates a mutable status, preserves the mark outcome, and re-reads auto-paused statuses", async () => {
    const getStatuses = vi
      .fn<() => Promise<readonly StatusFixture[]>>()
      .mockResolvedValueOnce([
        {
          appId: 10,
          name: "Owned game",
          status: "playing",
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-02T00:00:00.000Z",
        },
      ])
      .mockResolvedValueOnce([
        {
          appId: 10,
          name: "Owned game",
          status: "paused",
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-03T00:00:00.000Z",
        },
        {
          appId: 20,
          name: "Manual game",
          status: "playing",
          createdAt: "2025-01-03T00:00:00.000Z",
          updatedAt: "2025-01-03T00:00:00.000Z",
        },
      ]);
    const fakes = createFakes({
      getStatuses,
      mark: async <TStatus extends TrackerMarkStatus>(
        appId: unknown,
        status: TStatus,
      ): Promise<TrackerMarkResult<TStatus>> => ({
        outcome: "updated",
        appId: appId as number,
        status,
      }),
    });
    const service = createDashboardService(fakes);

    await expect(service.getLibrary()).resolves.toMatchObject({
      games: expect.arrayContaining([expect.objectContaining({ appId: 10, status: "playing" })]),
    });
    await expect(service.updateStatus(20, "playing")).resolves.toMatchObject({
      mark: { outcome: "updated", appId: 20, status: "playing" },
      library: {
        games: expect.arrayContaining([
          expect.objectContaining({ appId: 10, status: "paused" }),
          expect.objectContaining({ appId: 20, status: "playing" }),
        ]),
      },
    });
    expect(fakes.gamingTrackerService.mark).toHaveBeenCalledWith(20, "playing");
    expect(fakes.gamingTrackerService.getStatuses).toHaveBeenCalledTimes(2);
  });

  test("preserves a not-owned mark outcome while returning the current projection", async () => {
    const fakes = createFakes({
      mark: async <TStatus extends TrackerMarkStatus>(
        appId: unknown,
      ): Promise<TrackerMarkResult<TStatus>> => ({
        outcome: "not_owned",
        appId: appId as number,
      }),
    });
    const service = createDashboardService(fakes);

    await expect(service.updateStatus(999, "completed")).resolves.toMatchObject({
      mark: { outcome: "not_owned", appId: 999 },
      library: { totals: { totalGames: 3 } },
    });
  });

  test.each([undefined, "10", 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid app ID %p before calling the tracker",
    async (appId) => {
      const fakes = createFakes();
      const service = createDashboardService(fakes);

      await expect(service.updateStatus(appId, "completed")).rejects.toBeInstanceOf(
        TrackerInputError,
      );
      expect(fakes.gamingTrackerService.mark).not.toHaveBeenCalled();
    },
  );

  test("marks a game as paused", async () => {
    const fakes = createFakes();
    const service = createDashboardService(fakes);

    await service.updateStatus(10, "paused");

    expect(fakes.gamingTrackerService.mark).toHaveBeenCalledWith(10, "paused");
  });

  test.each(["backlog", "invalid", undefined])(
    "rejects non-mutable status %p before calling the tracker",
    async (status) => {
      const fakes = createFakes();
      const service = createDashboardService(fakes);

      await expect(service.updateStatus(10, status)).rejects.toBeInstanceOf(InputError);
      expect(fakes.gamingTrackerService.mark).not.toHaveBeenCalled();
    },
  );
});
