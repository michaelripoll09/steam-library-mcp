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
      await expect(readFile(join(directory, "480.json"), "utf8")).resolves.toContain('"version":2');
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
