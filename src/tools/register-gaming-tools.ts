import { z } from "zod";

import { AppError, TrackerInputError, TrackerPersistenceError } from "../errors.js";
import type { GamingTrackerService, TrackerMarkStatus } from "../tracker/gaming-tracker-service.js";
import type { ToolRegistrar } from "./register-steam-tools.js";

const emptySchema = z.object({}).strict();
const markSchema = z.object({ appId: z.number().int().safe().positive() }).strict();
type Result = Readonly<{
  content: readonly Readonly<{ type: "text"; text: string }>[];
  isError?: boolean;
}>;

export function registerGamingTools(server: ToolRegistrar, service: GamingTrackerService): void {
  register(
    server,
    "gaming_get_backlog",
    "List accessible games that are untracked, backlogged, or paused.",
    emptySchema,
    () => service.getBacklog(),
    (games) => ({ games }),
  );
  register(
    server,
    "gaming_get_current_game",
    "Get the accessible game currently marked as playing.",
    emptySchema,
    () => service.getCurrentGame(),
    (game) => ({ game }),
  );
  registerMark(
    server,
    "gaming_mark_playing",
    "Mark an accessible game as currently playing.",
    service,
    "playing",
  );
  registerMark(
    server,
    "gaming_mark_paused",
    "Mark an accessible game as paused.",
    service,
    "paused",
  );
  registerMark(
    server,
    "gaming_mark_completed",
    "Mark an accessible game as completed.",
    service,
    "completed",
  );
  registerMark(
    server,
    "gaming_mark_dropped",
    "Mark an accessible game as dropped.",
    service,
    "dropped",
  );
  register(
    server,
    "gaming_get_completed",
    "List accessible games marked as completed.",
    emptySchema,
    () => service.getCompleted(),
    (games) => ({ games }),
  );
}

function registerMark(
  server: ToolRegistrar,
  name: string,
  description: string,
  service: GamingTrackerService,
  status: TrackerMarkStatus,
): void {
  register<{ appId: number }, Awaited<ReturnType<GamingTrackerService["mark"]>>>(
    server,
    name,
    description,
    markSchema,
    ({ appId }) => service.mark(appId, status),
    (value) => value,
  );
}

function register<TInput extends object, TValue>(
  server: ToolRegistrar,
  name: string,
  description: string,
  schema: z.ZodObject<z.ZodRawShape>,
  operation: (input: TInput) => Promise<TValue>,
  envelope: (value: TValue) => unknown,
): void {
  server.registerTool(
    name,
    { description, inputSchema: schema },
    async (input): Promise<Result> => {
      try {
        const parsed = schema.parse(input) as TInput;
        return {
          content: [{ type: "text", text: JSON.stringify(envelope(await operation(parsed))) }],
        };
      } catch (error) {
        const safe =
          error instanceof AppError
            ? error
            : error instanceof z.ZodError
              ? new TrackerInputError()
              : new TrackerPersistenceError(error);
        return {
          content: [{ type: "text", text: JSON.stringify({ error: safe }) }],
          isError: true,
        };
      }
    },
  );
}
