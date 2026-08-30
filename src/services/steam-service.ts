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
import {
  parseManualSteamInput,
  type ManualLibraryGame,
  type ManualLibraryRepository,
  type PublicSteamGameLookup,
} from "../manual-library/manual-library.js";

export interface SteamService {
  getLibrary(): Promise<SteamLibrary>;
  refreshLibrary(): Promise<SteamLibrary>;
  searchLibrary(query: string): Promise<readonly SteamGame[]>;
  getGame(appId: number): Promise<SteamGame>;
  getRecentGames(count?: number): Promise<readonly SteamGame[]>;
  getLibraryStats(): Promise<LibraryStats>;
  getManualCollection?(): readonly ManualLibraryGame[];
  addManualCollection?(steam: unknown): Promise<ManualLibraryGame>;
  removeManualCollection?(appId: number): boolean;
}

type SteamServiceDependencies = Readonly<{
  config: AppConfig;
  steamClient: SteamApiClient;
  cache: Cache<SteamLibrary>;
  clock: Clock;
  manualRepository?: ManualLibraryRepository;
  publicGameLookup?: PublicSteamGameLookup;
}>;

const libraryCacheKey = (steamId: string): string => `library:${steamId}`;

export function createSteamService({
  config,
  steamClient,
  cache,
  clock,
  manualRepository,
  publicGameLookup,
}: SteamServiceDependencies): SteamService {
  async function getLibrary(): Promise<SteamLibrary> {
    const key = libraryCacheKey(config.steamId);
    const cached = cache.get(key);
    if (cached !== undefined) {
      return mergeManualCollection(cached, manualRepository?.list() ?? []);
    }

    return refreshLibrary();
  }

  async function refreshLibrary(): Promise<SteamLibrary> {
    const key = libraryCacheKey(config.steamId);
    const response = await steamClient.getOwnedGames(config.steamId);
    const baseLibrary = createSteamLibrary({
      steamId: config.steamId,
      games: response.response.games.map(normalizeOwnedGame),
      fetchedAt: new Date(clock.now()).toISOString(),
    });
    cache.set(key, baseLibrary, config.libraryCacheTtlMs);
    return mergeManualCollection(baseLibrary, manualRepository?.list() ?? []);
  }

  return {
    getLibrary,
    refreshLibrary,
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
      return response.response.games.map(normalizeRecentGame).sort(sortByLastPlayedAtDescending);
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
    getManualCollection() {
      return manualRepository?.list() ?? [];
    },
    async addManualCollection(steam) {
      if (manualRepository === undefined || publicGameLookup === undefined)
        throw new InputError("Manual collections are unavailable.");
      const appId = parseManualSteamInput(steam);
      const game = await publicGameLookup(appId);
      const existing = manualRepository.list().find((entry) => entry.appId === appId);
      if (existing !== undefined && existing.name === game.name) return existing;
      const timestamp = new Date(clock.now()).toISOString();
      const stored = manualRepository.upsert({
        appId,
        name: game.name,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      });
      cache.clear();
      return stored;
    },
    removeManualCollection(appId) {
      if (!Number.isSafeInteger(appId) || appId <= 0)
        throw new InputError("The app ID must be a positive integer.");
      const removed = manualRepository?.remove(appId) ?? false;
      if (removed) cache.clear();
      return removed;
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

function mergeManualCollection(
  baseLibrary: SteamLibrary,
  manualGames: readonly ManualLibraryGame[],
): SteamLibrary {
  const ownedByAppId = new Map(baseLibrary.games.map((game) => [game.appId, game]));
  const manualOnlyGames = manualGames
    .filter((game) => !ownedByAppId.has(game.appId))
    .map(normalizeManualGame);
  return createSteamLibrary({
    ...baseLibrary,
    games: [...ownedByAppId.values(), ...manualOnlyGames],
  });
}

function normalizeManualGame(game: ManualLibraryGame): SteamGame {
  return createSteamGame({
    appId: game.appId,
    name: game.name,
    playtimeMinutes: 0,
    accessType: "manual",
    isPlayable: false,
    manualCollection: true,
  });
}

function sortByLastPlayedAtDescending(left: SteamGame, right: SteamGame): number {
  if (left.lastPlayedAt === undefined) {
    return right.lastPlayedAt === undefined ? 0 : 1;
  }
  if (right.lastPlayedAt === undefined) {
    return -1;
  }
  return right.lastPlayedAt.localeCompare(left.lastPlayedAt);
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

function imageUrlFor(game: SteamGameDto): string {
  return `https://media.steampowered.com/steamcommunity/public/images/apps/${game.appid}/${game.img_logo_url}.jpg`;
}
