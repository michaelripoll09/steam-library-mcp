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
  accessType: "owned" | "manual";
  manualCollection?: boolean;
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

export type DashboardRecommendationPreference = Readonly<{
  appId: number;
  priority: "normal" | "high";
  excludedFromRecommendations: boolean;
  playMode: "any" | "solo" | "with_friends";
}>;

export type DashboardRecommendation = Readonly<{
  appId: number;
  name: string;
  durationEstimateMinutes: number | null;
  reasons: readonly string[];
  explanation: string;
}>;

export type DashboardRecommendations = Readonly<{
  availableMinutes: number;
  recommendations: readonly DashboardRecommendation[];
}>;

export type DashboardPlanItemProgress = "not_started" | "in_progress" | "done" | "skipped";

export type DashboardPlanItem = Readonly<{
  id: string;
  rank: number;
  appId: number;
  name: string;
  durationEstimateMinutes: number | null;
  explanation: string;
  progress: DashboardPlanItemProgress;
}>;

export type DashboardPlan = Readonly<{
  id: string;
  cadence: "weekly" | "monthly";
  availableMinutes: number;
  targetGameCount: number;
  items: readonly DashboardPlanItem[];
}>;

export type DashboardPlanCreateResult = Readonly<{
  plan: DashboardPlan;
  shortfall: Readonly<{
    requestedGameCount: number;
    selectedGameCount: number;
    message: string;
  }> | null;
}>;

export type DashboardInsightSnapshot = Readonly<{
  library: Readonly<{
    totalGames: number;
    playedGames: number;
    unplayedGames: number;
    totalPlaytimeMinutes: number;
    recentlyPlayedGames: number;
  }>;
  activePlans: readonly Readonly<{
    id: string;
    cadence: "weekly" | "monthly";
    itemCount: number;
    completedItemCount: number;
  }>[];
  preferences: Readonly<{
    configuredGames: number;
    highPriorityGames: number;
    excludedGames: number;
    soloGames: number;
    withFriendsGames: number;
  }>;
}>;
