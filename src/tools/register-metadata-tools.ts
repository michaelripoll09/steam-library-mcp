import { z } from "zod";
import type { MetadataService } from "../services/metadata-service.js";
import { InputError, SteamUnavailableError, type AppError } from "../errors.js";
import { steamGameInputSchema, metadataQueryInputSchema } from "./schemas.js";
import type { ToolRegistrar } from "./register-steam-tools.js";

type Result = Readonly<{
  content: readonly Readonly<{ type: "text"; text: string }>[];
  isError?: boolean;
}>;
const safe = (error: unknown): AppError =>
  error instanceof Error && "toJSON" in error
    ? (error as AppError)
    : error instanceof z.ZodError
      ? new InputError(error.issues[0]?.message ?? "Tool arguments are invalid.")
      : new SteamUnavailableError(error);
const handler =
  <T>(schema: z.ZodType<T>, operation: (input: T) => Promise<unknown>) =>
  async (input: unknown): Promise<Result> => {
    try {
      return {
        content: [{ type: "text", text: JSON.stringify(await operation(schema.parse(input))) }],
      };
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: JSON.stringify(safe(error)) }] };
    }
  };

export function registerMetadataTools(server: ToolRegistrar, service: MetadataService): void {
  server.registerTool(
    "steam_get_game_metadata",
    {
      description: "Get normalized metadata for one owned Steam game.",
      inputSchema: steamGameInputSchema.shape,
    },
    handler(steamGameInputSchema, ({ appId }) => service.getOwnedGameMetadata(appId)),
  );
  server.registerTool(
    "steam_query_library_metadata",
    {
      description: "Query normalized metadata for owned Steam games.",
      inputSchema: metadataQueryInputSchema.shape,
    },
    handler(metadataQueryInputSchema, (query) => service.queryOwnedMetadata(query)),
  );
}
