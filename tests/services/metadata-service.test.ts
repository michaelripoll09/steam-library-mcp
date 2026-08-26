import { describe, expect, test, vi } from "vitest";

import { createMetadataService } from "../../src/services/metadata-service.js";
import { filterMetadata, normalizeMetadata, selectSteamMatch } from "../../src/domain/metadata.js";
import type { IgdbClient } from "../../src/igdb/client.js";
import type { SteamService } from "../../src/services/steam-service.js";

const game = (id: number, uid = "620") => ({
  id,
  external_games: [{ category: 1, uid }],
  genres: [{ name: " Puzzle " }, { name: "puzzle" }],
  keywords: [{ name: "Portal" }],
  themes: [{ name: "Sci-Fi" }],
  first_release_date: 1_300_000_000,
});

describe("metadata domain", () => {
  test("selects the lowest exact category-1 Steam UID match and rejects noncanonical records", () => {
    expect(
      selectSteamMatch(
        [
          game(9),
          game(3),
          game(1, "0620"),
          { ...game(2), external_games: [{ category: 2, uid: "620" }] },
        ],
        620,
      )?.id,
    ).toBe(3);
    expect(selectSteamMatch([game(1, "621")], 620)).toBeUndefined();
  });

  test("normalizes complete and missing metadata without recommendation fields", () => {
    expect(normalizeMetadata(game(3), 620, "Portal 2")).toEqual({
      appId: 620,
      name: "Portal 2",
      genres: ["Puzzle"],
      tags: ["Portal"],
      themes: ["Sci-Fi"],
      releaseDate: "2011-03-13",
      metadataStatus: "complete",
      missingReason: null,
      cacheState: "live",
    });
    expect(normalizeMetadata(undefined, 620, "Portal 2")).toEqual({
      appId: 620,
      name: "Portal 2",
      genres: [],
      tags: [],
      themes: [],
      releaseDate: null,
      metadataStatus: "missing",
      missingReason: "not_found",
      cacheState: "none",
    });
  });

  test("normalizes incomplete upstream records as partial metadata", () => {
    expect(
      normalizeMetadata(
        { ...game(3), keywords: undefined, first_release_date: undefined },
        620,
        "Portal 2",
      ),
    ).toMatchObject({
      tags: [],
      releaseDate: null,
      metadataStatus: "partial",
      missingReason: null,
    });
  });

  test("filters case-insensitively with OR within fields and AND across fields", () => {
    const items = [
      normalizeMetadata(game(3), 620, "Portal 2"),
      {
        ...normalizeMetadata(game(4), 440, "TF2"),
        genres: ["Action"],
        tags: ["Shooter"],
        releaseDate: "2007-10-10" as string | null,
      },
    ];
    expect(
      filterMetadata(items, {
        genres: ["puzzle", "action"],
        tags: ["portal"],
        releaseYearFrom: 2010,
      }),
    ).toEqual([items[0]]);
  });
});

describe("metadata service", () => {
  test("checks ownership before IGDB and caches complete values for 24 hours with a seven-day stale fallback", async () => {
    let now = 0;
    const getGame = vi.fn<SteamService["getGame"]>(async (appId) => {
      if (appId === 999) throw new Error("not owned");
      return { appId, name: "Portal 2", playtimeMinutes: 1 };
    });
    const findGamesForSteamApp = vi.fn<IgdbClient["findGamesForSteamApp"]>(async () => [game(3)]);
    const service = createMetadataService({
      steamService: { getGame } as unknown as SteamService,
      igdbClient: { findGamesForSteamApp } as IgdbClient,
      clock: { now: () => now },
    });

    await expect(service.getOwnedGameMetadata(999)).resolves.toMatchObject({
      metadataStatus: "missing",
    });
    expect(findGamesForSteamApp).not.toHaveBeenCalled();
    await expect(service.getOwnedGameMetadata(620)).resolves.toMatchObject({
      cacheState: "live",
      metadataStatus: "complete",
    });
    now += 86_399_999;
    await expect(service.getOwnedGameMetadata(620)).resolves.toMatchObject({ cacheState: "fresh" });
    expect(findGamesForSteamApp).toHaveBeenCalledTimes(1);
    now += 1;
    findGamesForSteamApp.mockResolvedValueOnce({
      isError: true,
      error: { code: "METADATA_UNAVAILABLE", message: "temporary", retryable: true },
    });
    await expect(service.getOwnedGameMetadata(620)).resolves.toMatchObject({ cacheState: "stale" });
  });

  test("limits owned-library enrichment to four concurrent IGDB requests", async () => {
    let active = 0;
    let maximum = 0;
    const games = Array.from({ length: 6 }, (_, index) => ({
      appId: index + 1,
      name: `Game ${index + 1}`,
      playtimeMinutes: 0,
    }));
    const service = createMetadataService({
      steamService: {
        getGame: vi.fn(async (appId) => games.find((item) => item.appId === appId)!),
        getLibrary: vi.fn(async () => ({ games })),
      } as unknown as SteamService,
      igdbClient: {
        findGamesForSteamApp: vi.fn(async (appId) => {
          active += 1;
          maximum = Math.max(maximum, active);
          await Promise.resolve();
          active -= 1;
          return [game(appId, String(appId))];
        }),
      } as IgdbClient,
      clock: { now: () => 0 },
    });

    await expect(service.queryOwnedMetadata({ genres: ["puzzle"] })).resolves.toHaveLength(6);
    expect(maximum).toBeLessThanOrEqual(4);
  });

  test("expires negative entries after one hour and refuses stale positives after seven days", async () => {
    let now = 0;
    const findGamesForSteamApp = vi
      .fn<IgdbClient["findGamesForSteamApp"]>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([game(3, "621")])
      .mockResolvedValueOnce({
        isError: true,
        error: { code: "METADATA_UNAVAILABLE", message: "temporary", retryable: true },
      });
    const service = createMetadataService({
      steamService: {
        getGame: vi.fn(async (appId) => ({ appId, name: "Portal 2", playtimeMinutes: 0 })),
      } as unknown as SteamService,
      igdbClient: { findGamesForSteamApp } as IgdbClient,
      clock: { now: () => now },
    });

    await expect(service.getOwnedGameMetadata(620)).resolves.toMatchObject({
      metadataStatus: "missing",
      cacheState: "none",
    });
    now += 3_600_000;
    await expect(service.getOwnedGameMetadata(620)).resolves.toMatchObject({
      metadataStatus: "missing",
    });
    await expect(service.getOwnedGameMetadata(621)).resolves.toMatchObject({
      metadataStatus: "complete",
    });
    now += 604_800_000;
    await expect(service.getOwnedGameMetadata(621)).resolves.toMatchObject({
      isError: true,
      error: { code: "METADATA_UNAVAILABLE" },
    });
    expect(findGamesForSteamApp).toHaveBeenCalledTimes(4);
  });

  test("applies the requested query limit after filtering in app-ID order", async () => {
    const games = [
      { appId: 620, name: "Portal 2", playtimeMinutes: 0 },
      { appId: 440, name: "TF2", playtimeMinutes: 0 },
    ];
    const service = createMetadataService({
      steamService: {
        getGame: vi.fn(async (appId) => games.find((game) => game.appId === appId)!),
        getLibrary: vi.fn(async () => ({ games })),
      } as unknown as SteamService,
      igdbClient: {
        findGamesForSteamApp: vi.fn(async (appId) => [game(appId, String(appId))]),
      } as IgdbClient,
      clock: { now: () => 0 },
    });

    await expect(service.queryOwnedMetadata({ genres: ["puzzle"], limit: 1 })).resolves.toEqual([
      expect.objectContaining({ appId: 440 }),
    ]);
  });
});
