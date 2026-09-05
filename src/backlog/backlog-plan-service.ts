import { randomUUID } from "node:crypto";

import type { Clock } from "../cache/ttl-cache.js";
import {
  BACKLOG_PLAN_CADENCES,
  BACKLOG_PLAN_ITEM_PROGRESS,
  type BacklogPlan,
  type BacklogPlanCadence,
  type BacklogPlanItem,
  type BacklogPlanItemProgress,
} from "../domain/backlog-plan.js";
import { InputError } from "../errors.js";
import type { BacklogSelectionService } from "./backlog-selection-service.js";

export type BacklogPlanRepository = Readonly<{
  replaceActive(plan: BacklogPlan): void;
  getById(id: string): BacklogPlan | undefined;
  listActive(): readonly BacklogPlan[];
  setItemProgress(
    planId: string,
    itemId: string,
    progress: BacklogPlanItemProgress,
    updatedAt: string,
  ): boolean;
}>;

export type CreateBacklogPlanRequest = Readonly<{
  cadence: BacklogPlanCadence;
  availableMinutes: number;
  targetGameCount: number;
}>;

export type BacklogPlanShortfall = Readonly<{
  requestedGameCount: number;
  selectedGameCount: number;
  message: string;
}>;

export type CreateBacklogPlanResult = Readonly<{
  plan: BacklogPlan;
  shortfall: BacklogPlanShortfall | null;
}>;

type BacklogPlanServiceDependencies = Readonly<{
  selectionService: Pick<BacklogSelectionService, "select">;
  repository: BacklogPlanRepository;
  clock: Clock;
  createId?: () => string;
}>;

export type BacklogPlanService = Readonly<{
  create(request: unknown): Promise<CreateBacklogPlanResult>;
  get(id: unknown): BacklogPlan | undefined;
  listActive(): readonly BacklogPlan[];
  setItemProgress(planId: unknown, itemId: unknown, progress: unknown): Promise<BacklogPlanItem>;
}>;

const allowedTransitions: Readonly<
  Record<BacklogPlanItemProgress, readonly BacklogPlanItemProgress[]>
> = Object.freeze({
  not_started: Object.freeze(["in_progress", "done", "skipped"] as const),
  in_progress: Object.freeze(["done", "skipped"] as const),
  done: Object.freeze([] as const),
  skipped: Object.freeze([] as const),
});

export function createBacklogPlanService({
  selectionService,
  repository,
  clock,
  createId = randomUUID,
}: BacklogPlanServiceDependencies): BacklogPlanService {
  return Object.freeze({
    async create(request: unknown): Promise<CreateBacklogPlanResult> {
      assertCreateRequest(request);

      const selectionResult = await selectionService.select({
        availableMinutes: request.availableMinutes,
        targetGameCount: request.targetGameCount,
      });
      const createdAt = toTimestamp(clock);
      const id = createId();
      assertId(id, "plan ID");
      const plan = createPlan({
        id,
        request,
        createdAt,
        selections: selectionResult.selections.slice(0, request.targetGameCount),
      });

      repository.replaceActive(plan);
      const selectedGameCount = plan.items.length;
      return Object.freeze({
        plan,
        shortfall:
          selectedGameCount === request.targetGameCount
            ? null
            : createShortfall({
                request,
                selectedGameCount,
                exclusions: selectionResult.exclusions,
              }),
      });
    },

    get(id: unknown): BacklogPlan | undefined {
      assertId(id, "plan ID");
      return repository.getById(id);
    },

    listActive(): readonly BacklogPlan[] {
      return repository.listActive();
    },

    async setItemProgress(
      planId: unknown,
      itemId: unknown,
      progress: unknown,
    ): Promise<BacklogPlanItem> {
      assertId(planId, "plan ID");
      assertId(itemId, "plan item ID");
      assertProgress(progress);

      const plan = repository.getById(planId);
      const item = plan?.items.find((candidate) => candidate.id === itemId);
      if (plan === undefined || item === undefined) {
        throw new InputError("The requested plan item does not exist.");
      }
      if (plan.lifecycle !== "active") {
        throw new InputError("Archived plan items cannot be updated.");
      }
      if (!allowedTransitions[item.progress].includes(progress)) {
        throw new InputError("The requested plan-item progress transition is not allowed.");
      }

      const updatedAt = toTimestamp(clock);
      if (!repository.setItemProgress(planId, itemId, progress, updatedAt)) {
        throw new InputError("The requested plan item does not exist.");
      }
      return Object.freeze({ ...item, progress, updatedAt });
    },
  });
}

function createPlan({
  id,
  request,
  createdAt,
  selections,
}: Readonly<{
  id: string;
  request: CreateBacklogPlanRequest;
  createdAt: string;
  selections: Awaited<ReturnType<BacklogSelectionService["select"]>>["selections"];
}>): BacklogPlan {
  return Object.freeze({
    id,
    cadence: request.cadence,
    availableMinutes: request.availableMinutes,
    targetGameCount: request.targetGameCount,
    lifecycle: "active",
    createdAt,
    updatedAt: createdAt,
    archivedAt: null,
    items: Object.freeze(
      selections.map((selection, index) =>
        Object.freeze({
          id: `${id}:${index + 1}`,
          rank: index + 1,
          appId: selection.appId,
          name: selection.name,
          durationEstimateMinutes: selection.estimatedRemainingMinutes,
          explanation: selection.explanation,
          progress: "not_started" as const,
          createdAt,
          updatedAt: createdAt,
        }),
      ),
    ),
  });
}

function createShortfall({
  request,
  selectedGameCount,
  exclusions,
}: Readonly<{
  request: CreateBacklogPlanRequest;
  selectedGameCount: number;
  exclusions: Awaited<ReturnType<BacklogSelectionService["select"]>>["exclusions"];
}>): BacklogPlanShortfall {
  const capacityConstrained = exclusions.some((exclusion) => exclusion.reason === "over_budget");
  return Object.freeze({
    requestedGameCount: request.targetGameCount,
    selectedGameCount,
    message: capacityConstrained
      ? `Selected ${selectedGameCount} of ${request.targetGameCount} games within the ${request.availableMinutes}-minute budget; additional eligible games exceeded the remaining budget.`
      : `Selected ${selectedGameCount} of ${request.targetGameCount} games within the ${request.availableMinutes}-minute budget; no additional eligible games were available.`,
  });
}

function assertCreateRequest(request: unknown): asserts request is CreateBacklogPlanRequest {
  const candidate = request as Partial<CreateBacklogPlanRequest> | null;
  if (
    typeof request !== "object" ||
    request === null ||
    !isCadence(candidate?.cadence) ||
    !isPositiveSafeInteger(candidate?.availableMinutes) ||
    !isPositiveSafeInteger(candidate?.targetGameCount)
  ) {
    throw new InputError(
      "Cadence, available minutes, and target game count must be valid positive values.",
    );
  }
}

function assertId(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 255) {
    throw new InputError(`The ${label} must be a non-empty string up to 255 characters.`);
  }
}

function assertProgress(value: unknown): asserts value is BacklogPlanItemProgress {
  if (!BACKLOG_PLAN_ITEM_PROGRESS.includes(value as BacklogPlanItemProgress)) {
    throw new InputError("Plan-item progress must be not_started, in_progress, done, or skipped.");
  }
}

function isCadence(value: unknown): value is BacklogPlanCadence {
  return BACKLOG_PLAN_CADENCES.includes(value as BacklogPlanCadence);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function toTimestamp(clock: Clock): string {
  return new Date(clock.now()).toISOString();
}
