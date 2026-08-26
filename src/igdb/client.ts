import type { IgdbCredentials } from "../config.js";
import { createMetadataUnavailableEnvelope, type MetadataUnavailableEnvelope } from "../errors.js";
import { igdbGamesResponseSchema, type IgdbGame } from "./schemas.js";
import { IgdbTokenProvider, isMetadataUnavailable } from "./token-provider.js";

const IGDB_GAMES_URL = "https://api.igdb.com/v4/games";
const IGDB_GAME_FIELDS =
  "id,external_games.category,external_games.uid,genres.name,keywords.name,themes.name,first_release_date";
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

export type IgdbClient = Readonly<{
  findGamesForSteamApp(appId: number): Promise<readonly IgdbGame[] | MetadataUnavailableEnvelope>;
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
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetchLike(input, { ...init, signal: controller.signal });
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
    ): Promise<readonly IgdbGame[] | MetadataUnavailableEnvelope> {
      try {
        const accessToken = await tokenProvider.getAccessToken();
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const response = await fetchWithTimeout(fetchLike, IGDB_GAMES_URL, {
            method: "POST",
            headers: {
              "Client-ID": credentials.clientId,
              Authorization: `Bearer ${accessToken}`,
            },
            body: `fields ${IGDB_GAME_FIELDS}; where external_games.uid = "${appId}";`,
          });

          if (response.status === 429 && attempt === 0) {
            await sleep(retryDelay(response));
            continue;
          }
          if (!response.ok) {
            return unavailable();
          }

          return igdbGamesResponseSchema.parse(await response.json());
        }
        return unavailable();
      } catch (cause) {
        if (isMetadataUnavailable(cause)) {
          return cause;
        }
        return unavailable();
      }
    },
  });
}
