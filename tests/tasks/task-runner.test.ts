import { describe, expect, test } from "vitest";

import { createTaskRunner } from "../../src/tasks/task-runner.js";
import { openTrackerDatabase } from "../../src/tracker/sqlite/database.js";

describe("task runner", () => {
  test("persists a queued sync task and exposes its pollable state", () => {
    const database = openTrackerDatabase(":memory:");
    const runner = createTaskRunner({
      database,
      handlers: {
        sync_library: async () => undefined,
        enrich_durations: async () => undefined,
        recalculate_plan: async () => undefined,
      },
      start: false,
      now: () => "2026-08-28T12:00:00.000Z",
      createId: () => "task-1",
    });

    try {
      const task = runner.enqueue({ type: "sync_library" });

      expect(task).toEqual({
        id: "task-1",
        type: "sync_library",
        state: "queued",
        progress: { completed: 0, total: null },
        createdAt: "2026-08-28T12:00:00.000Z",
        startedAt: null,
        completedAt: null,
        error: null,
      });
      expect(runner.get("task-1")).toEqual(task);
    } finally {
      database.close();
    }
  });

  test.each([
    { type: "sync_library", unexpected: true },
    { type: "enrich_durations", unexpected: true },
    { type: "recalculate_plan", planId: "weekly-plan", unexpected: true },
  ])("rejects unknown keys in a $type task payload before persistence", (request) => {
    const database = openTrackerDatabase(":memory:");
    const runner = createTaskRunner({
      database,
      handlers: {
        sync_library: async () => undefined,
        enrich_durations: async () => undefined,
        recalculate_plan: async () => undefined,
      },
      start: false,
    });

    try {
      expect(() =>
        runner.enqueue(request as unknown as Parameters<typeof runner.enqueue>[0]),
      ).toThrow("Task request must identify a supported task type.");
      expect(runner.list()).toEqual([]);
    } finally {
      database.close();
    }
  });

  test("runs queued work, reports progress, and persists completion timestamps", async () => {
    const database = openTrackerDatabase(":memory:");
    const started = deferred<void>();
    const release = deferred<void>();
    const runner = createTaskRunner({
      database,
      handlers: {
        sync_library: async (_request, context) => {
          context.reportProgress(1, 3);
          started.resolve();
          await release.promise;
          context.reportProgress(3);
        },
        enrich_durations: async () => undefined,
        recalculate_plan: async () => undefined,
      },
      now: (() => {
        const timestamps = [
          "2026-08-28T12:00:00.000Z",
          "2026-08-28T12:00:01.000Z",
          "2026-08-28T12:00:02.000Z",
          "2026-08-28T12:00:03.000Z",
        ];
        return () => timestamps.shift() ?? "2026-08-28T12:00:03.000Z";
      })(),
      createId: () => "task-2",
    });

    try {
      runner.enqueue({ type: "sync_library" });
      await started.promise;

      expect(runner.get("task-2")).toMatchObject({
        state: "running",
        progress: { completed: 1, total: 3 },
        startedAt: "2026-08-28T12:00:02.000Z",
        completedAt: null,
      });

      release.resolve();
      await waitForTask(runner, "task-2", "completed");

      expect(runner.get("task-2")).toMatchObject({
        state: "completed",
        progress: { completed: 3, total: 3 },
        completedAt: "2026-08-28T12:00:03.000Z",
        error: null,
      });
    } finally {
      database.close();
    }
  });

  test("persists cancellation, aborts running work, and never exposes the cause", async () => {
    const database = openTrackerDatabase(":memory:");
    const started = deferred<void>();
    const runner = createTaskRunner({
      database,
      handlers: {
        sync_library: async (_request, context) => {
          started.resolve();
          await new Promise<void>((_resolve, reject) => {
            context.signal.addEventListener(
              "abort",
              () => reject(new Error("private upstream URL")),
              {
                once: true,
              },
            );
          });
        },
        enrich_durations: async () => undefined,
        recalculate_plan: async () => undefined,
      },
      createId: () => "task-3",
    });

    try {
      runner.enqueue({ type: "sync_library" });
      await started.promise;

      expect(runner.cancel("task-3")).toMatchObject({
        state: "cancelled",
        error: null,
      });
      await waitForTask(runner, "task-3", "cancelled");

      expect(
        database
          .prepare(
            "SELECT state, cancellation_requested, error_message FROM local_tasks WHERE id = ?",
          )
          .get("task-3"),
      ).toEqual({ state: "cancelled", cancellation_requested: 1, error_message: null });
    } finally {
      database.close();
    }
  });

  test("stores only a safe failure envelope when work throws an unexpected error", async () => {
    const database = openTrackerDatabase(":memory:");
    const runner = createTaskRunner({
      database,
      handlers: {
        sync_library: async () => {
          throw new Error("https://internal.example.test/token=secret");
        },
        enrich_durations: async () => undefined,
        recalculate_plan: async () => undefined,
      },
      createId: () => "task-4",
    });

    try {
      runner.enqueue({ type: "sync_library" });
      await waitForTask(runner, "task-4", "failed");

      expect(runner.get("task-4")).toMatchObject({
        state: "failed",
        error: {
          code: "TASK_FAILED",
          message: "Task could not be completed. Try again later.",
        },
      });
    } finally {
      database.close();
    }
  });

  test("keeps a queued cancellation terminal without starting the task", async () => {
    const database = openTrackerDatabase(":memory:");
    const runner = createTaskRunner({
      database,
      handlers: {
        sync_library: async () => undefined,
        enrich_durations: async () => undefined,
        recalculate_plan: async () => undefined,
      },
      start: false,
      createId: () => "task-5",
    });

    try {
      runner.enqueue({ type: "enrich_durations" });
      runner.cancel("task-5");
      runner.start();
      await waitForTask(runner, "task-5", "cancelled");

      expect(runner.get("task-5")).toMatchObject({
        state: "cancelled",
        completedAt: expect.any(String),
      });
    } finally {
      database.close();
    }
  });

  test("marks an interrupted in-process task as a safe failure on restart", () => {
    const database = openTrackerDatabase(":memory:");
    const firstRunner = createTaskRunner({
      database,
      handlers: {
        sync_library: async () => undefined,
        enrich_durations: async () => undefined,
        recalculate_plan: async () => undefined,
      },
      start: false,
      createId: () => "task-6",
    });

    try {
      firstRunner.enqueue({ type: "sync_library" });
      database
        .prepare("UPDATE local_tasks SET state = 'running', started_at = ? WHERE id = ?")
        .run("2026-08-28T12:00:00.000Z", "task-6");

      const restartedRunner = createTaskRunner({
        database,
        handlers: {
          sync_library: async () => undefined,
          enrich_durations: async () => undefined,
          recalculate_plan: async () => undefined,
        },
        start: false,
        now: () => "2026-08-28T12:01:00.000Z",
      });

      expect(restartedRunner.get("task-6")).toMatchObject({
        state: "failed",
        completedAt: "2026-08-28T12:01:00.000Z",
        error: {
          code: "TASK_INTERRUPTED",
          message: "Task processing was interrupted. Run the task again.",
        },
      });
    } finally {
      database.close();
    }
  });

  test("dispatches a persisted plan recalculation request to its matching handler", async () => {
    const database = openTrackerDatabase(":memory:");
    const recalculatedPlanIds: string[] = [];
    const runner = createTaskRunner({
      database,
      handlers: {
        sync_library: async () => undefined,
        enrich_durations: async () => undefined,
        recalculate_plan: async (request) => {
          recalculatedPlanIds.push(request.planId);
        },
      },
      createId: () => "task-7",
    });

    try {
      runner.enqueue({ type: "recalculate_plan", planId: "weekly-plan" });
      await waitForTask(runner, "task-7", "completed");

      expect(recalculatedPlanIds).toEqual(["weekly-plan"]);
      expect(
        database.prepare("SELECT type, request_json FROM local_tasks WHERE id = ?").get("task-7"),
      ).toEqual({
        type: "recalculate_plan",
        request_json: '{"type":"recalculate_plan","planId":"weekly-plan"}',
      });
    } finally {
      database.close();
    }
  });
});

async function waitForTask(
  runner: ReturnType<typeof createTaskRunner>,
  id: string,
  state: "completed" | "cancelled" | "failed",
): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (runner.get(id)?.state === state) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Task ${id} did not reach ${state}.`);
}

function deferred<T>(): Readonly<{
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
  reject(reason?: unknown): void;
}> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
