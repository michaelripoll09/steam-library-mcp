import { z } from "zod";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { AppError, InputError, TaskNotFoundError, TrackerPersistenceError } from "../errors.js";
import type { TaskRunner } from "../tasks/task-runner.js";
import type { ToolRegistrar } from "./register-steam-tools.js";

const listSchema = z.object({}).strict();
const taskIdSchema = z.object({ id: z.string().trim().min(1).max(255) }).strict();

type ToolResult = Readonly<{
  content: readonly Readonly<{ type: "text"; text: string }>[];
  isError?: boolean;
}>;

export function registerTaskTools(server: ToolRegistrar, runner: TaskRunner): void {
  register(
    server,
    "task_list",
    "List local background tasks and their current states.",
    listSchema,
    () => ({
      tasks: runner.list(),
    }),
  );
  register(
    server,
    "task_get",
    "Get the current state of one local background task for polling.",
    taskIdSchema,
    ({ id }) => ({ task: getTask(runner, id) }),
  );
  register(
    server,
    "task_cancel",
    "Cancel a queued or running local background task.",
    taskIdSchema,
    ({ id }) => ({ task: cancelTask(runner, id) }),
    false,
  );
}

export function registerTaskResources(
  server: Pick<McpServer, "registerResource">,
  runner: TaskRunner,
): void {
  server.registerResource(
    "local-tasks",
    "steam-library://tasks",
    { description: "Read-only local background task list.", mimeType: "application/json" },
    async () => ({
      contents: [
        {
          uri: "steam-library://tasks",
          mimeType: "application/json",
          text: JSON.stringify({ tasks: runner.list() }),
        },
      ],
    }),
  );
  server.registerResource(
    "local-task",
    new ResourceTemplate("steam-library://tasks/{taskId}", { list: undefined }),
    {
      description: "Read-only local background task state for polling.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const taskId = variables.taskId;
      const task = typeof taskId === "string" ? runner.get(taskId) : undefined;
      const value = task === undefined ? { error: new TaskNotFoundError().toJSON() } : { task };
      return {
        contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(value) }],
      };
    },
  );
}

function getTask(runner: TaskRunner, id: string) {
  const task = runner.get(id);
  if (task === undefined) throw new TaskNotFoundError();
  return task;
}

function cancelTask(runner: TaskRunner, id: string) {
  const task = runner.get(id);
  if (task === undefined) throw new TaskNotFoundError();
  return runner.cancel(id)!;
}

function register<TInput extends object>(
  server: ToolRegistrar,
  name: string,
  description: string,
  schema: z.ZodType<TInput>,
  operation: (input: TInput) => unknown,
  readOnlyHint = true,
): void {
  server.registerTool(
    name,
    { description, inputSchema: schema, annotations: { readOnlyHint } },
    async (input): Promise<ToolResult> => {
      try {
        return {
          content: [{ type: "text", text: JSON.stringify(operation(schema.parse(input))) }],
        };
      } catch (error) {
        const safe =
          error instanceof AppError
            ? error
            : error instanceof z.ZodError
              ? new InputError(error.issues[0]?.message ?? "Tool arguments are invalid.")
              : new TrackerPersistenceError(error);
        return { content: [{ type: "text", text: JSON.stringify(safe) }], isError: true };
      }
    },
  );
}
