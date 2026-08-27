import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";

import { createArtworkResolver } from "../../src/dashboard/artwork-resolver.js";

describe("artwork resolver", () => {
  test("caches allowlisted public Steam artwork locally without credentials", async () => {
    const directory = await mkdtemp(join(tmpdir(), "steam-artwork-"));
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            3527290: {
              success: true,
              data: {
                header_image: "https://shared.akamai.steamstatic.com/steam/apps/3527290/header.jpg",
              },
            },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } }),
      );
    try {
      const resolver = createArtworkResolver({ cacheDirectory: directory, fetch });
      await expect(resolver.resolve(3527290)).resolves.toMatchObject({ contentType: "image/jpeg" });
      expect(String(fetch.mock.calls[0]?.[0])).toContain(
        "store.steampowered.com/api/appdetails?appids=3527290",
      );
      expect(fetch.mock.calls[0]?.[1]).toBeUndefined();
      expect(await readFile(join(directory, "3527290.img"))).toEqual(Buffer.from([1, 2, 3]));
      await resolver.resolve(3527290);
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("uses SteamGridDB only when explicitly configured and never forwards Steam credentials", async () => {
    const directory = await mkdtemp(join(tmpdir(), "steam-artwork-"));
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ 1: { success: false } })))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            data: [{ url: "https://s3.amazonaws.com/steamgriddb/grids/1.jpg" }],
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([4]), { headers: { "content-type": "image/jpeg" } }),
      );
    try {
      const resolver = createArtworkResolver({
        cacheDirectory: directory,
        steamGridDbApiKey: "grid-key",
        fetch,
      });
      await expect(resolver.resolve(1)).resolves.toBeDefined();
      expect(fetch.mock.calls[1]?.[1]).toMatchObject({
        headers: { Authorization: "Bearer grid-key" },
      });
      expect(fetch.mock.calls[2]?.[1]).not.toHaveProperty("headers");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("rejects oversized streamed artwork without buffering it through arrayBuffer", async () => {
    const directory = await mkdtemp(join(tmpdir(), "steam-artwork-"));
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
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            2: {
              success: true,
              data: {
                header_image: "https://shared.akamai.steamstatic.com/steam/apps/2/header.jpg",
              },
            },
          }),
        ),
      )
      .mockResolvedValueOnce(oversizedImage);
    try {
      const resolver = createArtworkResolver({ cacheDirectory: directory, fetch });
      await expect(resolver.resolve(2)).resolves.toBeUndefined();
      expect(arrayBuffer).not.toHaveBeenCalled();
      await expect(readFile(join(directory, "2.img"))).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("rejects artwork whose declared length exceeds the cap before opening its stream", async () => {
    const directory = await mkdtemp(join(tmpdir(), "steam-artwork-"));
    const getReader = vi.fn();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            3: {
              success: true,
              data: {
                header_image: "https://shared.akamai.steamstatic.com/steam/apps/3/header.jpg",
              },
            },
          }),
        ),
      )
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({
          "content-type": "image/jpeg",
          "content-length": String(10 * 1024 * 1024 + 1),
        }),
        body: { getReader },
      } as unknown as Response);
    try {
      const resolver = createArtworkResolver({ cacheDirectory: directory, fetch });
      await expect(resolver.resolve(3)).resolves.toBeUndefined();
      expect(getReader).not.toHaveBeenCalled();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("caps the artwork cache and evicts the lowest app ID deterministically", async () => {
    const directory = await mkdtemp(join(tmpdir(), "steam-artwork-"));
    const cacheEntries = Array.from({ length: 128 }, (_, index) => index + 1);
    await Promise.all(
      cacheEntries.flatMap((appId) => [
        writeFile(join(directory, `${appId}.img`), new Uint8Array([appId % 256])),
        writeFile(join(directory, `${appId}.json`), '{"contentType":"image/jpeg"}'),
      ]),
    );
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            999: {
              success: true,
              data: {
                header_image: "https://shared.akamai.steamstatic.com/steam/apps/999/header.jpg",
              },
            },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([9]), { headers: { "content-type": "image/jpeg" } }),
      );
    try {
      const resolver = createArtworkResolver({ cacheDirectory: directory, fetch });
      await expect(resolver.resolve(999)).resolves.toBeDefined();
      await expect(readFile(join(directory, "1.img"))).rejects.toThrow();
      await expect(readFile(join(directory, "999.img"))).resolves.toEqual(Buffer.from([9]));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
