import type { DashboardGame, DashboardGameStatus } from "../../src/dashboard/contracts.js";

export type PlayedFilter = "all" | "played" | "unplayed";

export type LibraryFilters = Readonly<{
  query: string;
  status: DashboardGameStatus | "all";
  accessType: DashboardGame["accessType"] | "all";
  played: PlayedFilter;
}>;

const DEFAULT_LIBRARY_FILTERS: LibraryFilters = Object.freeze({
  query: "",
  status: "all",
  accessType: "all",
  played: "all",
});

export function createLibraryFilters(overrides: Partial<LibraryFilters> = {}): LibraryFilters {
  return { ...DEFAULT_LIBRARY_FILTERS, ...overrides };
}

export function clearLibraryFilters(): LibraryFilters {
  return createLibraryFilters();
}

export function filterLibraryGames(
  games: readonly DashboardGame[],
  filters: LibraryFilters,
): readonly DashboardGame[] {
  const query = filters.query.trim().toLowerCase();
  return games.filter(
    (game) =>
      (query === "" || game.name.toLowerCase().includes(query)) &&
      (filters.status === "all" || game.status === filters.status) &&
      (filters.accessType === "all" || game.accessType === filters.accessType) &&
      (filters.played === "all" ||
        (filters.played === "played" ? game.playtimeMinutes > 0 : game.playtimeMinutes === 0)),
  );
}

export function formatPlaytime(minutes: number): string {
  const normalizedMinutes = Number.isFinite(minutes) ? Math.max(0, Math.floor(minutes)) : 0;
  const hours = Math.floor(normalizedMinutes / 60);
  const remainingMinutes = normalizedMinutes % 60;
  if (hours === 0) return `${remainingMinutes}m`;
  return remainingMinutes === 0 ? `${hours}h` : `${hours}h ${remainingMinutes}m`;
}
