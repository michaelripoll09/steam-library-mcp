import { mkdtemp, readFile, rm } from "node:fs/promises";
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
            data: [{ url: "https://cdn.steamgriddb.com/file/grid.jpg" }],
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
});
