import { randomUUID } from "node:crypto";

import type { TrackerDatabase } from "../tracker/sqlite/database.js";
import { AppError } from "../errors.js";

export const TASK_TYPES = Object.freeze([
  "sync_library",
  "enrich_durations",
  "recalculate_plan",
] as const);
export const TASK_STATES = Object.freeze([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const);

export type TaskType = (typeof TASK_TYPES)[number];
export type TaskState = (typeof TASK_STATES)[number];

export type SyncLibraryTaskRequest = Readonly<{ type: "sync_library" }>;
export type EnrichDurationsTaskRequest = Readonly<{ type: "enrich_durations" }>;
export type RecalculatePlanTaskRequest = Readonly<{
  type: "recalculate_plan";
  planId: string;
}>;
export type TaskRequest =
  SyncLibraryTaskRequest | EnrichDurationsTaskRequest | RecalculatePlanTaskRequest;

export type LocalTaskError = Readonly<{ code: string; message: string }>;
export type LocalTaskProgress = Readonly<{ completed: number; total: number | null }>;
export type LocalTask = Readonly<{
  id: string;
  type: TaskType;
  state: TaskState;
  progress: LocalTaskProgress;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  error: LocalTaskError | null;
}>;

export type TaskExecutionContext = Readonly<{
  signal: AbortSignal;
  reportProgress(completed: number, total?: number | null): void;
}>;

export type TaskHandlers = Readonly<{
  sync_library(request: SyncLibraryTaskRequest, context: TaskExecutionContext): Promise<void>;
  enrich_durations(
    request: EnrichDurationsTaskRequest,
    context: TaskExecutionContext,
  ): Promise<void>;
  recalculate_plan(
    request: RecalculatePlanTaskRequest,
    context: TaskExecutionContext,
  ): Promise<void>;
}>;

export type TaskRunner = Readonly<{
  enqueue(request: TaskRequest): LocalTask;
  get(id: string): LocalTask | undefined;
  list(): readonly LocalTask[];
  cancel(id: string): LocalTask | undefined;
  start(): void;
}>;

type TaskRow = Readonly<{
  id: string;
  type: TaskType;
  requestJson: string;
  state: TaskState;
  progressCompleted: number;
  progressTotal: number | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  cancellationRequested: 0 | 1;
}>;

type TaskRunnerDependencies = Readonly<{
  database: TrackerDatabase;
  handlers: TaskHandlers;
  now?: () => string;
  createId?: () => string;
  start?: boolean;
}>;

export function createTaskRunner({
  database,
  handlers,
  now = () => new Date().toISOString(),
  createId = randomUUID,
  start = true,
}: TaskRunnerDependencies): TaskRunner {
  const repository = new SqliteTaskRepository(database);
  const controllers = new Map<string, AbortController>();
  let draining = false;

  repository.failInterrupted(now());

  const drain = async (): Promise<void> => {
    if (draining) return;
    draining = true;
    try {
      let task: TaskRow | undefined;
      while ((task = repository.nextQueued()) !== undefined) {
        const queuedTask = task;
        const startedAt = now();
        if (!repository.start(queuedTask.id, startedAt)) continue;
        const controller = new AbortController();
        controllers.set(queuedTask.id, controller);
        try {
          await runTask(handlers, parseRequest(queuedTask.requestJson), {
            signal: controller.signal,
            reportProgress: (completed, total) => {
              validateProgress(completed, total);
              repository.updateProgress(queuedTask.id, completed, total ?? null);
            },
          });
          repository.complete(queuedTask.id, now());
        } catch (error) {
          if (controller.signal.aborted) {
            repository.cancel(queuedTask.id, now());
          } else {
            repository.fail(queuedTask.id, now(), toSafeError(error));
          }
        } finally {
          controllers.delete(queuedTask.id);
        }
      }
    } finally {
      draining = false;
      if (repository.nextQueued() !== undefined) void drain();
    }
  };

  const runner: TaskRunner = Object.freeze({
    enqueue(request) {
      assertTaskRequest(request);
      const id = createId();
      assertTaskId(id);
      const task = repository.insert({ id, request, createdAt: now() });
      if (start) void drain();
      return toTask(task);
    },
    get(id) {
      return repository.get(id) === undefined ? undefined : toTask(repository.get(id)!);
    },
    list() {
      return Object.freeze(repository.list().map(toTask));
    },
    cancel(id) {
      const task = repository.get(id);
      if (task === undefined) return undefined;
      if (isTerminal(task.state)) return toTask(task);
      const cancelled = repository.cancel(id, now());
      controllers.get(id)?.abort();
      return toTask(cancelled);
    },
    start() {
      void drain();
    },
  });

  if (start) runner.start();
  return runner;
}

function runTask(
  handlers: TaskHandlers,
  request: TaskRequest,
  context: TaskExecutionContext,
): Promise<void> {
  switch (request.type) {
    case "sync_library":
      return handlers.sync_library(request, context);
    case "enrich_durations":
      return handlers.enrich_durations(request, context);
    case "recalculate_plan":
      return handlers.recalculate_plan(request, context);
  }
}

class SqliteTaskRepository {
  readonly #database: TrackerDatabase;

  constructor(database: TrackerDatabase) {
    this.#database = database;
  }

  insert({
    id,
    request,
    createdAt,
  }: Readonly<{ id: string; request: TaskRequest; createdAt: string }>): TaskRow {
    this.#database
      .prepare(
        `INSERT INTO local_tasks (
          id, type, request_json, state, progress_completed, progress_total, created_at,
          started_at, completed_at, error_code, error_message, cancellation_requested
        ) VALUES (?, ?, ?, 'queued', 0, NULL, ?, NULL, NULL, NULL, NULL, 0)`,
      )
      .run(id, request.type, JSON.stringify(request), createdAt);
    return this.get(id)!;
  }

  get(id: string): TaskRow | undefined {
    return this.#database
      .prepare(
        `SELECT
          id, type, request_json AS requestJson, state,
          progress_completed AS progressCompleted, progress_total AS progressTotal,
          created_at AS createdAt, started_at AS startedAt, completed_at AS completedAt,
          error_code AS errorCode, error_message AS errorMessage,
          cancellation_requested AS cancellationRequested
        FROM local_tasks WHERE id = ?`,
      )
      .get(id) as TaskRow | undefined;
  }

  list(): readonly TaskRow[] {
    return this.#database
      .prepare(
        `SELECT
          id, type, request_json AS requestJson, state,
          progress_completed AS progressCompleted, progress_total AS progressTotal,
          created_at AS createdAt, started_at AS startedAt, completed_at AS completedAt,
          error_code AS errorCode, error_message AS errorMessage,
          cancellation_requested AS cancellationRequested
        FROM local_tasks ORDER BY created_at DESC, id DESC`,
      )
      .all() as TaskRow[];
  }

  nextQueued(): TaskRow | undefined {
    return this.#database
      .prepare(
        `SELECT
          id, type, request_json AS requestJson, state,
          progress_completed AS progressCompleted, progress_total AS progressTotal,
          created_at AS createdAt, started_at AS startedAt, completed_at AS completedAt,
          error_code AS errorCode, error_message AS errorMessage,
          cancellation_requested AS cancellationRequested
        FROM local_tasks WHERE state = 'queued' ORDER BY created_at, id LIMIT 1`,
      )
      .get() as TaskRow | undefined;
  }

  start(id: string, startedAt: string): boolean {
    return (
      this.#database
        .prepare(
          "UPDATE local_tasks SET state = 'running', started_at = ? WHERE id = ? AND state = 'queued'",
        )
        .run(startedAt, id).changes === 1
    );
  }

  updateProgress(id: string, completed: number, total: number | null): void {
    this.#database
      .prepare(
        `UPDATE local_tasks
         SET progress_completed = ?, progress_total = COALESCE(?, progress_total)
         WHERE id = ? AND state = 'running'`,
      )
      .run(completed, total, id);
  }

  complete(id: string, completedAt: string): void {
    this.#database
      .prepare(
        `UPDATE local_tasks
         SET state = 'completed', completed_at = ?
         WHERE id = ? AND state = 'running'`,
      )
      .run(completedAt, id);
  }

  fail(id: string, completedAt: string, error: LocalTaskError): void {
    this.#database
      .prepare(
        `UPDATE local_tasks
         SET state = 'failed', completed_at = ?, error_code = ?, error_message = ?
         WHERE id = ? AND state = 'running'`,
      )
      .run(completedAt, error.code, error.message, id);
  }

  cancel(id: string, completedAt: string): TaskRow {
    this.#database
      .prepare(
        `UPDATE local_tasks
         SET state = 'cancelled', completed_at = ?, cancellation_requested = 1
         WHERE id = ? AND state IN ('queued', 'running')`,
      )
      .run(completedAt, id);
    return this.get(id)!;
  }

  failInterrupted(completedAt: string): void {
    this.#database
      .prepare(
        `UPDATE local_tasks
         SET state = 'failed', completed_at = ?, error_code = 'TASK_INTERRUPTED',
             error_message = 'Task processing was interrupted. Run the task again.'
         WHERE state = 'running'`,
      )
      .run(completedAt);
  }
}

function toTask(row: TaskRow): LocalTask {
  return Object.freeze({
    id: row.id,
    type: row.type,
    state: row.state,
    progress: Object.freeze({ completed: row.progressCompleted, total: row.progressTotal }),
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    error:
      row.errorCode === null || row.errorMessage === null
        ? null
        : Object.freeze({ code: row.errorCode, message: row.errorMessage }),
  });
}

function parseRequest(serialized: string): TaskRequest {
  const request: unknown = JSON.parse(serialized);
  assertTaskRequest(request);
  return request;
}

function assertTaskRequest(request: unknown): asserts request is TaskRequest {
  if (typeof request !== "object" || request === null || !("type" in request)) {
    throw new TypeError("Task request must identify a supported task type.");
  }
  if (
    (request.type === "sync_library" || request.type === "enrich_durations") &&
    hasExactKeys(request, ["type"])
  ) {
    return;
  }
  if (
    request.type === "recalculate_plan" &&
    hasExactKeys(request, ["type", "planId"]) &&
    "planId" in request &&
    typeof request.planId === "string" &&
    request.planId.trim().length > 0 &&
    request.planId.length <= 255
  ) {
    return;
  }
  throw new TypeError("Task request must identify a supported task type.");
}

function hasExactKeys(value: object, keys: readonly string[]): boolean {
  const ownKeys = Reflect.ownKeys(value);
  return (
    ownKeys.length === keys.length &&
    ownKeys.every((key) => typeof key === "string" && keys.includes(key)) &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function assertTaskId(id: string): void {
  if (id.trim().length === 0 || id.length > 255) {
    throw new TypeError("Task ID must be a non-empty string up to 255 characters.");
  }
}

function validateProgress(completed: number, total: number | null | undefined): void {
  if (!Number.isSafeInteger(completed) || completed < 0) {
    throw new TypeError("Task progress completed value must be a non-negative safe integer.");
  }
  if (
    total !== undefined &&
    total !== null &&
    (!Number.isSafeInteger(total) || total < completed)
  ) {
    throw new TypeError(
      "Task progress total must be a safe integer at least as large as completed.",
    );
  }
}

function toSafeError(error: unknown): LocalTaskError {
  if (error instanceof AppError) {
    return Object.freeze({ code: error.code, message: error.safeMessage });
  }
  return Object.freeze({
    code: "TASK_FAILED",
    message: "Task could not be completed. Try again later.",
  });
}

function isTerminal(state: TaskState): boolean {
  return state === "completed" || state === "failed" || state === "cancelled";
}
