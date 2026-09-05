import { describe, expect, it, vi } from "vitest";

import { TtlCache } from "../../src/cache/ttl-cache.js";
import { loadConfig } from "../../src/config.js";
import { createSteamGame, type SteamGame } from "../../src/domain/models.js";
import { GameNotFoundError } from "../../src/errors.js";
import { createAchievementService } from "../../src/services/achievement-service.js";
import type { SteamService } from "../../src/services/steam-service.js";
import type { SteamApiClient } from "../../src/steam/client.js";

const config = loadConfig({
  STEAM_API_KEY: "test-api-key",
  STEAM_ID: "76561198000000000",
});

const portal2 = createSteamGame({
  appId: 620,
  name: "Portal 2",
  playtimeMinutes: 135,
  accessType: "owned",
  isPlayable: true,
});

function createSteamClient(overrides: Partial<SteamApiClient> = {}): SteamApiClient {
  return {
    getOwnedGames: vi.fn(),
    getRecentGames: vi.fn(),
    getPlayerAchievements: vi.fn(async () => ({
      playerstats: {
        success: true,
        achievements: [
          { apiname: "ACH_PORTAL", achieved: 1, unlocktime: 1_700_000_000 },
          { apiname: "ACH_LOCKED", achieved: 0, unlocktime: 0 },
        ],
      },
    })),
    getAchievementSchema: vi.fn(async () => ({
      game: {
        gameName: "Portal 2",
        availableGameStats: {
          achievements: [
            {
              name: "ACH_PORTAL",
              displayName: "The Part Where He Kills You",
              description: "This is that part.",
              icon: "https://cdn.example.test/portal.png",
              icongray: "https://cdn.example.test/portal-gray.png",
            },
            {
              name: "ACH_LOCKED",
              displayName: "Still Alive",
              hidden: 1,
              icon: "https://cdn.example.test/locked.png",
            },
          ],
        },
      },
    })),
    ...overrides,
  };
}

function createSteamService(game: SteamGame = portal2): SteamService {
  return {
    getLibrary: vi.fn(),
    refreshLibrary: vi.fn(),
    searchLibrary: vi.fn(),
    getGame: vi.fn(async (appId: number) => {
      if (appId !== game.appId) throw new GameNotFoundError(appId);
      return game;
    }),
    getRecentGames: vi.fn(),
    getLibraryStats: vi.fn(),
  };
}

function createSubject({
  game = portal2,
  client = createSteamClient(),
  now = () => Date.parse("2026-09-05T00:00:00.000Z"),
}: {
  game?: SteamGame;
  client?: SteamApiClient;
  now?: () => number;
} = {}) {
  return {
    service: createAchievementService({
      config,
      steamService: createSteamService(game),
      steamClient: client,
      cache: new TtlCache({ now }),
    }),
    client,
  };
}

describe("AchievementService", () => {
  it("requires the game to exist in the configured library", async () => {
    const { service, client } = createSubject();

    await expect(service.getGameAchievements(440)).rejects.toBeInstanceOf(GameNotFoundError);
    expect(client.getPlayerAchievements).not.toHaveBeenCalled();
    expect(client.getAchievementSchema).not.toHaveBeenCalled();
  });

  it("rejects a manual game marked not playable without calling Steam stats", async () => {
    const manualGame = createSteamGame({
      appId: 1245620,
      name: "ELDEN RING",
      playtimeMinutes: 0,
      accessType: "manual",
      isPlayable: false,
      manualCollection: true,
    });
    const { service, client } = createSubject({ game: manualGame });

    await expect(service.getGameAchievements(1245620)).resolves.toEqual({
      status: "unavailable",
      appId: 1245620,
      name: "ELDEN RING",
      reason: "not_playable",
    });
    expect(client.getPlayerAchievements).not.toHaveBeenCalled();
    expect(client.getAchievementSchema).not.toHaveBeenCalled();
  });

  it("merges player progress and schema by api name", async () => {
    const { service } = createSubject();

    await expect(service.getGameAchievements(620)).resolves.toEqual({
      status: "available",
      progress: {
        appId: 620,
        name: "Portal 2",
        unlockedCount: 1,
        totalCount: 2,
        completionPercent: 50,
        achievements: [
          {
            apiName: "ACH_PORTAL",
            displayName: "The Part Where He Kills You",
            description: "This is that part.",
            achieved: true,
            unlockTime: "2023-11-14T22:13:20.000Z",
            iconUrl: "https://cdn.example.test/portal.png",
            iconGrayUrl: "https://cdn.example.test/portal-gray.png",
          },
          {
            apiName: "ACH_LOCKED",
            displayName: "Still Alive",
            description: null,
            achieved: false,
            unlockTime: null,
            iconUrl: "https://cdn.example.test/locked.png",
            iconGrayUrl: null,
          },
        ],
      },
    });
  });

  it("calculates completion percent deterministically", async () => {
    const client = createSteamClient({
      getPlayerAchievements: vi.fn(async () => ({
        playerstats: {
          success: true,
          achievements: [
            { apiname: "ACH_ONE", achieved: 1, unlocktime: 1 },
            { apiname: "ACH_TWO", achieved: 1, unlocktime: 2 },
          ],
        },
      })),
      getAchievementSchema: vi.fn(async () => ({
        game: {
          gameName: "Portal 2",
          availableGameStats: {
            achievements: [{ name: "ACH_ONE" }, { name: "ACH_TWO" }, { name: "ACH_THREE" }],
          },
        },
      })),
    });
    const { service } = createSubject({ client });

    await expect(service.getGameAchievements(620)).resolves.toMatchObject({
      status: "available",
      progress: { unlockedCount: 2, totalCount: 3, completionPercent: 66.67 },
    });
  });

  it("returns unlockTime null for locked achievements", async () => {
    const { service } = createSubject();

    const result = await service.getGameAchievements(620);

    expect(result).toMatchObject({
      status: "available",
      progress: {
        achievements: [expect.anything(), expect.objectContaining({ unlockTime: null })],
      },
    });
  });

  it("returns unavailable when Steam exposes no achievement list", async () => {
    const client = createSteamClient({
      getPlayerAchievements: vi.fn(async () => ({
        playerstats: { success: false, achievements: [] },
      })),
    });
    const { service } = createSubject({ client });

    await expect(service.getGameAchievements(620)).resolves.toEqual({
      status: "unavailable",
      appId: 620,
      name: "Portal 2",
      reason: "not_available",
    });
  });

  it("caches one app result for five minutes", async () => {
    let now = 0;
    const client = createSteamClient();
    const { service } = createSubject({ client, now: () => now });

    await service.getGameAchievements(620);
    now = 5 * 60 * 1000 - 1;
    await service.getGameAchievements(620);

    expect(client.getPlayerAchievements).toHaveBeenCalledTimes(1);
    expect(client.getAchievementSchema).toHaveBeenCalledTimes(1);
  });

  it("refreshes after cache expiry", async () => {
    let now = 0;
    const client = createSteamClient();
    const { service } = createSubject({ client, now: () => now });

    await service.getGameAchievements(620);
    now = 5 * 60 * 1000;
    await service.getGameAchievements(620);

    expect(client.getPlayerAchievements).toHaveBeenCalledTimes(2);
    expect(client.getAchievementSchema).toHaveBeenCalledTimes(2);
  });
});
