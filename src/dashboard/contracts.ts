export const DASHBOARD_GAME_STATUSES = Object.freeze([
  "backlog",
  "playing",
  "completed",
  "dropped",
  "paused",
] as const);

export const DASHBOARD_MUTABLE_STATUSES = Object.freeze([
  "playing",
  "completed",
  "dropped",
] as const);

export type DashboardGameStatus = (typeof DASHBOARD_GAME_STATUSES)[number];
export type DashboardMutableStatus = (typeof DASHBOARD_MUTABLE_STATUSES)[number];

export type DashboardGame = Readonly<{
  appId: number;
  name: string;
  status: DashboardGameStatus;
  coverUrl: string;
  accessType: "owned" | "family_shared";
  isPlayable: boolean;
  playtimeMinutes: number;
  recentPlaytimeMinutes?: number;
  lastPlayedAt?: string;
}>;

export type DashboardTotals = Readonly<{
  totalGames: number;
  playedGames: number;
  unplayedGames: number;
  totalPlaytimeMinutes: number;
}>;

export type DashboardStatusStats = Readonly<Record<DashboardGameStatus, number>>;

export type DashboardLibrary = Readonly<{
  games: readonly DashboardGame[];
  totals: DashboardTotals;
  statusStats: DashboardStatusStats;
}>;

export type DashboardMarkResult =
  | Readonly<{
      outcome: "updated" | "unchanged";
      appId: number;
      status: DashboardMutableStatus;
    }>
  | Readonly<{ outcome: "not_owned"; appId: number }>;

export type DashboardStatusUpdate = Readonly<{
  mark: DashboardMarkResult;
  library: DashboardLibrary;
}>;
