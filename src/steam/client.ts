import { z } from "zod";

import type { AppConfig } from "../config.js";
import {
  AppError,
  SteamResponseError,
  SteamTimeoutError,
  SteamUnavailableError,
} from "../errors.js";
import {
  ownedGamesResponseSchema,
  recentGamesResponseSchema,
  type SteamOwnedGamesResponse,
  type SteamRecentGamesResponse,
  type SteamFamilyGameDto,
  type SteamFamilyGroupResponse,
  familyGroupResponseSchema,
  familySharedGamesResponseSchema,
} from "./schemas.js";

export type FetchLike = typeof fetch;

export interface SteamApiClient {
  getOwnedGames(steamId: string): Promise<SteamOwnedGamesResponse>;
  getRecentGames(steamId: string, count?: number): Promise<SteamRecentGamesResponse>;
  getFamilyGames?(steamId: string): Promise<readonly SteamFamilyGameDto[]>;
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
    ...(config.steamWebApiToken === undefined
      ? {}
      : {
          getFamilyGames: async (steamId: string) => {
            const group = await requestSteam(
              fetchLike,
              config,
              "/IFamilyGroupsService/GetFamilyGroupForUser/v1/",
              {
                access_token: config.steamWebApiToken!,
                steamid: steamId,
                include_family_group_response: "true",
              },
              familyGroupResponseSchema,
              false,
            );
            const groupId = familyGroupId(group);
            if (groupId === undefined) {
              return [];
            }
            const library = await requestSteam(
              fetchLike,
              config,
              "/IFamilyGroupsService/GetSharedLibraryApps/v1/",
              {
                access_token: config.steamWebApiToken!,
                family_groupid: groupId,
                include_own: "true",
                include_excluded: "true",
                include_free: "false",
                include_non_games: "false",
                language: "english",
              },
              familySharedGamesResponseSchema,
              false,
            );
            return library.response.apps;
          },
        }),
  };
}

async function requestSteam<T>(
  fetchLike: FetchLike,
  config: AppConfig,
  path: string,
  query: Readonly<Record<string, string>>,
  schema: z.ZodType<T>,
  includeApiKey = true,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

  try {
    const response = await fetchLike(
      createSteamUrl(path, config.steamApiKey, query, includeApiKey),
      {
        signal: controller.signal,
      },
    );

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
  includeApiKey: boolean,
): URL {
  const parameters = new URLSearchParams({ ...(includeApiKey ? { key: apiKey } : {}), ...query });
  return new URL(`${path}?${parameters.toString()}`, steamApiBaseUrl);
}

function familyGroupId(response: SteamFamilyGroupResponse): string | undefined {
  return response.response.is_not_member_of_any_group === true
    ? undefined
    : response.response.family_groupid;
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    throw new SteamResponseError(error);
  }
}
