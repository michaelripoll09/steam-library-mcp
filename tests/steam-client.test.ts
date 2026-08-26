import { describe, expect, test, vi } from "vitest";

import { loadConfig } from "../src/config.js";
import { SteamResponseError, SteamTimeoutError, SteamUnavailableError } from "../src/errors.js";
import { createSteamApiClient } from "../src/steam/client.js";

const config = loadConfig({
  STEAM_API_KEY: "secret-key",
  STEAM_ID: "76561198000000000",
});

function ownedGamesResponse(): Response {
  return new Response(
    JSON.stringify({
      response: {
        game_count: 1,
        games: [{ appid: 620, name: "Portal 2", playtime_forever: 135 }],
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("Steam API client", () => {
  test("uses URLSearchParams to encode configured identity and key", async () => {
    const fetchLike = vi.fn<
      (input: string | URL | Request, init?: RequestInit) => Promise<Response>
    >(async () => ownedGamesResponse());
    const client = createSteamApiClient({ config, fetch: fetchLike as unknown as typeof fetch });

    await client.getOwnedGames("76561198000000000&include_appinfo=false");

    const [requestedUrl] = fetchLike.mock.calls[0] ?? [];
    const url = new URL(String(requestedUrl));
    expect(url.pathname).toContain("GetOwnedGames");
    expect(url.searchParams.get("key")).toBe("secret-key");
    expect(url.searchParams.get("steamid")).toBe("76561198000000000&include_appinfo=false");
    expect(url.searchParams.get("include_appinfo")).toBe("true");
  });

  test("aborts a request at the configured ten-second timeout", async () => {
    vi.useFakeTimers();
    const fetchLike = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const client = createSteamApiClient({ config, fetch: fetchLike as unknown as typeof fetch });

    const request = client.getOwnedGames(config.steamId);
    const assertion = expect(request).rejects.toBeInstanceOf(SteamTimeoutError);
    await vi.advanceTimersByTimeAsync(10_000);

    await assertion;
    expect(fetchLike.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    vi.useRealTimers();
  });

  test.each([
    [
      "an unsuccessful HTTP response",
      () => Promise.resolve(new Response("no", { status: 503 })),
      SteamUnavailableError,
    ],
    [
      "invalid JSON",
      () => Promise.resolve(new Response("not-json", { status: 200 })),
      SteamResponseError,
    ],
    [
      "an invalid upstream DTO",
      () =>
        Promise.resolve(
          new Response(JSON.stringify({ response: { games: [{ appid: "bad" }] } }), {
            status: 200,
          }),
        ),
      SteamResponseError,
    ],
    [
      "a network failure",
      () => Promise.reject(new Error("raw upstream secret")),
      SteamUnavailableError,
    ],
  ])("returns a safe typed error for %s", async (_description, respond, ExpectedError) => {
    const client = createSteamApiClient({ config, fetch: vi.fn(respond) as typeof fetch });

    await expect(client.getOwnedGames(config.steamId)).rejects.toBeInstanceOf(ExpectedError);
  });

  test("validates recent-game DTOs before returning them", async () => {
    const client = createSteamApiClient({
      config,
      fetch: vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              response: {
                total_count: 1,
                games: [{ appid: 440, name: "TF2", playtime_forever: 1 }],
              },
            }),
            { status: 200 },
          ),
      ) as typeof fetch,
    });

    await expect(client.getRecentGames(config.steamId, 3)).resolves.toMatchObject({
      response: { total_count: 1, games: [{ appid: 440, name: "TF2", playtime_forever: 1 }] },
    });
  });
});

test("loads the complete Steam Families catalog using the local session token without sending the API key", async () => {
  const familyConfig = loadConfig({
    STEAM_API_KEY: "secret-key",
    STEAM_ID: "76561198000000000",
    STEAM_WEBAPI_TOKEN: "temporary-family-token",
  });
  const fetchLike = vi
    .fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ response: { family_groupid: "family-group" } }), {
        status: 200,
      }),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          response: {
            apps: [
              {
                appid: 1196590,
                name: "Resident Evil Village",
                owner_steamids: ["76561198000000001"],
                exclude_reason: 0,
                rt_playtime: 285,
              },
            ],
          },
        }),
        { status: 200 },
      ),
    );
  const client = createSteamApiClient({ config: familyConfig, fetch: fetchLike as typeof fetch });

  await expect(client.getFamilyGames?.(familyConfig.steamId)).resolves.toEqual([
    expect.objectContaining({ appid: 1196590, name: "Resident Evil Village" }),
  ]);

  const firstUrl = new URL(String(fetchLike.mock.calls[0]?.[0]));
  const secondUrl = new URL(String(fetchLike.mock.calls[1]?.[0]));
  expect(firstUrl.pathname).toContain("GetFamilyGroupForUser");
  expect(secondUrl.pathname).toContain("GetSharedLibraryApps");
  expect(secondUrl.searchParams.get("family_groupid")).toBe("family-group");
  expect(secondUrl.searchParams.get("access_token")).toBe("temporary-family-token");
  expect(secondUrl.searchParams.has("key")).toBe(false);
});
