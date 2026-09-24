import { describe, expect, test, vi } from "vitest";

import {
  mapWithConcurrency,
  MAX_DURATION_CONCURRENCY,
} from "../../src/concurrency/map-with-concurrency.js";

describe("mapWithConcurrency", () => {
  test("exposes a duration concurrency limit of 4", () => {
    expect(MAX_DURATION_CONCURRENCY).toBe(4);
  });

  test("returns [] for empty input without calling the mapper", async () => {
    const mapper = vi.fn(async (value: number) => value * 2);

    await expect(mapWithConcurrency([], 4, mapper)).resolves.toEqual([]);
    expect(mapper).not.toHaveBeenCalled();
  });

  test("preserves input ordering when mappers finish out of order", async () => {
    const releases = new Map<number, (value: string) => void>();
    const mapper = vi.fn((value: number) => {
      if (value === 0) {
        return new Promise<string>((resolve) => {
          releases.set(value, resolve);
        });
      }
      return Promise.resolve(`fast-${value}`);
    });

    const pending = mapWithConcurrency([0, 1, 2, 3], 4, mapper);
    await Promise.resolve();
    await Promise.resolve();
    releases.get(0)?.("slow-0");

    await expect(pending).resolves.toEqual(["slow-0", "fast-1", "fast-2", "fast-3"]);
  });

  test("never exceeds the requested concurrency", async () => {
    let active = 0;
    let maxActive = 0;
    const mapper = vi.fn(async (value: number) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => setTimeout(resolve, 1));
      active -= 1;
      return value;
    });

    const result = await mapWithConcurrency([0, 1, 2, 3, 4, 5, 6, 7], 4, mapper);

    expect(result).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(maxActive).toBeLessThanOrEqual(4);
    expect(mapper).toHaveBeenCalledTimes(8);
  });

  test("passes the item index to the mapper", async () => {
    const seen: number[] = [];

    await mapWithConcurrency(["a", "b", "c"], 2, async (_item, index) => {
      seen.push(index);
      return index;
    });

    expect(seen.sort()).toEqual([0, 1, 2]);
  });

  test("rejects when a mapper rejects without hanging the remaining workers", async () => {
    const mapper = vi.fn(async (value: number) => {
      await new Promise<void>((resolve) => setTimeout(resolve, value === 1 ? 30 : 1));
      if (value === 1) throw new Error("mapper failed");
      return value;
    });

    await expect(mapWithConcurrency([0, 1, 2, 3], 2, mapper)).rejects.toThrow("mapper failed");
  });

  test("rejects a non-positive concurrency instead of hanging", async () => {
    const mapper = vi.fn(async (value: number) => value);

    await expect(mapWithConcurrency([1], 0, mapper)).rejects.toThrow(RangeError);
    await expect(mapWithConcurrency([1], -2, mapper)).rejects.toThrow(RangeError);
    expect(mapper).not.toHaveBeenCalled();
  });

  test("does not mutate the input array", async () => {
    const items = Object.freeze([3, 1, 2]);

    await expect(mapWithConcurrency(items, 2, async (value) => value * 10)).resolves.toEqual([
      30, 10, 20,
    ]);
    expect(items).toEqual([3, 1, 2]);
  });
});
