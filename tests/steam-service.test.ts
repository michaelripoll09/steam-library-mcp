import { describe, expect, test, vi } from "vitest";

import { TtlCache } from "../src/cache/ttl-cache.js";
import { loadConfig } from "../src/config.js";
import { GameNotFoundError, InputError, SteamUnavailableError } from "../src/errors.js";
import { createSteamService } from "../src/services/steam-service.js";
import type { SteamApiClient } from "../src/steam/client.js";

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
          recentPlaytimeMinutes: 42,
          lastPlayedAt: "2023-11-14T22:13:20.000Z",
          imageUrl:
            "https://media.steampowered.com/steamcommunity/public/images/apps/620/portal-logo.jpg",
        },
        { appId: 440, name: "Team Fortress 2", playtimeMinutes: 0 },
      ],
    });
    expect(second).toBe(first);
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
});
