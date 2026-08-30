import { z } from "zod";

import type { SteamService } from "../services/steam-service.js";
import { AppError, InputError, SteamUnavailableError } from "../errors.js";
import {
  emptyInputSchema,
  manualCollectionAddInputSchema,
  manualCollectionRemoveInputSchema,
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
  inputSchema: z.ZodRawShape | z.ZodType;
  annotations?: Readonly<{ readOnlyHint?: boolean }>;
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
      description:
        "Get the configured user's normalized Steam library, including their persistent manual collection.",
      inputSchema: emptyInputSchema.shape,
    },
    createHandler(emptyInputSchema, () => service.getLibrary()),
  );
  server.registerTool(
    "steam_search_library",
    {
      description: "Search the configured user's Steam library by game name.",
      inputSchema: searchLibraryInputSchema.shape,
    },
    createHandler(searchLibraryInputSchema, ({ query }) => service.searchLibrary(query)),
  );
  server.registerTool(
    "steam_get_game",
    {
      description: "Get one normalized Steam game by app ID.",
      inputSchema: steamGameInputSchema.shape,
    },
    createHandler(steamGameInputSchema, ({ appId }) => service.getGame(appId)),
  );
  server.registerTool(
    "steam_get_recent_games",
    {
      description:
        "Get the configured user's recently played Steam games, ordered by confirmed last-played date descending when Steam provides it.",
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
  server.registerTool(
    "steam_get_manual_collection",
    {
      description: "List the persistent manual Steam collection.",
      inputSchema: emptyInputSchema.shape,
      annotations: { readOnlyHint: true },
    },
    createHandler(emptyInputSchema, async () => manualCollection(service).getManualCollection()),
  );
  server.registerTool(
    "steam_add_manual_collection",
    {
      description: "Look up and add a public Steam game to the persistent manual collection.",
      inputSchema: manualCollectionAddInputSchema.shape,
    },
    createHandler(manualCollectionAddInputSchema, async ({ steam }) =>
      manualCollection(service).addManualCollection(steam),
    ),
  );
  server.registerTool(
    "steam_remove_manual_collection",
    {
      description: "Remove a game from the persistent manual Steam collection by app ID.",
      inputSchema: manualCollectionRemoveInputSchema.shape,
    },
    createHandler(manualCollectionRemoveInputSchema, async ({ appId }) =>
      manualCollection(service).removeManualCollection(appId),
    ),
  );
}

function manualCollection(
  service: SteamService,
): Required<
  Pick<SteamService, "getManualCollection" | "addManualCollection" | "removeManualCollection">
> {
  if (
    service.getManualCollection === undefined ||
    service.addManualCollection === undefined ||
    service.removeManualCollection === undefined
  ) {
    throw new InputError("Manual collections are unavailable.");
  }
  return {
    getManualCollection: service.getManualCollection,
    addManualCollection: service.addManualCollection,
    removeManualCollection: service.removeManualCollection,
  };
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
