import type { SteamGame, SteamLibrary } from "../domain/models.js";
import { InputError, TrackerInputError } from "../errors.js";
import type { SteamService } from "../services/steam-service.js";
import type { GamingTrackerService, TrackerMarkResult } from "../tracker/gaming-tracker-service.js";
import type { TrackerGame } from "../domain/tracker.js";
import {
  DASHBOARD_MUTABLE_STATUSES,
  type DashboardGame,
  type DashboardGameStatus,
  type DashboardLibrary,
  type DashboardMarkResult,
  type DashboardMutableStatus,
  type DashboardStatusStats,
  type DashboardStatusUpdate,
  type DashboardTotals,
} from "./contracts.js";

type DashboardServiceDependencies = Readonly<{
  steamService: Pick<SteamService, "getLibrary" | "refreshLibrary">;
  gamingTrackerService: Pick<GamingTrackerService, "getStatuses" | "mark">;
}>;

export type DashboardService = Readonly<{
  getLibrary(): Promise<DashboardLibrary>;
  syncLibrary(): Promise<DashboardLibrary>;
  updateStatus(appId: unknown, status: unknown): Promise<DashboardStatusUpdate>;
}>;

export function createDashboardService({
  steamService,
  gamingTrackerService,
}: DashboardServiceDependencies): DashboardService {
  async function project(library: SteamLibrary): Promise<DashboardLibrary> {
    const statuses = await gamingTrackerService.getStatuses();
    return createDashboardLibrary(library.games, statuses);
  }

  return Object.freeze({
    async getLibrary() {
      return project(await steamService.getLibrary());
    },
    async syncLibrary() {
      return project(await steamService.refreshLibrary());
    },
    async updateStatus(appId, status) {
      assertAppId(appId);
      assertMutableStatus(status);
      const mark = await gamingTrackerService.mark(appId, status);
      return Object.freeze({
        mark: toDashboardMarkResult(mark),
        library: await project(await steamService.getLibrary()),
      });
    },
  });
}

function createDashboardLibrary(
  games: readonly SteamGame[],
  trackerGames: readonly TrackerGame[],
): DashboardLibrary {
  const statusesByAppId = new Map(trackerGames.map((game) => [game.appId, game.status]));
  const dashboardGames = Object.freeze(
    games.map((game) => toDashboardGame(game, statusesByAppId.get(game.appId) ?? "backlog")),
  );
  return Object.freeze({
    games: dashboardGames,
    totals: createTotals(dashboardGames),
    statusStats: createStatusStats(dashboardGames),
  });
}

function toDashboardGame(game: SteamGame, status: DashboardGameStatus): DashboardGame {
  return Object.freeze({
    appId: game.appId,
    name: game.name,
    status,
    coverUrl: portraitCoverUrl(game.appId),
    accessType: game.accessType ?? "owned",
    isPlayable: game.isPlayable ?? true,
    playtimeMinutes: game.playtimeMinutes,
    ...(game.recentPlaytimeMinutes === undefined
      ? {}
      : { recentPlaytimeMinutes: game.recentPlaytimeMinutes }),
    ...(game.lastPlayedAt === undefined ? {} : { lastPlayedAt: game.lastPlayedAt }),
  });
}

function createTotals(games: readonly DashboardGame[]): DashboardTotals {
  return Object.freeze({
    totalGames: games.length,
    playedGames: games.filter((game) => game.playtimeMinutes > 0).length,
    unplayedGames: games.filter((game) => game.playtimeMinutes === 0).length,
    totalPlaytimeMinutes: games.reduce((total, game) => total + game.playtimeMinutes, 0),
  });
}

function createStatusStats(games: readonly DashboardGame[]): DashboardStatusStats {
  const stats: Record<DashboardGameStatus, number> = {
    backlog: 0,
    playing: 0,
    completed: 0,
    dropped: 0,
    paused: 0,
  };
  for (const game of games) {
    stats[game.status] += 1;
  }
  return Object.freeze(stats);
}

function toDashboardMarkResult(result: TrackerMarkResult): DashboardMarkResult {
  return result.outcome === "not_owned"
    ? Object.freeze({ outcome: result.outcome, appId: result.appId })
    : Object.freeze({ outcome: result.outcome, appId: result.appId, status: result.status });
}

function portraitCoverUrl(appId: number): string {
  return `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900.jpg`;
}

function assertAppId(appId: unknown): asserts appId is number {
  if (typeof appId !== "number" || !Number.isSafeInteger(appId) || appId <= 0) {
    throw new TrackerInputError();
  }
}

function assertMutableStatus(status: unknown): asserts status is DashboardMutableStatus {
  if (!DASHBOARD_MUTABLE_STATUSES.includes(status as DashboardMutableStatus)) {
    throw new InputError("Status must be one of playing, completed, or dropped.");
  }
}
