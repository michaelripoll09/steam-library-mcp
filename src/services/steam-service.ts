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
import type { SteamGameDto } from "../steam/schemas.js";

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
    const library = createSteamLibrary({
      steamId: config.steamId,
      games: response.response.games.map(normalizeGame),
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
      return response.response.games.map(normalizeGame);
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

function normalizeGame(game: SteamGameDto): SteamGame {
  return createSteamGame({
    appId: game.appid,
    name: game.name,
    playtimeMinutes: game.playtime_forever,
    ...(game.playtime_2weeks === undefined ? {} : { recentPlaytimeMinutes: game.playtime_2weeks }),
    ...(game.rtime_last_played === undefined
      ? {}
      : { lastPlayedAt: new Date(game.rtime_last_played * 1000).toISOString() }),
    ...(game.img_logo_url === undefined ? {} : { imageUrl: imageUrlFor(game) }),
  });
}

function imageUrlFor(game: SteamGameDto): string {
  return `https://media.steampowered.com/steamcommunity/public/images/apps/${game.appid}/${game.img_logo_url}.jpg`;
}
