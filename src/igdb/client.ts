import type { AbortOptions } from "../abort-options.js";
import { throwIfAborted } from "../abort-options.js";
import type { IgdbCredentials } from "../config.js";
import { createMetadataUnavailableEnvelope, type MetadataUnavailableEnvelope } from "../errors.js";
import {
  igdbGameTimeToBeatsResponseSchema,
  igdbGamesResponseSchema,
  type IgdbGame,
  type IgdbGameTimeToBeat,
} from "./schemas.js";
import { IgdbTokenProvider, isMetadataUnavailable } from "./token-provider.js";

const IGDB_GAMES_URL = "https://api.igdb.com/v4/games";
const IGDB_GAME_TIME_TO_BEATS_URL = "https://api.igdb.com/v4/game_time_to_beats";
const IGDB_GAME_FIELDS =
  "id,name,external_games.category,external_games.uid,genres.name,keywords.name,themes.name,first_release_date";
const RATE_LIMIT_BACKOFF_MS = 500;
const REQUEST_TIMEOUT_MS = 10_000;

type FetchLike = typeof fetch;
type Sleep = (milliseconds: number) => Promise<void>;

type IgdbClientDependencies = Readonly<{
  credentials: IgdbCredentials;
  fetch?: FetchLike;
  sleep?: Sleep;
  tokenProvider?: IgdbTokenProvider;
}>;

export type IgdbGamesClient = Readonly<{
  findGamesForSteamApp(
    appId: number,
    options?: AbortOptions,
  ): Promise<readonly IgdbGame[] | MetadataUnavailableEnvelope>;
}>;

export type IgdbClient = IgdbGamesClient &
  Readonly<{
    findGameTimeToBeat(
      gameId: number,
      options?: AbortOptions,
    ): Promise<readonly IgdbGameTimeToBeat[] | MetadataUnavailableEnvelope>;
  }>;

const wait: Sleep = async (milliseconds) => {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
};

function unavailable(): MetadataUnavailableEnvelope {
  return createMetadataUnavailableEnvelope({
    message: "Game metadata is temporarily unavailable.",
    retryable: true,
  });
}

function retryDelay(response: Response): number {
  const seconds = Number.parseInt(response.headers.get("retry-after") ?? "", 10);
  return Number.isInteger(seconds) && seconds >= 0
    ? Math.min(seconds * 1_000, 1_000)
    : RATE_LIMIT_BACKOFF_MS;
}

async function fetchWithTimeout(
  fetchLike: FetchLike,
  input: string,
  init: Omit<RequestInit, "signal">,
  options?: AbortOptions,
): Promise<Response> {
  throwIfAborted(options);
  const controller = new AbortController();
  const requestSignal =
    options?.signal === undefined
      ? controller.signal
      : AbortSignal.any([options.signal, controller.signal]);
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    const response = await fetchLike(input, { ...init, redirect: "error", signal: requestSignal });
    throwIfAborted(options);
    if (timedOut) throw new Error("IGDB request timed out.");
    return response;
  } catch (error) {
    if (options?.signal?.aborted) throw options.signal.reason ?? error;
    if (timedOut) throw new Error("IGDB request timed out.", { cause: error });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function createIgdbClient({
  credentials,
  fetch: fetchLike = globalThis.fetch,
  sleep = wait,
  tokenProvider = new IgdbTokenProvider({ credentials, fetch: fetchLike }),
}: IgdbClientDependencies): IgdbClient {
  return Object.freeze({
    async findGamesForSteamApp(
      appId: number,
      options?: AbortOptions,
    ): Promise<readonly IgdbGame[] | MetadataUnavailableEnvelope> {
      try {
        throwIfAborted(options);
        const accessToken = await tokenProvider.getAccessToken(options);
        throwIfAborted(options);
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const response = await fetchWithTimeout(
            fetchLike,
            IGDB_GAMES_URL,
            {
              method: "POST",
              headers: {
                "Client-ID": credentials.clientId,
                Authorization: `Bearer ${accessToken}`,
              },
              body: `fields ${IGDB_GAME_FIELDS}; where external_games.uid = "${appId}";`,
            },
            options,
          );

          if (response.status === 429 && attempt === 0) {
            throwIfAborted(options);
            await sleep(retryDelay(response));
            throwIfAborted(options);
            continue;
          }
          if (!response.ok) {
            return unavailable();
          }

          return igdbGamesResponseSchema.parse(await response.json());
        }
        return unavailable();
      } catch (cause) {
        if (options?.signal?.aborted) throw options.signal.reason ?? cause;
        if (isMetadataUnavailable(cause)) {
          return cause;
        }
        return unavailable();
      }
    },
    async findGameTimeToBeat(
      gameId: number,
      options?: AbortOptions,
    ): Promise<readonly IgdbGameTimeToBeat[] | MetadataUnavailableEnvelope> {
      try {
        throwIfAborted(options);
        const accessToken = await tokenProvider.getAccessToken(options);
        throwIfAborted(options);
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const response = await fetchWithTimeout(
            fetchLike,
            IGDB_GAME_TIME_TO_BEATS_URL,
            {
              method: "POST",
              headers: {
                "Client-ID": credentials.clientId,
                Authorization: `Bearer ${accessToken}`,
              },
              body: `fields game_id,hastily,normally,completely; where game_id = ${gameId};`,
            },
            options,
          );

          if (response.status === 429 && attempt === 0) {
            throwIfAborted(options);
            await sleep(retryDelay(response));
            throwIfAborted(options);
            continue;
          }
          if (!response.ok) {
            return unavailable();
          }

          return igdbGameTimeToBeatsResponseSchema.parse(await response.json());
        }
        return unavailable();
      } catch (cause) {
        if (options?.signal?.aborted) throw options.signal.reason ?? cause;
        if (isMetadataUnavailable(cause)) {
          return cause;
        }
        return unavailable();
      }
    },
  });
}
