import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";

import { createArtworkResolver } from "../../src/dashboard/artwork-resolver.js";

const image = (bytes = [1, 2, 3]) =>
  new Response(new Uint8Array(bytes), { headers: { "content-type": "image/jpeg" } });
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
        Buffer.from([1, 2, 3]),
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
      const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
        const url = String(input);
        if (url.endsWith("/library_600x900.jpg")) return new Response(null, { status: 404 });
        if (url.includes("steamgriddb.com/api/v2/grids/steam/480")) {
          return new Response(
            JSON.stringify({
              success: true,
              data: [{ url: "https://cdn2.steamgriddb.com/file/sgdb-cdn/grid/spacewar.jpg" }],
            }),
          );
        }
        if (url.includes("cdn2.steamgriddb.com")) return image([4, 8, 0]);
        if (url.includes("store.steampowered.com/api/appdetails")) {
          return appDetails(
            480,
            true,
            "https://shared.akamai.steamstatic.com/steam/apps/480/header.jpg",
          );
        }
        return image();
      });
      const resolver = createArtworkResolver({
        cacheDirectory: directory,
        steamGridDbApiKey: "grid-key",
        fetch,
      });

      await expect(resolver.resolve(480)).resolves.toMatchObject({ orientation: "portrait" });
      const calls = fetch.mock.calls.map(([input]) => String(input));
      expect(calls).toContain(
        "https://www.steamgriddb.com/api/v2/grids/steam/480?dimensions=600x900",
      );
      expect(calls).not.toContain(
        "https://shared.akamai.steamstatic.com/steam/apps/480/header.jpg",
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
      await expect(readFile(join(directory, "480.img"))).resolves.toEqual(Buffer.from([4, 8, 0]));
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
        Buffer.from([4, 5, 1]),
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
        Buffer.from([4, 5, 1]),
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
    [15100, "Assassin's Creed: Director's Cut"],
    [19980, "Prince of Persia"],
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
            expect(body).toContain(`where external_games.uid = "${appId}"`);
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
          if (body.includes(`where external_games.uid = "${appId}"`)) {
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
      expect(String(gameRequests[0]?.[1]?.body)).toContain(`where external_games.uid = "${appId}"`);
      expect(String(gameRequests[1]?.[1]?.body)).toContain('search "Celeste"');
      await expect(readFile(join(directory, `${appId}.json`), "utf8")).resolves.toContain(
        '"identity":"title"',
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
          expect(String(init?.body)).toContain(`where external_games.uid = "${appId}"`);
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
        Buffer.from([1, 5, 1]),
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
          if (body.includes('where external_games.uid = "4513840"')) {
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
      await expect(readFile(join(directory, "999.img"))).resolves.toEqual(Buffer.from([9]));
    });
  });
});
