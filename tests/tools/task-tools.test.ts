import { describe, expect, test, vi } from "vitest";

import { registerTaskResources, registerTaskTools } from "../../src/tools/register-task-tools.js";
import type { TaskRunner } from "../../src/tasks/task-runner.js";
import type { ToolRegistrar } from "../../src/tools/register-steam-tools.js";

function setup() {
  const handlers = new Map<
    string,
    (
      input: unknown,
    ) => Promise<{ content: readonly { type: "text"; text: string }[]; isError?: boolean }>
  >();
  const runner: TaskRunner = {
    enqueue: vi.fn(),
    get: vi.fn((id: string) => (id === "task-1" ? task : undefined)),
    list: vi.fn(() => [task]),
    cancel: vi.fn((id: string) =>
      id === "task-1" ? { ...task, state: "cancelled" as const } : undefined,
    ),
    start: vi.fn(),
  };
  const registrar: ToolRegistrar = {
    registerTool(name, _configuration, handler) {
      handlers.set(name, handler);
    },
  };
  registerTaskTools(registrar, runner);
  return { handlers, runner };
}

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

describe("task MCP tools", () => {
  test("exposes list, poll, and cancel operations without task creation", async () => {
    const { handlers, runner } = setup();

    expect([...handlers.keys()]).toEqual(["task_list", "task_get", "task_cancel"]);
    await expect(handlers.get("task_list")?.({})).resolves.toMatchObject({
      content: [{ text: JSON.stringify({ tasks: [task] }) }],
    });
    await expect(handlers.get("task_get")?.({ id: "task-1" })).resolves.toMatchObject({
      content: [{ text: JSON.stringify({ task }) }],
    });
    await expect(handlers.get("task_cancel")?.({ id: "task-1" })).resolves.toMatchObject({
      content: [{ text: expect.stringContaining('"state":"cancelled"') }],
    });

    expect(runner.list).toHaveBeenCalledOnce();
    expect(runner.get).toHaveBeenCalledWith("task-1");
    expect(runner.cancel).toHaveBeenCalledWith("task-1");
    expect(runner.enqueue).not.toHaveBeenCalled();
  });

  test("rejects malformed and unknown task IDs without cancelling", async () => {
    const { handlers, runner } = setup();

    await expect(handlers.get("task_get")?.({ id: " " })).resolves.toMatchObject({ isError: true });
    await expect(handlers.get("task_cancel")?.({ id: "missing" })).resolves.toMatchObject({
      isError: true,
      content: [{ text: expect.stringContaining("TASK_NOT_FOUND") }],
    });
    await expect(handlers.get("task_get")?.({ id: "t".repeat(256) })).resolves.toMatchObject({
      isError: true,
    });

    expect(runner.cancel).not.toHaveBeenCalled();
  });

  test("bounds dynamic task resource IDs to safe not-found responses", async () => {
    const { runner } = setup();
    const resources = new Map<string, (...args: never[]) => Promise<never>>();
    registerTaskResources(
      {
        registerResource: vi.fn(
          (name: string, _target: unknown, _config: unknown, handler: unknown) => {
            resources.set(name, handler as (...args: never[]) => Promise<never>);
          },
        ),
      } as never,
      runner,
    );
    const read = resources.get("local-task") as unknown as (
      uri: { href: string },
      variables: Record<string, unknown>,
    ) => Promise<{ contents: readonly { text: string }[] }>;
    const readText = async (taskId: unknown) => {
      const result = await read({ href: `steam-library://tasks/${String(taskId)}` }, { taskId });
      return result.contents[0]?.text ?? "";
    };

    expect(await readText("task-1")).toContain('"id":"task-1"');
    expect(await readText("missing")).toContain("TASK_NOT_FOUND");
    expect(await readText("")).toContain("TASK_NOT_FOUND");
    expect(await readText("t".repeat(10_000))).toContain("TASK_NOT_FOUND");
    const pathological = await readText("t".repeat(10_000));
    expect(pathological).not.toMatch(/secret|token|stack|sql/i);
    expect(runner.get).not.toHaveBeenCalledWith("t".repeat(10_000));
  });
});
