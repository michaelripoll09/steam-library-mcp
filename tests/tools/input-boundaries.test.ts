import { describe, expect, test } from "vitest";

import {
  BACKLOG_MAX_AVAILABLE_MINUTES,
  BACKLOG_MAX_TARGET_GAME_COUNT,
  MANUAL_STEAM_INPUT_MAX_LENGTH,
  MCP_IDENTIFIER_MAX_LENGTH,
  METADATA_FILTER_ARRAY_MAX_ITEMS,
  METADATA_FILTER_ITEM_MAX_LENGTH,
  PLAY_NOW_MAX_AVAILABLE_MINUTES,
  PLAY_NOW_MAX_RESULTS,
  SEARCH_QUERY_MAX_LENGTH,
} from "../../src/domain/input-limits.js";
import {
  manualCollectionAddInputSchema,
  metadataQueryInputSchema,
  recentGamesInputSchema,
  searchLibraryInputSchema,
  steamGameInputSchema,
  taskIdentifierSchema,
} from "../../src/tools/schemas.js";

describe("MCP input boundaries", () => {
  test("rejects unsafe app IDs while accepting valid ones", () => {
    expect(steamGameInputSchema.safeParse({ appId: 620 }).success).toBe(true);
    for (const appId of [
      Number.MAX_SAFE_INTEGER + 1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      -1,
      0,
      1.5,
      "620",
    ]) {
      expect(steamGameInputSchema.safeParse({ appId }).success, `appId=${String(appId)}`).toBe(
        false,
      );
    }
  });

  test("bounds search queries at exactly the maximum length", () => {
    expect(
      searchLibraryInputSchema.safeParse({ query: "a".repeat(SEARCH_QUERY_MAX_LENGTH) }).success,
    ).toBe(true);
    expect(
      searchLibraryInputSchema.safeParse({ query: "a".repeat(SEARCH_QUERY_MAX_LENGTH + 1) })
        .success,
    ).toBe(false);
    expect(searchLibraryInputSchema.safeParse({ query: "   " }).success).toBe(false);
    expect(searchLibraryInputSchema.safeParse({ query: "x".repeat(100_000) }).success).toBe(false);
  });

  test("bounds manual Steam input length", () => {
    expect(
      manualCollectionAddInputSchema.safeParse({ steam: "s".repeat(MANUAL_STEAM_INPUT_MAX_LENGTH) })
        .success,
    ).toBe(true);
    expect(
      manualCollectionAddInputSchema.safeParse({
        steam: "s".repeat(MANUAL_STEAM_INPUT_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);
    expect(manualCollectionAddInputSchema.safeParse({ steam: "   " }).success).toBe(false);
  });

  test("bounds metadata filter items and arrays", () => {
    const item = "g".repeat(METADATA_FILTER_ITEM_MAX_LENGTH);
    const items = Array.from(
      { length: METADATA_FILTER_ARRAY_MAX_ITEMS },
      (_, index) => `g${index}`,
    );
    expect(metadataQueryInputSchema.safeParse({ genres: [item] }).success).toBe(true);
    expect(metadataQueryInputSchema.safeParse({ genres: items }).success).toBe(true);
    expect(metadataQueryInputSchema.safeParse({ genres: [`${item}x`] }).success, "item max+1").toBe(
      false,
    );
    expect(
      metadataQueryInputSchema.safeParse({ genres: [...items, "extra"] }).success,
      "array max+1",
    ).toBe(false);
    expect(metadataQueryInputSchema.safeParse({ genres: ["  "] }).success, "blank item").toBe(
      false,
    );
    expect(metadataQueryInputSchema.safeParse({ genres: [] }).success, "empty array").toBe(false);
  });

  test("rejects unsafe metadata numerics while keeping valid bounds", () => {
    expect(metadataQueryInputSchema.safeParse({ genres: ["action"], limit: 50 }).success).toBe(
      true,
    );
    expect(metadataQueryInputSchema.safeParse({ genres: ["action"], limit: 51 }).success).toBe(
      false,
    );
    expect(metadataQueryInputSchema.safeParse({ genres: ["action"], limit: 1.5 }).success).toBe(
      false,
    );
    expect(
      metadataQueryInputSchema.safeParse({
        genres: ["action"],
        releaseYearFrom: Number.MAX_SAFE_INTEGER + 1,
      }).success,
    ).toBe(false);
    expect(
      metadataQueryInputSchema.safeParse({ releaseYearFrom: 2020, releaseYearTo: 2019 }).success,
      "inverted range",
    ).toBe(false);
    expect(metadataQueryInputSchema.safeParse({ limit: 10 }).success, "no filter").toBe(false);
  });

  test("bounds recent game counts as safe integers", () => {
    expect(recentGamesInputSchema.safeParse({ count: 50 }).success).toBe(true);
    expect(recentGamesInputSchema.safeParse({ count: 51 }).success).toBe(false);
    expect(recentGamesInputSchema.safeParse({ count: 1.5 }).success).toBe(false);
    expect(recentGamesInputSchema.safeParse({ count: Number.MAX_SAFE_INTEGER + 1 }).success).toBe(
      false,
    );
  });

  test("bounds task identifiers", () => {
    expect(taskIdentifierSchema.safeParse("t".repeat(MCP_IDENTIFIER_MAX_LENGTH)).success).toBe(
      true,
    );
    expect(taskIdentifierSchema.safeParse("t".repeat(MCP_IDENTIFIER_MAX_LENGTH + 1)).success).toBe(
      false,
    );
    expect(taskIdentifierSchema.safeParse("   ").success).toBe(false);
    expect(taskIdentifierSchema.safeParse("x".repeat(10_000)).success).toBe(false);
  });

  test("does not leak internals for adversarial inputs", () => {
    const parsed = searchLibraryInputSchema.safeParse({ query: "x".repeat(100_000) });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? "";
      expect(message).not.toMatch(/secret|token|api[_-]?key|stack|sql/i);
    }
  });
});

describe("MCP numeric session limits", () => {
  test("exposes the specified defensive bounds", () => {
    expect(SEARCH_QUERY_MAX_LENGTH).toBe(200);
    expect(MANUAL_STEAM_INPUT_MAX_LENGTH).toBe(2048);
    expect(METADATA_FILTER_ITEM_MAX_LENGTH).toBe(100);
    expect(METADATA_FILTER_ARRAY_MAX_ITEMS).toBe(20);
    expect(PLAY_NOW_MAX_AVAILABLE_MINUTES).toBe(1440);
    expect(PLAY_NOW_MAX_RESULTS).toBe(50);
    expect(BACKLOG_MAX_AVAILABLE_MINUTES).toBe(44640);
    expect(BACKLOG_MAX_TARGET_GAME_COUNT).toBe(100);
    expect(MCP_IDENTIFIER_MAX_LENGTH).toBe(255);
  });
});
