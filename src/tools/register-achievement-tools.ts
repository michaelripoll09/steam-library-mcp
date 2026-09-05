import { z } from "zod";

import { AppError, InputError, SteamUnavailableError } from "../errors.js";
import type { AchievementService } from "../services/achievement-service.js";
import type { ToolRegistrar } from "./register-steam-tools.js";
import { steamGameInputSchema } from "./schemas.js";

type ToolResult = Readonly<{
  content: readonly Readonly<{ type: "text"; text: string }>[];
  isError?: boolean;
}>;

export function registerAchievementTools(server: ToolRegistrar, service: AchievementService): void {
  server.registerTool(
    "steam_get_game_achievements",
    {
      description:
        "Get on-demand achievement progress for one playable game in the configured Steam library.",
      inputSchema: steamGameInputSchema.shape,
      annotations: { readOnlyHint: true },
    },
    async (input) => {
      try {
        const { appId } = steamGameInputSchema.parse(input);
        return textResult(await service.getGameAchievements(appId));
      } catch (error) {
        return errorResult(toSafeError(error));
      }
    },
  );
}

function textResult(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

function errorResult(error: AppError): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(error) }], isError: true };
}

function toSafeError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof z.ZodError) {
    return new InputError(error.issues[0]?.message ?? "Tool arguments are invalid.");
  }
  return new SteamUnavailableError(error);
}
