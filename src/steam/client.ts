import { z } from "zod";

import type { AppConfig } from "../config.js";
import {
  AppError,
  SteamResponseError,
  SteamTimeoutError,
  SteamUnavailableError,
} from "../errors.js";
import {
  gameSchemaResponseSchema,
  ownedGamesResponseSchema,
  playerAchievementsResponseSchema,
  recentGamesResponseSchema,
  type SteamGameSchemaResponse,
  type SteamOwnedGamesResponse,
  type SteamPlayerAchievementsResponse,
  type SteamRecentGamesResponse,
} from "./schemas.js";

export type FetchLike = typeof fetch;

export interface SteamApiClient {
  getOwnedGames(steamId: string): Promise<SteamOwnedGamesResponse>;
  getRecentGames(steamId: string, count?: number): Promise<SteamRecentGamesResponse>;
  getPlayerAchievements(steamId: string, appId: number): Promise<SteamPlayerAchievementsResponse>;
  getAchievementSchema(appId: number): Promise<SteamGameSchemaResponse>;
}

type SteamApiClientDependencies = Readonly<{
  config: AppConfig;
  fetch?: FetchLike;
}>;

const steamApiBaseUrl = "https://api.steampowered.com";

export function createSteamApiClient({
  config,
  fetch: fetchLike = globalThis.fetch,
}: SteamApiClientDependencies): SteamApiClient {
  return {
    getOwnedGames: (steamId) =>
      requestSteam(
        fetchLike,
        config,
        "/IPlayerService/GetOwnedGames/v0001/",
        { steamid: steamId, include_appinfo: "true", include_played_free_games: "true" },
        ownedGamesResponseSchema,
      ),
    getRecentGames: (steamId, count) =>
      requestSteam(
        fetchLike,
        config,
        "/IPlayerService/GetRecentlyPlayedGames/v0001/",
        { steamid: steamId, ...(count === undefined ? {} : { count: String(count) }) },
        recentGamesResponseSchema,
      ),
    getPlayerAchievements: (steamId, appId) =>
      requestSteam(
        fetchLike,
        config,
        "/ISteamUserStats/GetPlayerAchievements/v0001/",
        { steamid: steamId, appid: String(appId), l: "english" },
        playerAchievementsResponseSchema,
      ),
    getAchievementSchema: (appId) =>
      requestSteam(
        fetchLike,
        config,
        "/ISteamUserStats/GetSchemaForGame/v2/",
        { appid: String(appId), l: "english" },
        gameSchemaResponseSchema,
      ),
  };
}

async function requestSteam<T>(
  fetchLike: FetchLike,
  config: AppConfig,
  path: string,
  query: Readonly<Record<string, string>>,
  schema: z.ZodType<T>,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

  try {
    const response = await fetchLike(createSteamUrl(path, config.steamApiKey, query), {
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new SteamUnavailableError();
    }

    const body = await parseJson(response);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new SteamResponseError(parsed.error);
    }

    return parsed.data;
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    if (controller.signal.aborted) {
      throw new SteamTimeoutError(error);
    }
    throw new SteamUnavailableError(error);
  } finally {
    clearTimeout(timeout);
  }
}

function createSteamUrl(
  path: string,
  apiKey: string,
  query: Readonly<Record<string, string>>,
): URL {
  const parameters = new URLSearchParams({ key: apiKey, ...query });
  return new URL(`${path}?${parameters.toString()}`, steamApiBaseUrl);
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    throw new SteamResponseError(error);
  }
}
