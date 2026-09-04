import { describe, expect, test, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TtlCache } from "../src/cache/ttl-cache.js";
import { loadConfig } from "../src/config.js";
import { GameNotFoundError, InputError, SteamUnavailableError } from "../src/errors.js";
import { createSteamService } from "../src/services/steam-service.js";
import type { SteamLibrary } from "../src/domain/models.js";
import type { SteamApiClient } from "../src/steam/client.js";
import type { ManualLibraryRepository } from "../src/manual-library/manual-library.js";
import { SqliteManualLibraryRepository } from "../src/manual-library/manual-library.js";
import { openTrackerDatabase } from "../src/tracker/sqlite/database.js";

const config = loadConfig({
  STEAM_API_KEY: "secret-key",
  STEAM_ID: "76561198000000000",
});

function createClient(overrides: Partial<SteamApiClient> = {}): SteamApiClient {
  return {
    getOwnedGames: vi.fn(async () => ({
      response: {
        game_count: 2,
        games: [
          {
            appid: 620,
            name: "Portal 2",
            playtime_forever: 135,
            playtime_2weeks: 42,
            rtime_last_played: 1_700_000_000,
            img_logo_url: "portal-logo",
            ignored: "upstream field",
          },
          { appid: 440, name: "Team Fortress 2", playtime_forever: 0 },
        ],
      },
    })),
    getRecentGames: vi.fn(async () => ({
      response: {
        total_count: 2,
        games: [
          { appid: 620, name: "Portal 2", playtime_forever: 135, playtime_2weeks: 42 },
          { appid: 440, name: "Team Fortress 2", playtime_forever: 0 },
        ],
      },
    })),
    ...overrides,
  };
}

describe("SteamService", () => {
  test("defaults family entries to playable", async () => {
    const repository: ManualLibraryRepository = {
      list: vi.fn(() => []),
      upsert: vi.fn((game) => game),
      updateAccess: vi.fn(),
      remove: vi.fn(),
    };
    const service = createSteamService({
      config,
      steamClient: createClient(),
      cache: new TtlCache(),
      clock: { now: () => Date.parse("2026-01-02T00:00:00.000Z") },
      manualRepository: repository,
      publicGameLookup: vi.fn(async () => ({ appId: 1245620, name: "ELDEN RING" })),
    });

    await expect(
      service.addManualCollection?.({ steam: "1245620", accessType: "family" }),
    ).resolves.toMatchObject({ accessType: "family", isPlayable: true });
  });

  test("preserves old manual default", async () => {
    const repository: ManualLibraryRepository = {
      list: vi.fn(() => []),
      upsert: vi.fn((game) => game),
      updateAccess: vi.fn(),
      remove: vi.fn(),
    };
    const service = createSteamService({
      config,
      steamClient: createClient(),
      cache: new TtlCache(),
      clock: { now: () => Date.parse("2026-01-02T00:00:00.000Z") },
      manualRepository: repository,
      publicGameLookup: vi.fn(async () => ({ appId: 1245620, name: "ELDEN RING" })),
    });

    await expect(service.addManualCollection?.({ steam: "1245620" })).resolves.toMatchObject({
      accessType: "manual",
      isPlayable: false,
    });
  });

  test("updates access without a Steam Store lookup", async () => {
    const entry = {
      appId: 1245620,
      name: "ELDEN RING",
      accessType: "manual" as const,
      isPlayable: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const repository: ManualLibraryRepository = {
      list: vi.fn(() => [entry]),
      upsert: vi.fn((game) => ({ ...entry, ...game })),
      updateAccess: vi.fn((update) => ({
        ...entry,
        ...(update.accessType === undefined ? {} : { accessType: update.accessType }),
        ...(update.isPlayable === undefined ? {} : { isPlayable: update.isPlayable }),
        updatedAt: update.updatedAt,
      })),
      remove: vi.fn(),
    };
    const lookup = vi.fn(async () => ({ appId: 1245620, name: "ELDEN RING" }));
    const service = createSteamService({
      config,
      steamClient: createClient(),
      cache: new TtlCache(),
      clock: { now: () => Date.parse("2026-01-02T00:00:00.000Z") },
      manualRepository: repository,
      publicGameLookup: lookup,
    });
    const update = service.updateManualCollection;

    expect(update).toBeTypeOf("function");
    await expect(update?.({ appId: 1245620, accessType: "family" })).resolves.toMatchObject({
      accessType: "family",
      isPlayable: false,
    });
    expect(lookup).not.toHaveBeenCalled();
  });

  test("does not rewrite or invalidate the library for an unchanged manual entry", async () => {
    const entry = {
      appId: 413150,
      name: "Stardew Valley",
      accessType: "manual" as const,
      isPlayable: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const repository: ManualLibraryRepository = {
      list: vi.fn(() => [entry]),
      upsert: vi.fn(),
      updateAccess: vi.fn(),
      remove: vi.fn(),
    };
    const cache = new TtlCache<SteamLibrary>();
    const steamClient = createClient();
    const service = createSteamService({
      config,
      steamClient,
      cache,
      clock: { now: () => Date.parse("2026-01-02T00:00:00.000Z") },
      manualRepository: repository,
      publicGameLookup: vi.fn(async () => ({ appId: 413150, name: "Stardew Valley" })),
    });
    await service.getLibrary();
    await expect(service.addManualCollection?.({ steam: "413150" })).resolves.toEqual(entry);
    expect(repository.upsert).not.toHaveBeenCalled();
    await service.getLibrary();
    expect(steamClient.getOwnedGames).toHaveBeenCalledTimes(1);
  });
  test("normalizes library games and reuses a fresh SteamID-keyed cache entry", async () => {
    let now = 1_700_000_000_000;
    const steamClient = createClient();
    const service = createSteamService({
      config,
      steamClient,
      cache: new TtlCache({ now: () => now }),
      clock: { now: () => now },
    });

    const first = await service.getLibrary();
    const second = await service.getLibrary();

    expect(first).toEqual({
      steamId: config.steamId,
      fetchedAt: "2023-11-14T22:13:20.000Z",
      games: [
        {
          appId: 620,
          name: "Portal 2",
          playtimeMinutes: 135,
          accessType: "owned",
          isPlayable: true,
          recentPlaytimeMinutes: 42,
          lastPlayedAt: "2023-11-14T22:13:20.000Z",
          imageUrl:
            "https://media.steampowered.com/steamcommunity/public/images/apps/620/portal-logo.jpg",
        },
        {
          appId: 440,
          name: "Team Fortress 2",
          playtimeMinutes: 0,
          accessType: "owned",
          isPlayable: true,
        },
      ],
    });
    expect(second).toEqual(first);
    expect(steamClient.getOwnedGames).toHaveBeenCalledTimes(1);

    now += config.libraryCacheTtlMs;
    await service.getLibrary();
    expect(steamClient.getOwnedGames).toHaveBeenCalledTimes(2);
  });

  test("does not cache a failed library refresh", async () => {
    const getOwnedGames = vi
      .fn<SteamApiClient["getOwnedGames"]>()
      .mockRejectedValueOnce(new SteamUnavailableError(new Error("upstream secret")))
      .mockResolvedValueOnce({ response: { games: [] } });
    const service = createSteamService({
      config,
      steamClient: createClient({ getOwnedGames }),
      cache: new TtlCache(),
      clock: { now: () => 0 },
    });

    await expect(service.getLibrary()).rejects.toBeInstanceOf(SteamUnavailableError);
    await expect(service.getLibrary()).resolves.toMatchObject({ games: [] });
    expect(getOwnedGames).toHaveBeenCalledTimes(2);
  });

  test("bypasses a fresh cache entry and replaces it after a successful library refresh", async () => {
    const getOwnedGames = vi
      .fn<SteamApiClient["getOwnedGames"]>()
      .mockResolvedValueOnce({
        response: { games: [{ appid: 620, name: "Portal 2", playtime_forever: 135 }] },
      })
      .mockResolvedValueOnce({
        response: { games: [{ appid: 440, name: "Team Fortress 2", playtime_forever: 0 }] },
      });
    const service = createSteamService({
      config,
      steamClient: createClient({ getOwnedGames }),
      cache: new TtlCache(),
      clock: { now: () => 0 },
    });

    await expect(service.getLibrary()).resolves.toMatchObject({ games: [{ appId: 620 }] });
    await expect(service.refreshLibrary()).resolves.toMatchObject({ games: [{ appId: 440 }] });
    await expect(service.getLibrary()).resolves.toMatchObject({ games: [{ appId: 440 }] });
    expect(getOwnedGames).toHaveBeenCalledTimes(2);
  });

  test("preserves the last good cached library when a forced refresh fails", async () => {
    const getOwnedGames = vi
      .fn<SteamApiClient["getOwnedGames"]>()
      .mockResolvedValueOnce({
        response: { games: [{ appid: 620, name: "Portal 2", playtime_forever: 135 }] },
      })
      .mockRejectedValueOnce(new SteamUnavailableError(new Error("upstream unavailable")));
    const service = createSteamService({
      config,
      steamClient: createClient({ getOwnedGames }),
      cache: new TtlCache(),
      clock: { now: () => 0 },
    });

    const cached = await service.getLibrary();
    await expect(service.refreshLibrary()).rejects.toBeInstanceOf(SteamUnavailableError);
    await expect(service.getLibrary()).resolves.toEqual(cached);
    expect(getOwnedGames).toHaveBeenCalledTimes(2);
  });

  test("searches case-insensitively and looks up a normalized game by app ID", async () => {
    const service = createSteamService({
      config,
      steamClient: createClient(),
      cache: new TtlCache(),
      clock: { now: () => 0 },
    });

    await expect(service.searchLibrary("PORTAL")).resolves.toEqual([
      expect.objectContaining({ appId: 620, name: "Portal 2" }),
    ]);
    await expect(service.getGame(440)).resolves.toEqual({
      appId: 440,
      name: "Team Fortress 2",
      playtimeMinutes: 0,
      accessType: "owned",
      isPlayable: true,
    });
    await expect(service.getGame(999)).rejects.toBeInstanceOf(GameNotFoundError);
  });

  test("validates a recent-game count from 1 through 50 and normalizes recent games", async () => {
    const steamClient = createClient();
    const service = createSteamService({
      config,
      steamClient,
      cache: new TtlCache(),
      clock: { now: () => 0 },
    });

    await expect(service.getRecentGames(1)).resolves.toEqual([
      expect.objectContaining({ appId: 620, recentPlaytimeMinutes: 42 }),
      expect.objectContaining({ appId: 440, playtimeMinutes: 0 }),
    ]);
    expect(steamClient.getRecentGames).toHaveBeenCalledWith(config.steamId, 1);
    await expect(service.getRecentGames(0)).rejects.toBeInstanceOf(InputError);
    await expect(service.getRecentGames(51)).rejects.toBeInstanceOf(InputError);
  });

  test("orders recent games by confirmed last played date without inventing missing dates", async () => {
    const service = createSteamService({
      config,
      steamClient: createClient({
        getRecentGames: vi.fn(async () => ({
          response: {
            total_count: 3,
            games: [
              {
                appid: 440,
                name: "Team Fortress 2",
                playtime_forever: 20,
                rtime_last_played: 1_700_000_000,
              },
              { appid: 570, name: "Dota 2", playtime_forever: 10 },
              {
                appid: 620,
                name: "Portal 2",
                playtime_forever: 135,
                rtime_last_played: 1_710_000_000,
              },
            ],
          },
        })),
      }),
      cache: new TtlCache(),
      clock: { now: () => 0 },
    });

    await expect(service.getRecentGames()).resolves.toEqual([
      expect.objectContaining({
        appId: 620,
        lastPlayedAt: "2024-03-09T16:00:00.000Z",
      }),
      expect.objectContaining({
        appId: 440,
        lastPlayedAt: "2023-11-14T22:13:20.000Z",
      }),
      expect.not.objectContaining({ lastPlayedAt: expect.anything() }),
    ]);
  });

  test("calculates statistics from the normalized library", async () => {
    const service = createSteamService({
      config,
      steamClient: createClient(),
      cache: new TtlCache(),
      clock: { now: () => 0 },
    });

    await expect(service.getLibraryStats()).resolves.toEqual({
      totalGames: 2,
      playedGames: 1,
      unplayedGames: 1,
      totalPlaytimeMinutes: 135,
      recentlyPlayedGames: 1,
    });
  });
  test("merges persistent manual games with owned games while owned data wins duplicates", async () => {
    const manualGames = [
      {
        appId: 413150,
        name: "Stardew Valley",
        accessType: "manual" as const,
        isPlayable: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        appId: 620,
        name: "Old Portal 2",
        accessType: "manual" as const,
        isPlayable: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    const service = createSteamService({
      config,
      steamClient: createClient(),
      cache: new TtlCache(),
      clock: { now: () => 0 },
      manualRepository: {
        list: vi.fn(() => manualGames),
        upsert: vi.fn(),
        updateAccess: vi.fn(),
        remove: vi.fn(),
      },
    });

    await expect(service.getLibrary()).resolves.toMatchObject({
      games: [
        { appId: 620, accessType: "owned", isPlayable: true, playtimeMinutes: 135 },
        { appId: 440, accessType: "owned", isPlayable: true },
        {
          appId: 413150,
          name: "Stardew Valley",
          accessType: "manual",
          isPlayable: false,
          playtimeMinutes: 0,
          manualCollection: true,
        },
      ],
    });
  });

  test("merges the latest manual collection into each independently cached library", async () => {
    const directory = mkdtempSync(join(tmpdir(), "steam-library-parity-"));
    const databasePath = join(directory, "tracker.sqlite");
    const dashboardDatabase = openTrackerDatabase(databasePath);
    const mcpDatabase = openTrackerDatabase(databasePath);
    const dashboardService = createSteamService({
      config,
      steamClient: createClient(),
      cache: new TtlCache(),
      clock: { now: () => 0 },
      manualRepository: new SqliteManualLibraryRepository(dashboardDatabase),
      publicGameLookup: vi.fn(async () => ({ appId: 413150, name: "Stardew Valley" })),
    });
    const mcpService = createSteamService({
      config,
      steamClient: createClient(),
      cache: new TtlCache(),
      clock: { now: () => 0 },
      manualRepository: new SqliteManualLibraryRepository(mcpDatabase),
      publicGameLookup: vi.fn(async () => ({ appId: 413150, name: "Stardew Valley" })),
    });

    try {
      await mcpService.getLibrary();
      await dashboardService.addManualCollection?.({ steam: "413150" });
      await expect(mcpService.getLibrary()).resolves.toMatchObject({
        games: expect.arrayContaining([
          expect.objectContaining({ appId: 413150, accessType: "manual" }),
        ]),
      });
      await expect(mcpService.getLibraryStats()).resolves.toMatchObject({ totalGames: 3 });
      await dashboardService.removeManualCollection?.(413150);
      await expect(mcpService.searchLibrary("Stardew")).resolves.toEqual([]);
    } finally {
      dashboardDatabase.close();
      mcpDatabase.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
