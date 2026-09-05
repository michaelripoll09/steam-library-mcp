// @vitest-environment jsdom

import { describe, expect, test } from "vitest";

import { formatLabel } from "../../dashboard-ui/src/library-panel.js";

type FiltersModule = Readonly<{
  createLibraryFilters: (overrides?: Record<string, unknown>) => Record<string, unknown>;
  clearLibraryFilters: () => Record<string, unknown>;
  filterLibraryGames: <T extends Record<string, unknown>>(
    games: readonly T[],
    filters: Record<string, unknown>,
  ) => readonly T[];
  formatPlaytime: (minutes: number) => string;
  LIBRARY_ACCESS_FILTER_OPTIONS: readonly string[];
}>;

const games = [
  {
    appId: 1,
    name: "Planet Crafter",
    status: "backlog",
    accessType: "owned",
    playtimeMinutes: 0,
  },
  {
    appId: 2,
    name: "Deep Rock Galactic",
    status: "playing",
    accessType: "manual",
    playtimeMinutes: 125,
  },
  {
    appId: 3,
    name: "Planet Zoo",
    status: "completed",
    accessType: "owned",
    playtimeMinutes: 45,
  },
] as const;

async function loadFilters(): Promise<FiltersModule | undefined> {
  return import("../../dashboard-ui/src/library-filters.js").catch(() => undefined) as Promise<
    FiltersModule | undefined
  >;
}

describe("dashboard library filters", () => {
  test("keeps shared library display labels stable after extraction", () => {
    expect(formatLabel("playing")).toBe("Jugando");
    expect(formatLabel("manual")).toBe("Manual");
  });

  test("trims and normalizes a game name query while preserving upstream order", async () => {
    const module = await loadFilters();
    expect(module).toBeDefined();
    if (module === undefined) return;

    const filtered = module.filterLibraryGames(
      games,
      module.createLibraryFilters({ query: "  PLANET  " }),
    );

    expect(filtered.map((game) => game.appId)).toEqual([1, 3]);
  });

  test("composes status, access type, and played state filters", async () => {
    const module = await loadFilters();
    expect(module).toBeDefined();
    if (module === undefined) return;

    const filtered = module.filterLibraryGames(
      games,
      module.createLibraryFilters({
        status: "playing",
        accessType: "manual",
        played: "played",
      }),
    );

    expect(filtered.map((game) => game.appId)).toEqual([2]);
  });

  test("exports all supported access filters including family access", async () => {
    const module = await loadFilters();
    expect(module).toBeDefined();
    if (module === undefined) return;

    expect(module.LIBRARY_ACCESS_FILTER_OPTIONS).toEqual(["all", "owned", "family", "manual"]);
  });

  test("clears every library filter back to the unfiltered state", async () => {
    const module = await loadFilters();
    expect(module).toBeDefined();
    if (module === undefined) return;

    expect(module.clearLibraryFilters()).toEqual({
      query: "",
      status: "all",
      accessType: "all",
      played: "all",
    });
    expect(module.filterLibraryGames(games, module.clearLibraryFilters())).toEqual(games);
  });

  test("formats playtime compactly for minutes and whole hours", async () => {
    const module = await loadFilters();
    expect(module).toBeDefined();
    if (module === undefined) return;

    expect(module.formatPlaytime(45)).toBe("45m");
    expect(module.formatPlaytime(120)).toBe("2h");
    expect(module.formatPlaytime(125)).toBe("2h 5m");
  });
});
