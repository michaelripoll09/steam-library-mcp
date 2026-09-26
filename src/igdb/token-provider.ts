import type { AbortOptions } from "../abort-options.js";
import { throwIfAborted } from "../abort-options.js";
import type { IgdbCredentials } from "../config.js";
import { createMetadataUnavailableEnvelope, type MetadataUnavailableEnvelope } from "../errors.js";
import { twitchTokenSchema } from "./schemas.js";

const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const REQUEST_TIMEOUT_MS = 10_000;
const TOKEN_REFRESH_SAFETY_MS = 60_000;

type FetchLike = typeof fetch;

type TokenProviderDependencies = Readonly<{
  credentials: IgdbCredentials;
  fetch?: FetchLike;
  now?: () => number;
}>;

type CachedToken = Readonly<{ value: string; expiresAt: number }>;

export class IgdbTokenProvider {
  private readonly credentials: IgdbCredentials;
  private readonly fetchLike: FetchLike;
  private readonly now: () => number;
  private cachedToken: CachedToken | undefined;

  constructor({
    credentials,
    fetch: fetchLike = globalThis.fetch,
    now = Date.now,
  }: TokenProviderDependencies) {
    this.credentials = credentials;
    this.fetchLike = fetchLike;
    this.now = now;
  }

  async getAccessToken(options?: AbortOptions): Promise<string> {
    throwIfAborted(options);
    if (this.cachedToken !== undefined && this.cachedToken.expiresAt > this.now()) {
      return this.cachedToken.value;
    }

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
      const response = await this.fetchLike(TWITCH_TOKEN_URL, {
        method: "POST",
        redirect: "error",
        body: new URLSearchParams({
          client_id: this.credentials.clientId,
          client_secret: this.credentials.clientSecret,
          grant_type: "client_credentials",
        }),
        signal: requestSignal,
      });
      throwIfAborted(options);
      if (timedOut) throw new Error("Twitch token request timed out.");
      if (!response.ok) {
        throw new Error("Twitch token request failed");
      }

      const token = twitchTokenSchema.parse(await response.json());
      throwIfAborted(options);
      if (timedOut) throw new Error("Twitch token request timed out.");
      this.cachedToken = {
        value: token.access_token,
        expiresAt: this.now() + Math.max(0, token.expires_in * 1_000 - TOKEN_REFRESH_SAFETY_MS),
      };
      return token.access_token;
    } catch (cause) {
      if (options?.signal?.aborted) throw options.signal.reason ?? cause;
      throw createMetadataUnavailableEnvelope({
        message: "Game metadata is temporarily unavailable.",
        retryable: true,
        cause,
      } satisfies Readonly<{ message: string; retryable: boolean; cause?: unknown }>);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function isMetadataUnavailable(value: unknown): value is MetadataUnavailableEnvelope {
  return (
    typeof value === "object" &&
    value !== null &&
    "isError" in value &&
    (value as { isError?: unknown }).isError === true
  );
}
