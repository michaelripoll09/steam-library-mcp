import type { Cache, Clock } from "../cache/ttl-cache.js";
import type { AppConfig } from "../config.js";
import {
  createSteamGame,
  createSteamLibrary,
  type LibraryStats,
  type SteamGame,
  type SteamLibrary,
} from "../domain/models.js";
import { GameNotFoundError, InputError } from "../errors.js";
import type { SteamApiClient } from "../steam/client.js";
import type { SteamFamilyGameDto, SteamGameDto } from "../steam/schemas.js";

export interface SteamService {
  getLibrary(): Promise<SteamLibrary>;
  searchLibrary(query: string): Promise<readonly SteamGame[]>;
  getGame(appId: number): Promise<SteamGame>;
  getRecentGames(count?: number): Promise<readonly SteamGame[]>;
  getLibraryStats(): Promise<LibraryStats>;
}

type SteamServiceDependencies = Readonly<{
  config: AppConfig;
  steamClient: SteamApiClient;
  cache: Cache<SteamLibrary>;
  clock: Clock;
}>;

const libraryCacheKey = (steamId: string): string => `library:${steamId}`;

export function createSteamService({
  config,
  steamClient,
  cache,
  clock,
}: SteamServiceDependencies): SteamService {
  async function getLibrary(): Promise<SteamLibrary> {
    const key = libraryCacheKey(config.steamId);
    const cached = cache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const response = await steamClient.getOwnedGames(config.steamId);
    const familyGames = await getFamilyGames(steamClient, config);
    const library = createSteamLibrary({
      steamId: config.steamId,
      games: mergeGames(response.response.games, familyGames, config.steamId),
      fetchedAt: new Date(clock.now()).toISOString(),
    });
    cache.set(key, library, config.libraryCacheTtlMs);
    return library;
  }

  return {
    getLibrary,
    async searchLibrary(query) {
      const normalizedQuery = query.trim().toLocaleLowerCase();
      const { games } = await getLibrary();
      return games.filter((game) => game.name.toLocaleLowerCase().includes(normalizedQuery));
    },
    async getGame(appId) {
      const { games } = await getLibrary();
      const game = games.find((candidate) => candidate.appId === appId);
      if (game === undefined) {
        throw new GameNotFoundError(appId);
      }
      return game;
    },
    async getRecentGames(count) {
      assertRecentGameCount(count);
      const response = await steamClient.getRecentGames(config.steamId, count);
      return response.response.games.map(normalizeRecentGame);
    },
    async getLibraryStats() {
      const { games } = await getLibrary();
      return {
        totalGames: games.length,
        playedGames: games.filter((game) => game.playtimeMinutes > 0).length,
        unplayedGames: games.filter((game) => game.playtimeMinutes === 0).length,
        totalPlaytimeMinutes: games.reduce((total, game) => total + game.playtimeMinutes, 0),
        recentlyPlayedGames: games.filter((game) => game.recentPlaytimeMinutes !== undefined)
          .length,
      };
    },
  };
}

function assertRecentGameCount(count: number | undefined): void {
  if (count === undefined) {
    return;
  }
  if (!Number.isInteger(count) || count < 1 || count > 50) {
    throw new InputError("Recent game count must be an integer from 1 through 50.");
  }
}

async function getFamilyGames(
  steamClient: SteamApiClient,
  config: AppConfig,
): Promise<readonly SteamFamilyGameDto[]> {
  if (config.steamWebApiToken === undefined || steamClient.getFamilyGames === undefined) {
    return [];
  }
  try {
    return await steamClient.getFamilyGames(config.steamId);
  } catch {
    return [];
  }
}

function mergeGames(
  ownedGames: readonly SteamGameDto[],
  familyGames: readonly SteamFamilyGameDto[],
  steamId: string,
): readonly SteamGame[] {
  const ownedByAppId = new Map(ownedGames.map((game) => [game.appid, normalizeOwnedGame(game)]));
  const familyOnlyGames = familyGames
    .filter((game) => !ownedByAppId.has(game.appid))
    .map((game) =>
      game.owner_steamids.includes(steamId)
        ? normalizeOwnedFamilyGame(game)
        : normalizeFamilyGame(game),
    );
  return [...ownedByAppId.values(), ...familyOnlyGames];
}

function normalizeOwnedGame(game: SteamGameDto): SteamGame {
  return createSteamGame({
    ...normalizeGameFields(game),
    accessType: "owned",
    isPlayable: true,
  });
}

function normalizeRecentGame(game: SteamGameDto): SteamGame {
  return createSteamGame(normalizeGameFields(game));
}

function normalizeGameFields(game: SteamGameDto): Parameters<typeof createSteamGame>[0] {
  return {
    appId: game.appid,
    name: game.name,
    playtimeMinutes: game.playtime_forever,
    ...(game.playtime_2weeks === undefined ? {} : { recentPlaytimeMinutes: game.playtime_2weeks }),
    ...(game.rtime_last_played === undefined
      ? {}
      : { lastPlayedAt: new Date(game.rtime_last_played * 1000).toISOString() }),
    ...(game.img_logo_url === undefined ? {} : { imageUrl: imageUrlFor(game) }),
  };
}

function normalizeFamilyGame(game: SteamFamilyGameDto): SteamGame {
  return createSteamGame({
    appId: game.appid,
    name: game.name,
    playtimeMinutes: game.rt_playtime,
    accessType: "family_shared",
    isPlayable: game.exclude_reason === 0,
  });
}

function normalizeOwnedFamilyGame(game: SteamFamilyGameDto): SteamGame {
  return createSteamGame({
    appId: game.appid,
    name: game.name,
    playtimeMinutes: game.rt_playtime,
    accessType: "owned",
    isPlayable: true,
  });
}

function imageUrlFor(game: SteamGameDto): string {
  return `https://media.steampowered.com/steamcommunity/public/images/apps/${game.appid}/${game.img_logo_url}.jpg`;
}
