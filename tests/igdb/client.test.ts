import { describe, expect, test, vi } from "vitest";

import { loadIgdbConfig } from "../../src/config.js";
import { createMetadataUnavailableEnvelope } from "../../src/errors.js";
import { createIgdbClient } from "../../src/igdb/client.js";
import { igdbGamesResponseSchema, twitchTokenSchema } from "../../src/igdb/schemas.js";
import { IgdbTokenProvider } from "../../src/igdb/token-provider.js";

const credentials = {
  clientId: "free-twitch-client-id",
  clientSecret: "never-disclose-this-secret",
} as const;

function tokenResponse(): Response {
  return new Response(
    JSON.stringify({
      access_token: "temporary-access-token",
      token_type: "bearer",
      expires_in: 3600,
    }),
    { status: 200 },
  );
}

describe("lazy IGDB configuration", () => {
  test("keeps metadata disabled when either free Twitch credential is absent or blank", () => {
    expect(loadIgdbConfig({ IGDB_CLIENT_ID: "free-id" })).toEqual({ enabled: false });
    expect(loadIgdbConfig({ IGDB_CLIENT_ID: "   ", IGDB_CLIENT_SECRET: "free-secret" })).toEqual({
      enabled: false,
    });
  });

  test("returns trimmed environment-only credentials without exposing secret configuration details", () => {
    expect(
      loadIgdbConfig({
        IGDB_CLIENT_ID: " free-id ",
        IGDB_CLIENT_SECRET: " free-secret ",
      }),
    ).toEqual({ enabled: true, clientId: "free-id", clientSecret: "free-secret" });
  });
});

describe("metadata unavailable envelope", () => {
  test("uses the exact public configuration-unavailable shape without leaking a secret", () => {
    const envelope = createMetadataUnavailableEnvelope({
      message: "Configure IGDB_CLIENT_ID and IGDB_CLIENT_SECRET to use metadata tools.",
      retryable: false,
      cause: new Error(credentials.clientSecret),
    });

    expect(envelope).toEqual({
      isError: true,
      error: {
        code: "METADATA_UNAVAILABLE",
        message: "Configure IGDB_CLIENT_ID and IGDB_CLIENT_SECRET to use metadata tools.",
        retryable: false,
      },
    });
    expect(JSON.stringify(envelope)).not.toContain(credentials.clientSecret);
  });

  test("uses a retryable temporary message without raw upstream details", () => {
    const envelope = createMetadataUnavailableEnvelope({
      message: "Game metadata is temporarily unavailable.",
      retryable: true,
      cause: new Error("raw response header: bearer secret"),
    });

    expect(envelope).toEqual({
      isError: true,
      error: {
        code: "METADATA_UNAVAILABLE",
        message: "Game metadata is temporarily unavailable.",
        retryable: true,
      },
    });
    expect(JSON.stringify(envelope)).not.toContain("bearer secret");
  });
});

describe("IGDB schemas", () => {
  test("accepts only complete OAuth token payloads with a positive expiry", () => {
    expect(
      twitchTokenSchema.parse({ access_token: "token", token_type: "bearer", expires_in: 3600 }),
    ).toEqual({ access_token: "token", token_type: "bearer", expires_in: 3600 });

    expect(() =>
      twitchTokenSchema.parse({ access_token: "", token_type: "bearer", expires_in: 0 }),
    ).toThrow();
  });

  test("rejects game records without valid IDs, Steam external-game pairs, or named metadata", () => {
    expect(() =>
      igdbGamesResponseSchema.parse([
        {
          id: "not-a-number",
          external_games: [{ category: 1, uid: "620" }],
          genres: [{ name: "Puzzle" }],
        },
      ]),
    ).toThrow();

    expect(
      igdbGamesResponseSchema.parse([
        {
          id: 620,
          external_games: [{ category: 1, uid: "620" }],
          genres: [{ name: "Puzzle" }],
        },
      ]),
    ).toEqual([
      {
        id: 620,
        external_games: [{ category: 1, uid: "620" }],
        genres: [{ name: "Puzzle" }],
      },
    ]);
  });
});

describe("IGDB client", () => {
  test("requests the nested fields required to parse a successful game lookup", async () => {
    const expandedGame = [
      {
        id: 620,
        external_games: [{ id: 1, uid: "620" }],
        genres: [{ name: "Puzzle" }],
        keywords: [{ name: "Portal" }],
        themes: [{ name: "Science fiction" }],
        first_release_date: 1_280_304_000,
      },
    ];
    const fetchLike = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockImplementationOnce(async (_url: string | URL | Request, init?: RequestInit) => {
        const fields = String(init?.body);
        return new Response(
          JSON.stringify(
            fields.includes("external_games.category") &&
              fields.includes("external_games.uid") &&
              fields.includes("genres.name") &&
              fields.includes("keywords.name") &&
              fields.includes("themes.name")
              ? expandedGame
              : [{ id: 620, external_games: [1], genres: [2], keywords: [3], themes: [4] }],
          ),
          { status: 200 },
        );
      });
    const client = createIgdbClient({ credentials, fetch: fetchLike as typeof fetch });

    await expect(client.findGamesForSteamApp(620)).resolves.toEqual([
      {
        ...expandedGame[0],
        external_games: [{ uid: "620" }],
      },
    ]);
  });

  test("aborts the OAuth request at ten seconds", async () => {
    vi.useFakeTimers();
    const fetchLike = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const provider = new IgdbTokenProvider({ credentials, fetch: fetchLike as typeof fetch });

    const token = provider.getAccessToken();
    const assertion = expect(token).rejects.toEqual({
      isError: true,
      error: {
        code: "METADATA_UNAVAILABLE",
        message: "Game metadata is temporarily unavailable.",
        retryable: true,
      },
    });
    await vi.advanceTimersByTimeAsync(10_000);

    await assertion;
    expect(fetchLike.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    vi.useRealTimers();
  });

  test("rejects an invalid IGDB payload and does not cache it", async () => {
    const fetchLike = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: "invalid" }]), { status: 200 }));
    const client = createIgdbClient({ credentials, fetch: fetchLike as typeof fetch });

    await expect(client.findGamesForSteamApp(620)).resolves.toEqual({
      isError: true,
      error: {
        code: "METADATA_UNAVAILABLE",
        message: "Game metadata is temporarily unavailable.",
        retryable: true,
      },
    });
    await client.findGamesForSteamApp(620);

    expect(fetchLike).toHaveBeenCalledTimes(3);
  });

  test("attaches an abort signal to each IGDB lookup to enforce the ten-second timeout", async () => {
    let requestSignal: AbortSignal | undefined;
    const fetchLike = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockImplementationOnce(async (_url: string | URL | Request, init?: RequestInit) => {
        requestSignal = init?.signal ?? undefined;
        return new Response(JSON.stringify([]), { status: 200 });
      });
    const client = createIgdbClient({ credentials, fetch: fetchLike as typeof fetch });

    await expect(client.findGamesForSteamApp(620)).resolves.toEqual([]);

    expect(requestSignal).toBeInstanceOf(AbortSignal);
  });

  test("retries a 429 response exactly once before returning a safe unavailable envelope", async () => {
    const fetchLike = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(
        new Response("rate limited", { status: 429, headers: { "retry-after": "0" } }),
      )
      .mockResolvedValueOnce(
        new Response("rate limited", { status: 429, headers: { "retry-after": "0" } }),
      );
    const sleep = vi.fn(async () => undefined);
    const client = createIgdbClient({ credentials, fetch: fetchLike as typeof fetch, sleep });

    await expect(client.findGamesForSteamApp(620)).resolves.toEqual({
      isError: true,
      error: {
        code: "METADATA_UNAVAILABLE",
        message: "Game metadata is temporarily unavailable.",
        retryable: true,
      },
    });

    expect(fetchLike).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(0);
  });
});
