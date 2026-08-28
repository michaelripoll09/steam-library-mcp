export const BACKLOG_PLAN_CADENCES = Object.freeze(["weekly", "monthly"] as const);
export const BACKLOG_PLAN_LIFECYCLES = Object.freeze(["active", "archived"] as const);
export const BACKLOG_PLAN_ITEM_PROGRESS = Object.freeze([
  "not_started",
  "in_progress",
  "done",
  "skipped",
] as const);

export type BacklogPlanCadence = (typeof BACKLOG_PLAN_CADENCES)[number];
export type BacklogPlanLifecycle = (typeof BACKLOG_PLAN_LIFECYCLES)[number];
export type BacklogPlanItemProgress = (typeof BACKLOG_PLAN_ITEM_PROGRESS)[number];

export type BacklogPlanItem = Readonly<{
  id: string;
  rank: number;
  appId: number;
  name: string;
  durationEstimateMinutes: number | null;
  explanation: string;
  progress: BacklogPlanItemProgress;
  createdAt: string;
  updatedAt: string;
}>;

export type BacklogPlan = Readonly<{
  id: string;
  cadence: BacklogPlanCadence;
  availableMinutes: number;
  targetGameCount: number;
  lifecycle: BacklogPlanLifecycle;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  items: readonly BacklogPlanItem[];
}>;
