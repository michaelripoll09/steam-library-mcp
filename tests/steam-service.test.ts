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
    await expect(service.getLibrary()).resolves.toBe(cached);
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
  test("merges playable Steam Families games into the accessible library without relabeling owned games", async () => {
    const familyConfig = loadConfig({
      STEAM_API_KEY: "secret-key",
      STEAM_ID: "76561198000000000",
      STEAM_WEBAPI_TOKEN: "temporary-family-token",
    });
    const getFamilyGames = vi.fn(async () => [
      {
        appid: 620,
        name: "Portal 2",
        owner_steamids: [familyConfig.steamId],
        exclude_reason: 0,
        rt_playtime: 135,
      },
      {
        appid: 1196590,
        name: "Resident Evil Village",
        owner_steamids: ["76561198000000001"],
        exclude_reason: 0,
        rt_playtime: 285,
      },
      {
        appid: 999,
        name: "Unavailable shared game",
        owner_steamids: ["76561198000000001"],
        exclude_reason: 1,
        rt_playtime: 0,
      },
    ]);
    const service = createSteamService({
      config: familyConfig,
      steamClient: Object.assign(createClient(), { getFamilyGames }) as SteamApiClient,
      cache: new TtlCache(),
      clock: { now: () => 0 },
    });

    await expect(service.getLibrary()).resolves.toMatchObject({
      games: [
        { appId: 620, accessType: "owned", isPlayable: true },
        { appId: 440, accessType: "owned", isPlayable: true },
        { appId: 1196590, accessType: "family_shared", isPlayable: true },
        { appId: 999, accessType: "family_shared", isPlayable: false },
      ],
    });
  });

  test("falls back to owned games when the optional family synchronization fails", async () => {
    const familyConfig = loadConfig({
      STEAM_API_KEY: "secret-key",
      STEAM_ID: "76561198000000000",
      STEAM_WEBAPI_TOKEN: "temporary-family-token",
    });
    const service = createSteamService({
      config: familyConfig,
      steamClient: Object.assign(createClient(), {
        getFamilyGames: vi.fn(async () => {
          throw new SteamUnavailableError(new Error("temporary-family-token"));
        }),
      }) as SteamApiClient,
      cache: new TtlCache(),
      clock: { now: () => 0 },
    });

    await expect(service.getLibrary()).resolves.toMatchObject({
      games: [
        { appId: 620, accessType: "owned" },
        { appId: 440, accessType: "owned" },
      ],
    });
  });

  test("exposes the last played date for a family-shared game", async () => {
    const familyConfig = loadConfig({
      STEAM_API_KEY: "secret-key",
      STEAM_ID: "76561198000000000",
      STEAM_WEBAPI_TOKEN: "temporary-family-token",
    });
    const service = createSteamService({
      config: familyConfig,
      steamClient: Object.assign(
        createClient({ getOwnedGames: vi.fn(async () => ({ response: { games: [] } })) }),
        {
          getFamilyGames: vi.fn(async () => [
            {
              appid: 1196590,
              name: "Resident Evil Village",
              owner_steamids: ["76561198000000001"],
              exclude_reason: 0,
              rt_playtime: 285,
              rt_last_played: 1_700_000_000,
            },
          ]),
        },
      ) as SteamApiClient,
      cache: new TtlCache(),
      clock: { now: () => 0 },
    });

    await expect(service.getGame(1196590)).resolves.toMatchObject({
      accessType: "family_shared",
      lastPlayedAt: "2023-11-14T22:13:20.000Z",
    });
  });

  test("retains an owned game supplied only by the Steam Families catalog", async () => {
    const familyConfig = loadConfig({
      STEAM_API_KEY: "secret-key",
      STEAM_ID: "76561198000000000",
      STEAM_WEBAPI_TOKEN: "temporary-family-token",
    });
    const service = createSteamService({
      config: familyConfig,
      steamClient: Object.assign(createClient(), {
        getFamilyGames: vi.fn(async () => [
          {
            appid: 730,
            name: "Counter-Strike 2",
            owner_steamids: [familyConfig.steamId],
            exclude_reason: 0,
            rt_playtime: 0,
          },
        ]),
      }) as SteamApiClient,
      cache: new TtlCache(),
      clock: { now: () => 0 },
    });

    await expect(service.getGame(730)).resolves.toMatchObject({
      accessType: "owned",
      isPlayable: true,
    });
  });
});
