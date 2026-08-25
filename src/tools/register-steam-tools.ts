import { z } from "zod";

import type { SteamService } from "../services/steam-service.js";
import { AppError, InputError, SteamUnavailableError } from "../errors.js";
import {
  emptyInputSchema,
  recentGamesInputSchema,
  searchLibraryInputSchema,
  steamGameInputSchema,
} from "./schemas.js";

type ToolResult = Readonly<{
  content: readonly Readonly<{ type: "text"; text: string }>[];
  isError?: boolean;
}>;

type ToolConfiguration = Readonly<{
  description: string;
  inputSchema: z.ZodRawShape;
}>;

export interface ToolRegistrar {
  registerTool(
    name: string,
    configuration: ToolConfiguration,
    handler: (input: unknown) => Promise<ToolResult>,
  ): void;
}

export function registerSteamTools(server: ToolRegistrar, service: SteamService): void {
  server.registerTool(
    "steam_get_library",
    {
      description: "Get the configured user's normalized Steam library.",
      inputSchema: emptyInputSchema.shape,
    },
    createHandler(emptyInputSchema, () => service.getLibrary()),
  );
  server.registerTool(
    "steam_search_library",
    {
      description: "Search the configured user's normalized Steam library by game name.",
      inputSchema: searchLibraryInputSchema.shape,
    },
    createHandler(searchLibraryInputSchema, ({ query }) => service.searchLibrary(query)),
  );
  server.registerTool(
    "steam_get_game",
    {
      description: "Get one normalized owned Steam game by app ID.",
      inputSchema: steamGameInputSchema.shape,
    },
    createHandler(steamGameInputSchema, ({ appId }) => service.getGame(appId)),
  );
  server.registerTool(
    "steam_get_recent_games",
    {
      description: "Get the configured user's recently played Steam games.",
      inputSchema: recentGamesInputSchema.shape,
    },
    createHandler(recentGamesInputSchema, ({ count }) => service.getRecentGames(count)),
  );
  server.registerTool(
    "steam_get_library_stats",
    {
      description: "Get aggregate statistics for the configured user's Steam library.",
      inputSchema: emptyInputSchema.shape,
    },
    createHandler(emptyInputSchema, () => service.getLibraryStats()),
  );
}

function createHandler<TInput>(
  schema: z.ZodType<TInput>,
  operation: (input: TInput) => Promise<unknown>,
): (input: unknown) => Promise<ToolResult> {
  return async (input) => {
    try {
      const parsedInput = schema.parse(input);
      return textResult(await operation(parsedInput));
    } catch (error) {
      return errorResult(toSafeError(error));
    }
  };
}

function textResult(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

function errorResult(error: AppError): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(error) }], isError: true };
}

function toSafeError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }
  if (error instanceof z.ZodError) {
    return new InputError(error.issues[0]?.message ?? "Tool arguments are invalid.");
  }
  return new SteamUnavailableError(error);
}
