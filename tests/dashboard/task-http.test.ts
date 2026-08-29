import { request } from "node:http";

import { afterEach, describe, expect, test, vi } from "vitest";

import { createDashboardHttpServer } from "../../src/dashboard/http/server.js";
import { TaskNotFoundError } from "../../src/errors.js";

const task = {
  id: "task-1",
  type: "sync_library" as const,
  state: "queued" as const,
  progress: { completed: 0, total: null },
  createdAt: "2026-08-29T00:00:00.000Z",
  startedAt: null,
  completedAt: null,
  error: null,
};

function call(port: number, path: string, method = "GET") {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port, path, method }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () =>
        resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }),
      );
    });
    req.on("error", reject);
    req.end();
  });
}

describe("dashboard task HTTP routes", () => {
  let server: ReturnType<typeof createDashboardHttpServer> | undefined;

  afterEach(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
  });

  test("lists, polls, and cancels local tasks without adding a creation route", async () => {
    const service = {
      listTasks: vi.fn(() => [task]),
      getTask: vi.fn((id: string) => ({ ...task, id })),
      cancelTask: vi.fn((id: string) => ({ ...task, id, state: "cancelled" as const })),
    };
    server = createDashboardHttpServer({ dashboardService: service as never });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("not listening");

    expect(JSON.parse((await call(address.port, "/api/tasks")).body)).toEqual([task]);
    expect(JSON.parse((await call(address.port, "/api/tasks/task-1")).body)).toMatchObject({
      id: "task-1",
    });
    expect(
      JSON.parse((await call(address.port, "/api/tasks/task-1/cancel", "POST")).body),
    ).toMatchObject({
      state: "cancelled",
    });
    expect((await call(address.port, "/api/tasks", "POST")).status).toBe(405);
    expect(service.listTasks).toHaveBeenCalledOnce();
    expect(service.getTask).toHaveBeenCalledWith("task-1");
    expect(service.cancelTask).toHaveBeenCalledWith("task-1");
  });

  test("returns a safe not-found response when a polled task no longer exists", async () => {
    const service = {
      listTasks: vi.fn(() => []),
      getTask: vi.fn(() => {
        throw new TaskNotFoundError();
      }),
      cancelTask: vi.fn(),
    };
    server = createDashboardHttpServer({ dashboardService: service as never });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("not listening");

    const response = await call(address.port, "/api/tasks/missing");

    expect(response.status).toBe(404);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "TASK_NOT_FOUND", message: "No local task was found." },
    });
  });
});
