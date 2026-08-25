import { describe, expect, test } from "vitest";

import { TtlCache } from "../src/cache/ttl-cache.js";

describe("TtlCache", () => {
  test("returns a fresh value until its TTL expires", () => {
    let now = 1_000;
    const cache = new TtlCache<string>({ now: () => now });
    cache.set("library:76561198000000000", "first", 300_000);

    now += 299_999;
    expect(cache.get("library:76561198000000000")).toBe("first");

    now += 1;
    expect(cache.get("library:76561198000000000")).toBeUndefined();
  });

  test("keeps SteamID-keyed values isolated and clears expired entries", () => {
    let now = 0;
    const cache = new TtlCache<string>({ now: () => now });
    cache.set("library:one", "one-library", 10);
    cache.set("library:two", "two-library", 10);

    now = 10;
    expect(cache.get("library:one")).toBeUndefined();
    expect(cache.get("library:two")).toBeUndefined();

    cache.set("library:two", "refreshed-library", 10);
    expect(cache.get("library:one")).toBeUndefined();
    expect(cache.get("library:two")).toBe("refreshed-library");
  });

  test("can discard every cached value", () => {
    const cache = new TtlCache<number>({ now: () => 0 });
    cache.set("library:one", 1, 10);
    cache.clear();

    expect(cache.get("library:one")).toBeUndefined();
  });
});
