import { describe, expect, test, vi } from "vitest";

import type { SteamLibrary } from "../../src/domain/models.js";
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
      name: "Family game",
      playtimeMinutes: 120,
      recentPlaytimeMinutes: 45,
      lastPlayedAt: "2025-01-02T00:00:00.000Z",
      accessType: "family_shared",
      isPlayable: false,
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

function createFakes(
  overrides: {
    readonly getLibrary?: () => Promise<SteamLibrary>;
    readonly refreshLibrary?: () => Promise<SteamLibrary>;
    readonly getStatuses?: () => Promise<readonly TrackerGame[]>;
    readonly mark?: (appId: unknown, status: TrackerMarkStatus) => Promise<TrackerMarkResult>;
  } = {},
) {
  return {
    steamService: {
      getLibrary: vi.fn(overrides.getLibrary ?? (async () => library)),
      refreshLibrary: vi.fn(overrides.refreshLibrary ?? (async () => library)),
    },
    gamingTrackerService: {
      getStatuses: vi.fn(overrides.getStatuses ?? (async () => [])),
      mark: vi.fn(
        overrides.mark ??
          (async (appId: unknown, status: TrackerMarkStatus): Promise<TrackerMarkResult> => ({
            outcome: "updated",
            appId: appId as number,
            status,
          })),
      ),
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
  test("projects Steam and tracker data into browser-safe games, totals, and status stats", async () => {
    const fakes = createFakes({
      getStatuses: async () => [
        {
          appId: 20,
          name: "Family game",
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
          name: "Family game",
          status: "paused",
          coverUrl: "/api/artwork/20",
          accessType: "family_shared",
          isPlayable: false,
          playtimeMinutes: 120,
          recentPlaytimeMinutes: 45,
          lastPlayedAt: "2025-01-02T00:00:00.000Z",
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
        playedGames: 2,
        unplayedGames: 1,
        totalPlaytimeMinutes: 150,
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
          name: "Family game",
          status: "playing",
          createdAt: "2025-01-03T00:00:00.000Z",
          updatedAt: "2025-01-03T00:00:00.000Z",
        },
      ]);
    const fakes = createFakes({
      getStatuses,
      mark: async () => ({ outcome: "updated", appId: 20, status: "playing" }),
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
      mark: async () => ({ outcome: "not_owned", appId: 999 }),
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

  test.each(["backlog", "paused", "invalid", undefined])(
    "rejects non-mutable status %p before calling the tracker",
    async (status) => {
      const fakes = createFakes();
      const service = createDashboardService(fakes);

      await expect(service.updateStatus(10, status)).rejects.toBeInstanceOf(InputError);
      expect(fakes.gamingTrackerService.mark).not.toHaveBeenCalled();
    },
  );
});
