export interface SteamGame {
  readonly appId: number;
  readonly name: string;
  readonly playtimeMinutes: number;
  readonly recentPlaytimeMinutes?: number;
  readonly lastPlayedAt?: string;
  readonly imageUrl?: string;
}

export interface SteamLibrary {
  readonly steamId: string;
  readonly games: readonly SteamGame[];
  readonly fetchedAt: string;
}

export interface LibraryStats {
  readonly totalGames: number;
  readonly playedGames: number;
  readonly unplayedGames: number;
  readonly totalPlaytimeMinutes: number;
  readonly recentlyPlayedGames: number;
}

type SteamGameInput = SteamGame & Readonly<Record<string, unknown>>;
type SteamLibraryInput = SteamLibrary & Readonly<Record<string, unknown>>;

export function createSteamGame(input: SteamGameInput): SteamGame {
  return Object.freeze({
    appId: input.appId,
    name: input.name,
    playtimeMinutes: input.playtimeMinutes,
    ...(input.recentPlaytimeMinutes === undefined
      ? {}
      : { recentPlaytimeMinutes: input.recentPlaytimeMinutes }),
    ...(input.lastPlayedAt === undefined ? {} : { lastPlayedAt: input.lastPlayedAt }),
    ...(input.imageUrl === undefined ? {} : { imageUrl: input.imageUrl }),
  });
}

export function createSteamLibrary(input: SteamLibraryInput): SteamLibrary {
  return Object.freeze({
    steamId: input.steamId,
    games: Object.freeze([...input.games]),
    fetchedAt: input.fetchedAt,
  });
}
