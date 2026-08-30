import { describe, expect, it } from "vitest";

import { InputError } from "../src/errors.js";
import {
  parseManualSteamInput,
  SqliteManualLibraryRepository,
} from "../src/manual-library/manual-library.js";
import { openTrackerDatabase } from "../src/tracker/sqlite/database.js";

describe("manual library", () => {
  it("accepts only a positive app ID or the canonical Steam store app URL", () => {
    expect(parseManualSteamInput("413150")).toBe(413150);
    expect(parseManualSteamInput("https://store.steampowered.com/app/413150/Stardew_Valley/")).toBe(
      413150,
    );
    expect(() => parseManualSteamInput("http://store.steampowered.com/app/413150/")).toThrow(
      InputError,
    );
    expect(() => parseManualSteamInput("https://evil.example/app/413150/")).toThrow(InputError);
    expect(() => parseManualSteamInput("0")).toThrow(InputError);
  });

  it("persists one idempotent manual collection entry and removes it", () => {
    const database = openTrackerDatabase(":memory:");
    const repository = new SqliteManualLibraryRepository(database);
    repository.upsert({
      appId: 10,
      name: "First",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    repository.upsert({
      appId: 10,
      name: "Canonical",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    expect(repository.list()).toEqual([
      {
        appId: 10,
        name: "Canonical",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
    ]);
    expect(repository.remove(10)).toBe(true);
    expect(repository.remove(10)).toBe(false);
  });
});
