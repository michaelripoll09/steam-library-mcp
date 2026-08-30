import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";

import { createArtworkResolver } from "../../src/dashboard/artwork-resolver.js";

const jpeg = (bytes: readonly number[] = []) => [0xff, 0xd8, 0xff, ...bytes];
const image = (bytes = [1, 2, 3]) =>
  new Response(new Uint8Array(jpeg(bytes)), { headers: { "content-type": "image/jpeg" } });
const appDetails = (appId: number, success = false, headerImage?: string) =>
  new Response(
    JSON.stringify({
      [appId]: {
        success,
        ...(headerImage === undefined ? {} : { data: { header_image: headerImage } }),
      },
    }),
  );

async function withDirectory(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "steam-artwork-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe("artwork resolver", () => {
  test("caches a direct official portrait cover before requesting landscape metadata", async () => {
    await withDirectory(async (directory) => {
      const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
        expect(String(input)).toBe(
          "https://cdn.cloudflare.steamstatic.com/steam/apps/3527290/library_600x900.jpg",
        );
        return image();
      });
      const resolver = createArtworkResolver({ cacheDirectory: directory, fetch });

      await expect(resolver.resolve(3527290)).resolves.toMatchObject({
        contentType: "image/jpeg",
        orientation: "portrait",
      });
      expect(fetch).toHaveBeenCalledTimes(1);
      await expect(readFile(join(directory, "3527290.img"))).resolves.toEqual(
        Buffer.from(jpeg([1, 2, 3])),
      );
      await expect(readFile(join(directory, "3527290.json"), "utf8")).resolves.toContain(
        '"orientation":"portrait"',
      );
    });
  });

  test("uses a direct official landscape cover only after portrait sources are unavailable", async () => {
    await withDirectory(async (directory) => {
      const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
        const url = String(input);
        if (url.endsWith("/library_600x900.jpg")) return new Response(null, { status: 404 });
        if (url.includes("store.steampowered.com/api/appdetails")) return appDetails(858460);
        if (url.endsWith("/header.jpg")) return image([8, 5, 8]);
        return new Response(null, { status: 404 });
      });
      const resolver = createArtworkResolver({ cacheDirectory: directory, fetch });

      await expect(resolver.resolve(858460)).resolves.toMatchObject({ orientation: "landscape" });
      expect(fetch.mock.calls.map(([input]) => String(input))).toEqual([
        "https://cdn.cloudflare.steamstatic.com/steam/apps/858460/library_600x900.jpg",
        "https://store.steampowered.com/api/appdetails?appids=858460&l=english",
        "https://cdn.cloudflare.steamstatic.com/steam/apps/858460/header.jpg",
      ]);
    });
  });

  test("checks IGDB before Steam landscape fallbacks after the other portrait sources fail", async () => {
    await withDirectory(async (directory) => {
      const clientSecret = "fake-client-secret";
      const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
        const url = String(input);
        if (url.endsWith("/library_600x900.jpg")) return new Response(null, { status: 404 });
        if (url.includes("steamgriddb.com/api/v2/grids/steam/858460")) {
          return new Response(JSON.stringify({ success: true, data: [] }));
        }
        if (url === "https://id.twitch.tv/oauth2/token") {
          return new Response(
            JSON.stringify({
              access_token: "temporary-artwork-token",
              token_type: "bearer",
              expires_in: 3600,
            }),
          );
        }
        if (url === "https://api.igdb.com/v4/games") return new Response(JSON.stringify([]));
        if (url.includes("store.steampowered.com/api/appdetails")) return appDetails(858460);
        if (url.endsWith("/header.jpg")) return image([8, 5, 8]);
        return new Response(null, { status: 404 });
      });
      const resolver = createArtworkResolver({
        cacheDirectory: directory,
        steamGridDbApiKey: "grid-key",
        igdbCredentials: { clientId: "fake-client-id", clientSecret },
        fetch,
      });

      await expect(resolver.resolve(858460, "Celeste")).resolves.toMatchObject({
        orientation: "landscape",
      });

      const calls = fetch.mock.calls.map(([input]) => String(input));
      expect(calls.indexOf("https://api.igdb.com/v4/games")).toBeLessThan(
        calls.findIndex((url) => url.includes("store.steampowered.com/api/appdetails")),
      );
      expect(calls.indexOf("https://api.igdb.com/v4/games")).toBeLessThan(
        calls.findIndex((url) => url.endsWith("/header.jpg")),
      );
      expect(JSON.stringify(calls)).not.toContain(clientSecret);
    });
  });

  test("prefers a SteamGridDB portrait grid over an official Steam header when no official vertical cover exists", async () => {
    await withDirectory(async (directory) => {
      const appId = 858460;
      const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
        const url = String(input);
        if (url.endsWith("/library_600x900.jpg")) return new Response(null, { status: 404 });
        if (url.includes(`steamgriddb.com/api/v2/grids/steam/${appId}`)) {
          return new Response(
            JSON.stringify({
              success: true,
              data: [{ url: "https://cdn2.steamgriddb.com/file/sgdb-cdn/grid/grid.jpg" }],
            }),
          );
        }
        if (url.includes("cdn2.steamgriddb.com")) return image([4, 8, 0]);
        if (url.includes("store.steampowered.com/api/appdetails")) {
          return appDetails(
            appId,
            true,
            `https://shared.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`,
          );
        }
        return image();
      });
      const resolver = createArtworkResolver({
        cacheDirectory: directory,
        steamGridDbApiKey: "grid-key",
        fetch,
      });

      await expect(resolver.resolve(appId)).resolves.toMatchObject({ orientation: "portrait" });
      const calls = fetch.mock.calls.map(([input]) => String(input));
      expect(calls).toContain(
        `https://www.steamgriddb.com/api/v2/grids/steam/${appId}?dimensions=600x900`,
      );
      expect(calls).not.toContain(
        `https://shared.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`,
      );
      expect(fetch.mock.calls[1]?.[1]).toMatchObject({
        headers: { Authorization: "Bearer grid-key" },
      });
      expect(fetch.mock.calls[2]?.[1]).not.toHaveProperty("headers");
    });
  });
  test("accepts SteamGridDB's current direct portrait CDN path without relaxing its allowlist", async () => {
    await withDirectory(async (directory) => {
      const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
        const url = String(input);
        if (url.endsWith("/library_600x900.jpg")) return new Response(null, { status: 404 });
        if (url.includes("steamgriddb.com/api/v2/grids/steam/2149010")) {
          return new Response(
            JSON.stringify({
              success: true,
              data: [{ url: "https://cdn2.steamgriddb.com/grid/portraitHash" }],
            }),
          );
        }
        if (url === "https://cdn2.steamgriddb.com/grid/portraitHash") return image([2, 1, 4]);
        return new Response(null, { status: 404 });
      });
      const resolver = createArtworkResolver({
        cacheDirectory: directory,
        steamGridDbApiKey: "grid-key",
        fetch,
      });

      await expect(resolver.resolve(2149010)).resolves.toMatchObject({ orientation: "portrait" });
      expect(fetch.mock.calls.map(([input]) => String(input))).toContain(
        "https://cdn2.steamgriddb.com/grid/portraitHash",
      );
    });
  });

  test("skips unsafe SteamGridDB entries until it finds a safe portrait grid", async () => {
    await withDirectory(async (directory) => {
      const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
        const url = String(input);
        if (url.endsWith("/library_600x900.jpg")) return new Response(null, { status: 404 });
        if (url.includes("steamgriddb.com/api/v2/grids/steam/3")) {
          return new Response(
            JSON.stringify({
              success: true,
              data: [
                { url: "https://example.com/unsafe.jpg" },
                { url: "https://cdn2.steamgriddb.com/file/sgdb-cdn/grid/safe.jpg" },
              ],
            }),
          );
        }
        if (url.endsWith("/safe.jpg")) return image([3, 3, 3]);
        return new Response(null, { status: 404 });
      });
      const resolver = createArtworkResolver({
        cacheDirectory: directory,
        steamGridDbApiKey: "grid-key",
        fetch,
      });

      await expect(resolver.resolve(3)).resolves.toMatchObject({ orientation: "portrait" });
      expect(fetch.mock.calls.map(([input]) => String(input))).not.toContain(
        "https://example.com/unsafe.jpg",
      );
      expect(fetch.mock.calls.map(([input]) => String(input))).toContain(
        "https://cdn2.steamgriddb.com/file/sgdb-cdn/grid/safe.jpg",
      );
    });
  });

  test("uses SteamGridDB only when configured and never forwards its credential to image downloads", async () => {
    await withDirectory(async (directory) => {
      const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
        const url = String(input);
        if (url.endsWith("/library_600x900.jpg")) return new Response(null, { status: 404 });
        if (url.includes("steamgriddb.com/api/v2/grids/steam/1")) {
          return new Response(
            JSON.stringify({
              success: true,
              data: [{ url: "https://s3.amazonaws.com/steamgriddb/grids/1.jpg" }],
            }),
          );
        }
        if (url.includes("s3.amazonaws.com/steamgriddb")) return image([4]);
        return new Response(null, { status: 404 });
      });
      const resolver = createArtworkResolver({
        cacheDirectory: directory,
        steamGridDbApiKey: "grid-key",
        fetch,
      });

      await expect(resolver.resolve(1)).resolves.toMatchObject({ orientation: "portrait" });
      expect(fetch.mock.calls[1]?.[1]).toMatchObject({
        headers: { Authorization: "Bearer grid-key" },
      });
      expect(fetch.mock.calls[2]?.[1]).not.toHaveProperty("headers");
    });
  });

  test("rejects an untrusted SteamGridDB result before falling back to an official landscape cover", async () => {
    await withDirectory(async (directory) => {
      const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
        const url = String(input);
        if (url.endsWith("/library_600x900.jpg")) return new Response(null, { status: 404 });
        if (url.includes("steamgriddb.com/api/v2/grids/steam/2")) {
          return new Response(
            JSON.stringify({ success: true, data: [{ url: "https://example.com/unsafe.jpg" }] }),
          );
        }
        if (url.includes("store.steampowered.com/api/appdetails")) return appDetails(2);
        if (url.endsWith("/header.jpg")) return image();
        return new Response(null, { status: 404 });
      });
      const resolver = createArtworkResolver({
        cacheDirectory: directory,
        steamGridDbApiKey: "grid-key",
        fetch,
      });

      await expect(resolver.resolve(2)).resolves.toMatchObject({ orientation: "landscape" });
      expect(fetch.mock.calls.map(([input]) => String(input))).not.toContain(
        "https://example.com/unsafe.jpg",
      );
    });
  });

  test("replaces legacy cached artwork that lacks the portrait cache schema", async () => {
    await withDirectory(async (directory) => {
      await writeFile(join(directory, "480.img"), new Uint8Array([9]));
      await writeFile(join(directory, "480.json"), JSON.stringify({ contentType: "image/jpeg" }));
      const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
        if (String(input).endsWith("/library_600x900.jpg")) return image([4, 8, 0]);
        return new Response(null, { status: 404 });
      });
      const resolver = createArtworkResolver({ cacheDirectory: directory, fetch });

      await expect(resolver.resolve(480)).resolves.toMatchObject({ orientation: "portrait" });
      expect(fetch).toHaveBeenCalled();
      await expect(readFile(join(directory, "480.img"))).resolves.toEqual(
        Buffer.from(jpeg([4, 8, 0])),
      );
      await expect(readFile(join(directory, "480.json"), "utf8")).resolves.toContain('"version":4');
    });
  });

  test("re-resolves a version two cached landscape cover without deleting current portrait cache entries", async () => {
    await withDirectory(async (directory) => {
      await writeFile(join(directory, "4513840.img"), new Uint8Array([9]));
      await writeFile(
        join(directory, "4513840.json"),
        JSON.stringify({ version: 2, contentType: "image/jpeg", orientation: "landscape" }),
      );
      const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
        if (String(input).endsWith("/library_600x900.jpg")) return image([4, 5, 1]);
        return new Response(null, { status: 404 });
      });
      const resolver = createArtworkResolver({ cacheDirectory: directory, fetch });

      await expect(resolver.resolve(4513840)).resolves.toMatchObject({ orientation: "portrait" });
      await expect(readFile(join(directory, "4513840.img"))).resolves.toEqual(
        Buffer.from(jpeg([4, 5, 1])),
      );
      await expect(readFile(join(directory, "4513840.json"), "utf8")).resolves.toContain(
        '"version":4',
      );
    });
  });

  test.each([
    ["v2 portrait", { version: 2, contentType: "image/jpeg", orientation: "portrait" }],
    [
      "v3 Steam portrait",
      { version: 3, contentType: "image/jpeg", orientation: "portrait", source: "steam" },
    ],
    [
      "v3 SteamGridDB portrait",
      { version: 3, contentType: "image/jpeg", orientation: "portrait", source: "steamgriddb" },
    ],
    [
      "v4 app-bound IGDB portrait",
      {
        version: 4,
        contentType: "image/jpeg",
        orientation: "portrait",
        source: "igdb",
        identity: "steam-app",
      },
    ],
  ] as const)(
    "uses a valid %s cache record without a provider request",
    async (_name, metadata) => {
      await withDirectory(async (directory) => {
        await Promise.all([
          writeFile(join(directory, "4513840.img"), new Uint8Array([9])),
          writeFile(join(directory, "4513840.json"), JSON.stringify(metadata)),
        ]);
        const fetch = vi.fn<typeof globalThis.fetch>();
        const resolver = createArtworkResolver({ cacheDirectory: directory, fetch });

        await expect(resolver.resolve(4513840)).resolves.toMatchObject({ orientation: "portrait" });
        expect(fetch).not.toHaveBeenCalled();
      });
    },
  );

  test("re-resolves a v3 Steam landscape cache record instead of bypassing portrait sources", async () => {
    await withDirectory(async (directory) => {
      await Promise.all([
        writeFile(join(directory, "4513840.img"), new Uint8Array([9])),
        writeFile(
          join(directory, "4513840.json"),
          JSON.stringify({
            version: 3,
            contentType: "image/jpeg",
            orientation: "landscape",
            source: "steam",
          }),
        ),
      ]);
      const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
        if (String(input).endsWith("/library_600x900.jpg")) return image([4, 5, 1]);
        return new Response(null, { status: 404 });
      });
      const resolver = createArtworkResolver({ cacheDirectory: directory, fetch });

      await expect(resolver.resolve(4513840)).resolves.toMatchObject({ orientation: "portrait" });
      expect(fetch.mock.calls.map(([input]) => String(input))).toContain(
        "https://cdn.cloudflare.steamstatic.com/steam/apps/4513840/library_600x900.jpg",
      );
      await expect(readFile(join(directory, "4513840.img"))).resolves.toEqual(
        Buffer.from(jpeg([4, 5, 1])),
      );
      await expect(readFile(join(directory, "4513840.json"), "utf8")).resolves.toContain(
        '"orientation":"portrait"',
      );
    });
  });

  test("rechecks a freshly cached Steam landscape before allowing it to remain the fallback", async () => {
    await withDirectory(async (directory) => {
      const firstFetch = vi.fn<typeof globalThis.fetch>(async (input) => {
        const url = String(input);
        if (url.endsWith("/library_600x900.jpg")) return new Response(null, { status: 404 });
        if (url.includes("store.steampowered.com/api/appdetails")) return appDetails(4513840);
        if (url.endsWith("/header.jpg")) return image([9, 9, 9]);
        return new Response(null, { status: 404 });
      });

      await expect(
        createArtworkResolver({ cacheDirectory: directory, fetch: firstFetch }).resolve(4513840),
      ).resolves.toMatchObject({ orientation: "landscape" });
      await expect(readFile(join(directory, "4513840.json"), "utf8")).resolves.toContain(
        '"orientation":"landscape","source":"steam"',
      );

      const secondFetch = vi.fn<typeof globalThis.fetch>(async (input) => {
        if (String(input).endsWith("/library_600x900.jpg")) return image([4, 5, 1]);
        return new Response(null, { status: 404 });
      });
      const resolver = createArtworkResolver({ cacheDirectory: directory, fetch: secondFetch });

      await expect(resolver.resolve(4513840)).resolves.toMatchObject({ orientation: "portrait" });
      expect(secondFetch.mock.calls.map(([input]) => String(input))).toContain(
        "https://cdn.cloudflare.steamstatic.com/steam/apps/4513840/library_600x900.jpg",
      );
    });
  });

  test.each([
    [4513840, "App-bound game"],
    [4513841, "Another app-bound game"],
  ])(
    "uses Steam app-bound IGDB cover for %i before generic title variants",
    async (appId, title) => {
      await withDirectory(async (directory) => {
        const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
          const url = String(input);
          if (url.endsWith("/library_600x900.jpg")) return new Response(null, { status: 404 });
          if (url === "https://id.twitch.tv/oauth2/token") {
            return new Response(
              JSON.stringify({
                access_token: "temporary-artwork-token",
                token_type: "bearer",
                expires_in: 3600,
              }),
            );
          }
          if (url === "https://api.igdb.com/v4/games") {
            const body = String(init?.body);
            expect(body).toContain(
              `where external_games.category = 1 & external_games.uid = "${appId}"; limit 10;`,
            );
            expect(body).toContain("external_games.category");
            expect(body).toContain("external_games.uid");
            expect(body).not.toContain("search ");
            expect(init).toMatchObject({ method: "POST", redirect: "error" });
            return new Response(
              JSON.stringify([
                {
                  name: `${title} (Steam edition)`,
                  external_games: [{ category: 1, uid: String(appId) }],
                  cover: {
                    url: "//images.igdb.com/igdb/image/upload/t_cover_big_2x/steam-bound.jpg",
                  },
                },
                {
                  name: "Generic franchise variant",
                  external_games: [{ category: 1, uid: "99999" }],
                  cover: {
                    url: "//images.igdb.com/igdb/image/upload/t_cover_big_2x/wrong.jpg",
                  },
                },
                {
                  name: "Wrong provider category",
                  external_games: [{ category: 2, uid: String(appId) }],
                  cover: {
                    url: "//images.igdb.com/igdb/image/upload/t_cover_big_2x/wrong-category.jpg",
                  },
                },
              ]),
            );
          }
          if (url.endsWith("/steam-bound.jpg")) return image([1, 5, 1]);
          return new Response(null, { status: 404 });
        });
        const resolver = createArtworkResolver({
          cacheDirectory: directory,
          igdbCredentials: { clientId: "fake-client-id", clientSecret: "fake-client-secret" },
          fetch,
        });

        await expect(resolver.resolve(appId, title)).resolves.toMatchObject({
          orientation: "portrait",
        });
        const gameRequests = fetch.mock.calls.filter(
          ([input]) => String(input) === "https://api.igdb.com/v4/games",
        );
        expect(gameRequests).toHaveLength(1);
        expect(fetch.mock.calls.map(([input]) => String(input))).not.toContain(
          "https://images.igdb.com/igdb/image/upload/t_cover_big_2x/wrong.jpg",
        );
        expect(fetch.mock.calls.map(([input]) => String(input))).not.toContain(
          "https://images.igdb.com/igdb/image/upload/t_cover_big_2x/wrong-category.jpg",
        );
        await expect(readFile(join(directory, `${appId}.json`), "utf8")).resolves.toContain(
          '"identity":"steam-app"',
        );
      });
    },
  );

  test("preserves an exact unique IGDB title fallback when no Steam app-bound result exists", async () => {
    await withDirectory(async (directory) => {
      const appId = 999;
      const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
        const url = String(input);
        if (url.endsWith("/library_600x900.jpg")) return new Response(null, { status: 404 });
        if (url === "https://id.twitch.tv/oauth2/token") {
          return new Response(
            JSON.stringify({
              access_token: "temporary-artwork-token",
              token_type: "bearer",
              expires_in: 3600,
            }),
          );
        }
        if (url === "https://api.igdb.com/v4/games") {
          const body = String(init?.body);
          expect(init).toMatchObject({ method: "POST", redirect: "error" });
          if (
            body.includes(
              `where external_games.category = 1 & external_games.uid = "${appId}"; limit 10;`,
            )
          ) {
            return new Response(JSON.stringify([]));
          }
          expect(body).toContain('search "Celeste"');
          return new Response(
            JSON.stringify([
              {
                name: "Celeste",
                cover: {
                  url: "//images.igdb.com/igdb/image/upload/t_cover_big_2x/celeste.jpg",
                },
              },
            ]),
          );
        }
        if (url.endsWith("/celeste.jpg")) return image([9, 9, 9]);
        return new Response(null, { status: 404 });
      });
      const resolver = createArtworkResolver({
        cacheDirectory: directory,
        igdbCredentials: { clientId: "fake-client-id", clientSecret: "fake-client-secret" },
        fetch,
      });

      await expect(resolver.resolve(appId, "Celeste")).resolves.toMatchObject({
        orientation: "portrait",
      });
      const gameRequests = fetch.mock.calls.filter(
        ([input]) => String(input) === "https://api.igdb.com/v4/games",
      );
      expect(gameRequests).toHaveLength(2);
      expect(String(gameRequests[0]?.[1]?.body)).toContain(
        `where external_games.category = 1 & external_games.uid = "${appId}"; limit 10;`,
      );
      expect(String(gameRequests[1]?.[1]?.body)).toContain('search "Celeste"');
      await expect(readFile(join(directory, `${appId}.json`), "utf8")).resolves.toContain(
        '"identity":"title"',
      );
    });
  });

  test("rejects ambiguous IGDB sequel title fallbacks before Steam landscape recovery", async () => {
    await withDirectory(async (directory) => {
      const appId = 19980;
      const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
        const url = String(input);
        if (url.endsWith("/library_600x900.jpg")) return new Response(null, { status: 404 });
        if (url === "https://id.twitch.tv/oauth2/token") {
          return new Response(
            JSON.stringify({
              access_token: "temporary-artwork-token",
              token_type: "bearer",
              expires_in: 3600,
            }),
          );
        }
        if (url === "https://api.igdb.com/v4/games") {
          const body = String(init?.body);
          if (
            body.includes(
              `where external_games.category = 1 & external_games.uid = "${appId}"; limit 10;`,
            )
          ) {
            return new Response(JSON.stringify([]));
          }
          expect(body).toContain('search "Prince of Persia"');
          return new Response(
            JSON.stringify([
              {
                name: "Prince of Persia: The Forgotten Sands",
                cover: {
                  url: "//images.igdb.com/igdb/image/upload/t_cover_big_2x/sequel.jpg",
                },
              },
            ]),
          );
        }
        if (url.includes("store.steampowered.com/api/appdetails")) return appDetails(appId);
        if (url.endsWith("/header.jpg") || url.endsWith("/capsule_616x353.jpg")) {
          return new Response(null, { status: 404 });
        }
        if (url.endsWith("/sequel.jpg")) return image([1, 9, 9]);
        return new Response(null, { status: 404 });
      });
      const resolver = createArtworkResolver({
        cacheDirectory: directory,
        igdbCredentials: { clientId: "fake-client-id", clientSecret: "fake-client-secret" },
        fetch,
      });

      await expect(resolver.resolve(appId, "Prince of Persia")).resolves.toBeUndefined();
      expect(fetch.mock.calls.map(([input]) => String(input))).not.toContain(
        "https://images.igdb.com/igdb/image/upload/t_cover_big_2x/sequel.jpg",
      );
    });
  });

  test("rejects multiple normalized-exact IGDB title covers before Steam landscape recovery", async () => {
    await withDirectory(async (directory) => {
      const appId = 19980;
      const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
        const url = String(input);
        if (url.endsWith("/library_600x900.jpg")) return new Response(null, { status: 404 });
        if (url === "https://id.twitch.tv/oauth2/token") {
          return new Response(
            JSON.stringify({
              access_token: "temporary-artwork-token",
              token_type: "bearer",
              expires_in: 3600,
            }),
          );
        }
        if (url === "https://api.igdb.com/v4/games") {
          const body = String(init?.body);
          if (
            body.includes(
              `where external_games.category = 1 & external_games.uid = "${appId}"; limit 10;`,
            )
          ) {
            return new Response(JSON.stringify([]));
          }
          expect(body).toContain('search "Prince of Persia"');
          return new Response(
            JSON.stringify([
              {
                name: "Prince of Persia",
                cover: {
                  url: "//images.igdb.com/igdb/image/upload/t_cover_big_2x/remake-one.jpg",
                },
              },
              {
                name: "Prince-of-Persia",
                cover: {
                  url: "//images.igdb.com/igdb/image/upload/t_cover_big_2x/remake-two.jpg",
                },
              },
            ]),
          );
        }
        if (url.includes("store.steampowered.com/api/appdetails")) return appDetails(appId);
        if (url.endsWith("/header.jpg") || url.endsWith("/capsule_616x353.jpg")) {
          return new Response(null, { status: 404 });
        }
        if (url.endsWith("/remake-one.jpg") || url.endsWith("/remake-two.jpg")) {
          return image([1, 9, 9]);
        }
        return new Response(null, { status: 404 });
      });
      const resolver = createArtworkResolver({
        cacheDirectory: directory,
        igdbCredentials: { clientId: "fake-client-id", clientSecret: "fake-client-secret" },
        fetch,
      });

      await expect(resolver.resolve(appId, "Prince of Persia")).resolves.toBeUndefined();
      const calls = fetch.mock.calls.map(([input]) => String(input));
      expect(calls).not.toContain(
        "https://images.igdb.com/igdb/image/upload/t_cover_big_2x/remake-one.jpg",
      );
      expect(calls).not.toContain(
        "https://images.igdb.com/igdb/image/upload/t_cover_big_2x/remake-two.jpg",
      );
    });
  });

  test("re-resolves legacy generic IGDB cache records through the Steam app identity", async () => {
    await withDirectory(async (directory) => {
      const appId = 15100;
      await Promise.all([
        writeFile(join(directory, `${appId}.img`), new Uint8Array([0])),
        writeFile(
          join(directory, `${appId}.json`),
          JSON.stringify({
            version: 3,
            contentType: "image/jpeg",
            orientation: "portrait",
            source: "igdb",
          }),
        ),
      ]);
      const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
        const url = String(input);
        if (url.endsWith("/library_600x900.jpg")) return new Response(null, { status: 404 });
        if (url === "https://id.twitch.tv/oauth2/token") {
          return new Response(
            JSON.stringify({
              access_token: "temporary-artwork-token",
              token_type: "bearer",
              expires_in: 3600,
            }),
          );
        }
        if (url === "https://api.igdb.com/v4/games") {
          expect(String(init?.body)).toContain(
            `where external_games.category = 1 & external_games.uid = "${appId}"; limit 10;`,
          );
          return new Response(
            JSON.stringify([
              {
                name: "Assassin's Creed: Director's Cut",
                external_games: [{ category: 1, uid: String(appId) }],
                cover: {
                  url: "//images.igdb.com/igdb/image/upload/t_cover_big_2x/repaired.jpg",
                },
              },
            ]),
          );
        }
        if (url.endsWith("/repaired.jpg")) return image([1, 5, 1]);
        return new Response(null, { status: 404 });
      });
      const resolver = createArtworkResolver({
        cacheDirectory: directory,
        igdbCredentials: { clientId: "fake-client-id", clientSecret: "fake-client-secret" },
        fetch,
      });

      await expect(
        resolver.resolve(appId, "Assassin's Creed: Director's Cut"),
      ).resolves.toMatchObject({
        orientation: "portrait",
      });
      await expect(readFile(join(directory, `${appId}.img`))).resolves.toEqual(
        Buffer.from(jpeg([1, 5, 1])),
      );
      await expect(readFile(join(directory, `${appId}.json`), "utf8")).resolves.toContain(
        '"identity":"steam-app"',
      );
    });
  });

  test("uses a Spanish-normalized IGDB high-quality cover only after Steam and SteamGridDB fail", async () => {
    await withDirectory(async (directory) => {
      const fakeClientSecret = "fake-client-secret";
      const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
        const url = String(input);
        if (url.endsWith("/library_600x900.jpg")) return new Response(null, { status: 404 });
        if (url.includes("steamgriddb.com/api/v2/grids/steam/4513840")) {
          return new Response(JSON.stringify({ success: true, data: [] }));
        }
        if (url.includes("store.steampowered.com/api/appdetails")) return appDetails(4513840);
        if (url.endsWith("/header.jpg") || url.endsWith("/capsule_616x353.jpg")) {
          return new Response(null, { status: 404 });
        }
        if (url === "https://id.twitch.tv/oauth2/token") {
          expect(String(init?.body)).toContain(fakeClientSecret);
          return new Response(
            JSON.stringify({
              access_token: "temporary-artwork-token",
              token_type: "bearer",
              expires_in: 3600,
            }),
          );
        }
        if (url === "https://api.igdb.com/v4/games") {
          const body = String(init?.body);
          if (
            body.includes(
              'where external_games.category = 1 & external_games.uid = "4513840"; limit 10;',
            )
          ) {
            return new Response(JSON.stringify([]));
          }
          expect(body).toContain('search "El Niño"');
          return new Response(
            JSON.stringify([
              {
                name: "Other Game",
                cover: { url: "//images.igdb.com/igdb/image/upload/t_cover_big_2x/other.jpg" },
              },
              {
                name: "El Nino",
                cover: { url: "//images.igdb.com/igdb/image/upload/t_cover_big_2x/nino.jpg" },
              },
            ]),
          );
        }
        if (url === "https://images.igdb.com/igdb/image/upload/t_cover_big_2x/nino.jpg") {
          return image([4, 5, 1]);
        }
        return new Response(null, { status: 404 });
      });
      const resolver = createArtworkResolver({
        cacheDirectory: directory,
        steamGridDbApiKey: "grid-key",
        igdbCredentials: { clientId: "fake-client-id", clientSecret: fakeClientSecret },
        fetch,
      });

      await expect(resolver.resolve(4513840, "El Niño")).resolves.toMatchObject({
        orientation: "portrait",
      });
      const calls = fetch.mock.calls.map(([input]) => String(input));
      expect(calls).toContain("https://images.igdb.com/igdb/image/upload/t_cover_big_2x/nino.jpg");
      expect(JSON.stringify(calls)).not.toContain(fakeClientSecret);
      await expect(readFile(join(directory, "4513840.json"), "utf8")).resolves.toContain(
        '"source":"igdb"',
      );
    });
  });

  test.each([
    ["disabled", undefined],
    ["no result", { clientId: "fake-client-id", clientSecret: "fake-client-secret" }],
    ["provider error", { clientId: "fake-client-id", clientSecret: "fake-client-secret" }],
  ] as const)(
    "does not cache an IGDB cover when the provider is %s",
    async (_caseName, credentials) => {
      await withDirectory(async (directory) => {
        const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
          const url = String(input);
          if (url.endsWith("/library_600x900.jpg")) return new Response(null, { status: 404 });
          if (url.includes("store.steampowered.com/api/appdetails")) return appDetails(4513840);
          if (url.endsWith("/header.jpg") || url.endsWith("/capsule_616x353.jpg"))
            return new Response(null, { status: 404 });
          if (url === "https://id.twitch.tv/oauth2/token") {
            return new Response(
              JSON.stringify({
                access_token: "temporary-artwork-token",
                token_type: "bearer",
                expires_in: 3600,
              }),
            );
          }
          if (url === "https://api.igdb.com/v4/games") {
            return _caseName === "provider error"
              ? new Response("unavailable", { status: 503 })
              : new Response(JSON.stringify([]));
          }
          return new Response(null, { status: 404 });
        });
        const resolver = createArtworkResolver({
          cacheDirectory: directory,
          igdbCredentials: credentials,
          fetch,
        });

        await expect(resolver.resolve(4513840, "Embers")).resolves.toBeUndefined();
        await expect(readFile(join(directory, "4513840.img"))).rejects.toThrow();
        expect(fetch.mock.calls.map(([input]) => String(input))).not.toContain(
          "https://images.igdb.com/igdb/image/upload/t_cover_big_2x/unsafe.jpg",
        );
      });
    },
  );

  test("rejects unsafe IGDB image hosts before they can be fetched", async () => {
    await withDirectory(async (directory) => {
      const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
        const url = String(input);
        if (url.endsWith("/library_600x900.jpg")) return new Response(null, { status: 404 });
        if (url.includes("store.steampowered.com/api/appdetails")) return appDetails(4513840);
        if (url.endsWith("/header.jpg") || url.endsWith("/capsule_616x353.jpg"))
          return new Response(null, { status: 404 });
        if (url === "https://id.twitch.tv/oauth2/token") {
          return new Response(
            JSON.stringify({
              access_token: "temporary-artwork-token",
              token_type: "bearer",
              expires_in: 3600,
            }),
          );
        }
        if (url === "https://api.igdb.com/v4/games") {
          return new Response(
            JSON.stringify([
              { name: "Embers", cover: { url: "https://127.0.0.1/private.jpg" } },
              {
                name: "Embers",
                cover: { url: "//images.igdb.com/igdb/image/upload/t_thumb/unsafe.jpg" },
              },
            ]),
          );
        }
        return new Response(null, { status: 404 });
      });
      const resolver = createArtworkResolver({
        cacheDirectory: directory,
        igdbCredentials: { clientId: "fake-client-id", clientSecret: "fake-client-secret" },
        fetch,
      });

      await expect(resolver.resolve(4513840, "Embers")).resolves.toBeUndefined();
      expect(fetch.mock.calls.map(([input]) => String(input))).not.toContain(
        "https://127.0.0.1/private.jpg",
      );
      expect(fetch.mock.calls.map(([input]) => String(input))).not.toContain(
        "https://images.igdb.com/igdb/image/upload/t_thumb/unsafe.jpg",
      );
    });
  });

  test("caches Spacewar's pinned vetted IGDB portrait without OAuth or API lookup", async () => {
    await withDirectory(async (directory) => {
      const pinnedCover = "https://images.igdb.com/igdb/image/upload/t_cover_big_2x/co3lld.jpg";
      const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
        const url = String(input);
        if (url === pinnedCover) return image([4, 8, 0]);
        return new Response(null, { status: 404 });
      });
      const resolver = createArtworkResolver({ cacheDirectory: directory, fetch });

      await expect(resolver.resolve(480, "Spacewar")).resolves.toMatchObject({
        contentType: "image/jpeg",
        orientation: "portrait",
      });
      expect(fetch.mock.calls.map(([input]) => String(input))).toEqual([pinnedCover]);
      await expect(readFile(join(directory, "480.img"))).resolves.toEqual(
        Buffer.from(jpeg([4, 8, 0])),
      );
      await expect(readFile(join(directory, "480.json"), "utf8")).resolves.toEqual(
        JSON.stringify({
          version: 4,
          contentType: "image/jpeg",
          orientation: "portrait",
          source: "igdb-curated-override",
          identity: "app-id-override",
          providerGameId: 11301,
        }),
      );
    });
  });
  test.each([
    {
      appId: 15100,
      title: "Assassin's Creed",
      gameId: 27827,
      gameName: "Assassin's Creed: Director's Cut Edition",
      imageName: "curated-assassins-creed.jpg",
    },
    {
      appId: 19980,
      title: "Prince of Persia",
      gameId: 2438,
      gameName: "Prince of Persia",
      imageName: "curated-prince-of-persia.jpg",
    },
    {
      appId: 3527290,
      title: "PEAK",
      gameId: 349524,
      gameName: "Peak",
      imageName: "curated-peak.jpg",
    },
    {
      appId: 13500,
      title: "Prince of Persia: Warrior Within",
      gameId: 837,
      gameName: "Prince of Persia: Warrior Within",
      imageName: "curated-warrior-within.jpg",
    },
    {
      appId: 13530,
      title: "Prince of Persia: The Two Thrones",
      gameId: 2437,
      gameName: "Prince of Persia: The Two Thrones",
      imageName: "curated-two-thrones.jpg",
    },
    {
      appId: 13600,
      title: "Prince of Persia: The Sands of Time",
      gameId: 836,
      gameName: "Prince of Persia: The Sands of Time",
      imageName: "curated-sands-of-time.jpg",
    },
  ])("uses the verified curated IGDB cover for Steam $appId", async (override) => {
    await withDirectory(async (directory) => {
      const igdbQueries: string[] = [];
      const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
        const url = String(input);
        if (url.endsWith("/library_600x900.jpg")) return new Response(null, { status: 404 });
        if (url === "https://id.twitch.tv/oauth2/token") {
          return new Response(
            JSON.stringify({
              access_token: "temporary-artwork-token",
              token_type: "bearer",
              expires_in: 3600,
            }),
          );
        }
        if (url === "https://api.igdb.com/v4/games") {
          igdbQueries.push(String(init?.body));
          if (
            String(init?.body) !==
            `fields id,name,cover.url; where id = ${override.gameId}; limit 1;`
          ) {
            return new Response(JSON.stringify([]));
          }
          return new Response(
            JSON.stringify([
              {
                id: override.gameId,
                name: override.gameName,
                cover: {
                  url: `//images.igdb.com/igdb/image/upload/t_cover_big_2x/${override.imageName}`,
                },
              },
            ]),
          );
        }
        if (url.endsWith(`/${override.imageName}`)) return image([override.appId % 256]);
        return new Response(null, { status: 404 });
      });
      const resolver = createArtworkResolver({
        cacheDirectory: directory,
        igdbCredentials: { clientId: "fake-client-id", clientSecret: "fake-client-secret" },
        fetch,
      });

      const resolved = await resolver.resolve(override.appId, override.title);

      expect(igdbQueries).toEqual([
        `fields id,name,cover.url; where id = ${override.gameId}; limit 1;`,
      ]);
      expect(resolved).toMatchObject({
        contentType: "image/jpeg",
        orientation: "portrait",
      });
      await expect(readFile(join(directory, `${override.appId}.json`), "utf8")).resolves.toEqual(
        JSON.stringify({
          version: 4,
          contentType: "image/jpeg",
          orientation: "portrait",
          source: "igdb-curated-override",
          identity: "app-id-override",
          providerGameId: override.gameId,
        }),
      );
    });
  });

  test("does not request curated overrides for other Steam app IDs", async () => {
    await withDirectory(async (directory) => {
      const appId = 4513840;
      const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
        const url = String(input);
        if (url.endsWith("/library_600x900.jpg")) return new Response(null, { status: 404 });
        if (url === "https://id.twitch.tv/oauth2/token") {
          return new Response(
            JSON.stringify({
              access_token: "temporary-artwork-token",
              token_type: "bearer",
              expires_in: 3600,
            }),
          );
        }
        if (url === "https://api.igdb.com/v4/games") {
          expect(String(init?.body)).not.toContain("where id = ");
          return new Response(JSON.stringify([]));
        }
        if (url.includes("store.steampowered.com/api/appdetails")) return appDetails(appId);
        return new Response(null, { status: 404 });
      });
      const resolver = createArtworkResolver({
        cacheDirectory: directory,
        igdbCredentials: { clientId: "fake-client-id", clientSecret: "fake-client-secret" },
        fetch,
      });

      await expect(resolver.resolve(appId, "Unrelated title")).resolves.toBeUndefined();
    });
  });

  test("rejects a curated override when its IGDB game identity does not match", async () => {
    await withDirectory(async (directory) => {
      const appId = 15100;
      const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
        const url = String(input);
        if (url.endsWith("/library_600x900.jpg")) return new Response(null, { status: 404 });
        if (url === "https://id.twitch.tv/oauth2/token") {
          return new Response(
            JSON.stringify({
              access_token: "temporary-artwork-token",
              token_type: "bearer",
              expires_in: 3600,
            }),
          );
        }
        if (url === "https://api.igdb.com/v4/games") {
          const body = String(init?.body);
          if (body.includes("where id = 27827; limit 1;")) {
            return new Response(
              JSON.stringify([
                {
                  id: 99999,
                  name: "Assassin's Creed: Director's Cut Edition",
                  cover: {
                    url: "//images.igdb.com/igdb/image/upload/t_cover_big_2x/wrong-identity.jpg",
                  },
                },
              ]),
            );
          }
          return new Response(JSON.stringify([]));
        }
        if (url.includes("store.steampowered.com/api/appdetails")) return appDetails(appId);
        return new Response(null, { status: 404 });
      });
      const resolver = createArtworkResolver({
        cacheDirectory: directory,
        igdbCredentials: { clientId: "fake-client-id", clientSecret: "fake-client-secret" },
        fetch,
      });

      await expect(resolver.resolve(appId, "Assassin's Creed")).resolves.toBeUndefined();
      expect(
        fetch.mock.calls.filter(
          ([input, init]) =>
            String(input) === "https://api.igdb.com/v4/games" &&
            String(init?.body).includes("where id = 27827; limit 1;"),
        ),
      ).toHaveLength(1);
      expect(fetch.mock.calls.map(([input]) => String(input))).not.toContain(
        "https://images.igdb.com/igdb/image/upload/t_cover_big_2x/wrong-identity.jpg",
      );
    });
  });

  test("rejects unsafe curated override image URLs before fetching them", async () => {
    await withDirectory(async (directory) => {
      const appId = 19980;
      const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
        const url = String(input);
        if (url.endsWith("/library_600x900.jpg")) return new Response(null, { status: 404 });
        if (url === "https://id.twitch.tv/oauth2/token") {
          return new Response(
            JSON.stringify({
              access_token: "temporary-artwork-token",
              token_type: "bearer",
              expires_in: 3600,
            }),
          );
        }
        if (url === "https://api.igdb.com/v4/games") {
          if (String(init?.body).includes("where id = 2438; limit 1;")) {
            return new Response(
              JSON.stringify([
                {
                  id: 2438,
                  name: "Prince of Persia",
                  cover: { url: "https://127.0.0.1/private.jpg" },
                },
              ]),
            );
          }
          return new Response(JSON.stringify([]));
        }
        if (url.includes("store.steampowered.com/api/appdetails")) return appDetails(appId);
        return new Response(null, { status: 404 });
      });
      const resolver = createArtworkResolver({
        cacheDirectory: directory,
        igdbCredentials: { clientId: "fake-client-id", clientSecret: "fake-client-secret" },
        fetch,
      });

      await expect(resolver.resolve(appId, "Prince of Persia®")).resolves.toBeUndefined();
      expect(fetch.mock.calls.map(([input]) => String(input))).not.toContain(
        "https://127.0.0.1/private.jpg",
      );
    });
  });

  test("re-resolves a cached Steam landscape as a provenance-marked curated override", async () => {
    await withDirectory(async (directory) => {
      const appId = 19980;
      await Promise.all([
        writeFile(join(directory, `${appId}.img`), new Uint8Array([0])),
        writeFile(
          join(directory, `${appId}.json`),
          JSON.stringify({
            version: 4,
            contentType: "image/jpeg",
            orientation: "landscape",
            source: "steam",
          }),
        ),
      ]);
      const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
        const url = String(input);
        if (url.endsWith("/library_600x900.jpg")) return new Response(null, { status: 404 });
        if (url === "https://id.twitch.tv/oauth2/token") {
          return new Response(
            JSON.stringify({
              access_token: "temporary-artwork-token",
              token_type: "bearer",
              expires_in: 3600,
            }),
          );
        }
        if (url === "https://api.igdb.com/v4/games") {
          expect(String(init?.body)).toContain("where id = 2438; limit 1;");
          return new Response(
            JSON.stringify([
              {
                id: 2438,
                name: "Prince of Persia",
                cover: {
                  url: "//images.igdb.com/igdb/image/upload/t_cover_big_2x/curated-migrated.jpg",
                },
              },
            ]),
          );
        }
        if (url.endsWith("/curated-migrated.jpg")) return image([1, 9, 9]);
        return new Response(null, { status: 404 });
      });
      const resolver = createArtworkResolver({
        cacheDirectory: directory,
        igdbCredentials: { clientId: "fake-client-id", clientSecret: "fake-client-secret" },
        fetch,
      });

      await expect(resolver.resolve(appId, "Prince of Persia®")).resolves.toMatchObject({
        orientation: "portrait",
      });
      await expect(readFile(join(directory, `${appId}.json`), "utf8")).resolves.toContain(
        '"source":"igdb-curated-override","identity":"app-id-override","providerGameId":2438',
      );
    });
  });

  test.each([
    {
      appId: 15100,
      title: "Assassin's Creed",
      gameId: 27827,
      gameName: "Assassin's Creed: Director's Cut Edition",
      imageName: "curated-cached-assassins-creed.jpg",
    },
    {
      appId: 19980,
      title: "Prince of Persia",
      gameId: 2438,
      gameName: "Prince of Persia",
      imageName: "curated-cached-prince-of-persia.jpg",
    },
  ])(
    "re-resolves a v4 Steam landscape cache into the curated portrait for Steam $appId",
    async (override) => {
      await withDirectory(async (directory) => {
        await Promise.all([
          writeFile(join(directory, `${override.appId}.img`), new Uint8Array([0])),
          writeFile(
            join(directory, `${override.appId}.json`),
            JSON.stringify({
              version: 4,
              contentType: "image/jpeg",
              orientation: "landscape",
              source: "steam",
            }),
          ),
        ]);
        const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
          const url = String(input);
          if (url.endsWith("/library_600x900.jpg")) return new Response(null, { status: 404 });
          if (url === "https://id.twitch.tv/oauth2/token") {
            return new Response(
              JSON.stringify({
                access_token: "temporary-artwork-token",
                token_type: "bearer",
                expires_in: 3600,
              }),
            );
          }
          if (url === "https://api.igdb.com/v4/games") {
            expect(String(init?.body)).toContain(`where id = ${override.gameId}; limit 1;`);
            return new Response(
              JSON.stringify([
                {
                  id: override.gameId,
                  name: override.gameName,
                  cover: {
                    url: `//images.igdb.com/igdb/image/upload/t_cover_big_2x/${override.imageName}`,
                  },
                },
              ]),
            );
          }
          if (url.endsWith(`/${override.imageName}`)) return image([override.appId % 256]);
          return new Response(null, { status: 404 });
        });
        const resolver = createArtworkResolver({
          cacheDirectory: directory,
          igdbCredentials: { clientId: "fake-client-id", clientSecret: "fake-client-secret" },
          fetch,
        });

        await expect(resolver.resolve(override.appId, override.title)).resolves.toMatchObject({
          orientation: "portrait",
        });
        await expect(readFile(join(directory, `${override.appId}.img`))).resolves.toEqual(
          Buffer.from(jpeg([override.appId % 256])),
        );
        await expect(
          readFile(join(directory, `${override.appId}.json`), "utf8"),
        ).resolves.toContain('"source":"igdb-curated-override"');
      });
    },
  );

  test.each([
    [
      15100,
      "Assassin's Creed™: Director's Cut Edition",
      27827,
      "Assassin's Creed: Director's Cut Edition",
    ],
    [19980, "Prince of Persia®", 2438, "Prince of Persia"],
  ])(
    "prioritizes the curated override over a trusted Steam portrait cache for %i",
    async (appId, title, gameId, gameName) => {
      await withDirectory(async (directory) => {
        await Promise.all([
          writeFile(join(directory, `${appId}.img`), new Uint8Array([0])),
          writeFile(
            join(directory, `${appId}.json`),
            JSON.stringify({
              version: 4,
              contentType: "image/jpeg",
              orientation: "portrait",
              source: "steam",
            }),
          ),
        ]);
        const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
          const url = String(input);
          if (url === "https://id.twitch.tv/oauth2/token") {
            return new Response(
              JSON.stringify({
                access_token: "temporary-artwork-token",
                token_type: "bearer",
                expires_in: 3600,
              }),
            );
          }
          if (url === "https://api.igdb.com/v4/games") {
            expect(String(init?.body)).toContain(`where id = ${gameId}; limit 1;`);
            return new Response(
              JSON.stringify([
                {
                  id: gameId,
                  name: gameName,
                  cover: {
                    url: "//images.igdb.com/igdb/image/upload/t_cover_big_2x/curated-priority.jpg",
                  },
                },
              ]),
            );
          }
          if (url.endsWith("/curated-priority.jpg")) return image([5, 1, 5]);
          return new Response(null, { status: 404 });
        });
        const resolver = createArtworkResolver({
          cacheDirectory: directory,
          igdbCredentials: { clientId: "fake-client-id", clientSecret: "fake-client-secret" },
          fetch,
        });

        await expect(resolver.resolve(appId, title)).resolves.toMatchObject({
          orientation: "portrait",
        });
        await expect(readFile(join(directory, `${appId}.img`))).resolves.toEqual(
          Buffer.from(jpeg([5, 1, 5])),
        );
        await expect(readFile(join(directory, `${appId}.json`), "utf8")).resolves.toContain(
          '"source":"igdb-curated-override"',
        );
      });
    },
  );

  test.each([
    {
      name: "a curated provider game ID copied from another Steam app",
      appId: 19980,
      metadata: {
        version: 4,
        contentType: "image/jpeg",
        orientation: "portrait",
        source: "igdb-curated-override",
        identity: "app-id-override",
        providerGameId: 27827,
      },
    },
    {
      name: "a legacy curated cache record",
      appId: 15100,
      metadata: {
        version: 3,
        contentType: "image/jpeg",
        orientation: "portrait",
        source: "igdb-curated-override",
      },
    },
  ])("re-resolves $name instead of trusting its cached artwork", async ({ appId, metadata }) => {
    await withDirectory(async (directory) => {
      await Promise.all([
        writeFile(join(directory, `${appId}.img`), new Uint8Array([0])),
        writeFile(join(directory, `${appId}.json`), JSON.stringify(metadata)),
      ]);
      const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
        expect(String(input)).toBe(
          `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`,
        );
        return image([5, 1, 5]);
      });
      const resolver = createArtworkResolver({ cacheDirectory: directory, fetch });

      await expect(resolver.resolve(appId)).resolves.toMatchObject({ orientation: "portrait" });
      expect(fetch).toHaveBeenCalledTimes(1);
      await expect(readFile(join(directory, `${appId}.img`))).resolves.toEqual(
        Buffer.from(jpeg([5, 1, 5])),
      );
    });
  });

  test("rejects oversized streamed artwork without buffering it through arrayBuffer", async () => {
    await withDirectory(async (directory) => {
      const arrayBuffer = vi.fn(async () => new ArrayBuffer(0));
      const oversizedImage = {
        ok: true,
        headers: new Headers({ "content-type": "image/jpeg", "content-length": "1" }),
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(10 * 1024 * 1024));
            controller.enqueue(new Uint8Array([1]));
            controller.close();
          },
        }),
        arrayBuffer,
      } as unknown as Response;
      const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
        const url = String(input);
        if (url.endsWith("/library_600x900.jpg")) return oversizedImage;
        if (url.includes("store.steampowered.com/api/appdetails")) return appDetails(2);
        return new Response(null, { status: 404 });
      });
      const resolver = createArtworkResolver({ cacheDirectory: directory, fetch });

      await expect(resolver.resolve(2)).resolves.toBeUndefined();
      expect(arrayBuffer).not.toHaveBeenCalled();
      await expect(readFile(join(directory, "2.img"))).rejects.toThrow();
    });
  });

  test.each([
    { contentType: "image/jpeg", bytes: [0xff, 0xd8, 0xff, 0xe0] },
    { contentType: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
    {
      contentType: "image/webp",
      bytes: [0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50],
    },
  ])(
    "caches artwork only when the $contentType signature matches",
    async ({ contentType, bytes }) => {
      await withDirectory(async (directory) => {
        const fetch = vi.fn<typeof globalThis.fetch>(
          async () =>
            new Response(new Uint8Array(bytes), { headers: { "content-type": contentType } }),
        );
        const resolver = createArtworkResolver({ cacheDirectory: directory, fetch });

        await expect(resolver.resolve(3527290)).resolves.toMatchObject({ contentType });
        await expect(readFile(join(directory, "3527290.img"))).resolves.toEqual(Buffer.from(bytes));
      });
    },
  );

  test("rejects artwork with a mismatched or unknown image signature without caching it", async () => {
    await withDirectory(async (directory) => {
      const fetch = vi.fn<typeof globalThis.fetch>(
        async () =>
          new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
            headers: { "content-type": "image/jpeg" },
          }),
      );
      const resolver = createArtworkResolver({ cacheDirectory: directory, fetch });

      await expect(resolver.resolve(3527290)).resolves.toBeUndefined();
      await expect(readFile(join(directory, "3527290.img"))).rejects.toThrow();
      await expect(readFile(join(directory, "3527290.json"))).rejects.toThrow();
    });
  });

  test("rejects unsupported artwork content types without caching them", async () => {
    await withDirectory(async (directory) => {
      const fetch = vi.fn<typeof globalThis.fetch>(
        async () =>
          new Response(new Uint8Array([0x47, 0x49, 0x46, 0x38]), {
            headers: { "content-type": "image/gif" },
          }),
      );
      const resolver = createArtworkResolver({ cacheDirectory: directory, fetch });

      await expect(resolver.resolve(3527290)).resolves.toBeUndefined();
      await expect(readFile(join(directory, "3527290.img"))).rejects.toThrow();
      await expect(readFile(join(directory, "3527290.json"))).rejects.toThrow();
    });
  });

  test("aborts a stalled artwork download after the standard request timeout", async () => {
    vi.useFakeTimers();
    try {
      await withDirectory(async (directory) => {
        let notifyFetchStarted: (() => void) | undefined;
        const fetchStarted = new Promise<void>((resolve) => {
          notifyFetchStarted = resolve;
        });
        let signal: AbortSignal | undefined;
        const fetch = vi.fn<typeof globalThis.fetch>((_input, options) => {
          signal ??= options?.signal ?? undefined;
          notifyFetchStarted?.();
          if (signal === undefined || signal.aborted)
            return Promise.resolve(new Response(null, { status: 404 }));
          return new Promise<Response>((_resolve, reject) => {
            signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
          });
        });
        const resolver = createArtworkResolver({ cacheDirectory: directory, fetch });
        const resolution = resolver.resolve(3527290);

        await fetchStarted;
        expect(signal?.aborted).toBe(false);
        await vi.advanceTimersByTimeAsync(10_000);

        expect(signal?.aborted).toBe(true);
        await expect(resolution).resolves.toBeUndefined();
        await expect(readFile(join(directory, "3527290.img"))).rejects.toThrow();
      });
    } finally {
      vi.useRealTimers();
    }
  });

  test("aborts and cancels an artwork body that stalls after response headers arrive", async () => {
    vi.useFakeTimers();
    try {
      await withDirectory(async (directory) => {
        let notifyFetchStarted: (() => void) | undefined;
        const fetchStarted = new Promise<void>((resolve) => {
          notifyFetchStarted = resolve;
        });
        let signal: AbortSignal | undefined;
        let streamCanceled = false;
        let notifyBodyRead: (() => void) | undefined;
        const bodyRead = new Promise<void>((resolve) => {
          notifyBodyRead = resolve;
        });
        const body = new ReadableStream<Uint8Array>(
          {
            start(controller) {
              controller.enqueue(new Uint8Array(jpeg()));
            },
            pull() {
              notifyBodyRead?.();
            },
            cancel() {
              streamCanceled = true;
            },
          },
          { highWaterMark: 0 },
        );
        const fetch = vi.fn<typeof globalThis.fetch>((_input, options) => {
          signal ??= options?.signal ?? undefined;
          notifyFetchStarted?.();
          return Promise.resolve(new Response(body, { headers: { "content-type": "image/jpeg" } }));
        });
        const resolver = createArtworkResolver({ cacheDirectory: directory, fetch });
        const resolution = resolver.resolve(3527290);

        await fetchStarted;
        await bodyRead;
        expect(vi.getTimerCount()).toBe(1);
        await vi.runAllTimersAsync();

        expect(signal?.aborted).toBe(true);
        await expect(resolution).resolves.toBeUndefined();
        expect(streamCanceled).toBe(true);
        await expect(readFile(join(directory, "3527290.img"))).rejects.toThrow();
      });
    } finally {
      vi.useRealTimers();
    }
  });

  test("caps the artwork cache and evicts the lowest app ID deterministically", async () => {
    await withDirectory(async (directory) => {
      const cacheEntries = Array.from({ length: 128 }, (_, index) => index + 1);
      await Promise.all(
        cacheEntries.flatMap((appId) => [
          writeFile(join(directory, `${appId}.img`), new Uint8Array([appId % 256])),
          writeFile(
            join(directory, `${appId}.json`),
            JSON.stringify({ version: 2, contentType: "image/jpeg", orientation: "portrait" }),
          ),
        ]),
      );
      const fetch = vi.fn<typeof globalThis.fetch>(async () => image([9]));
      const resolver = createArtworkResolver({ cacheDirectory: directory, fetch });

      await expect(resolver.resolve(999)).resolves.toBeDefined();
      await expect(readFile(join(directory, "1.img"))).rejects.toThrow();
      await expect(readFile(join(directory, "999.img"))).resolves.toEqual(Buffer.from(jpeg([9])));
    });
  });
});
