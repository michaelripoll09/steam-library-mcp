import { z } from "zod";

import {
  MANUAL_STEAM_INPUT_MAX_LENGTH,
  MCP_IDENTIFIER_MAX_LENGTH,
  METADATA_FILTER_ARRAY_MAX_ITEMS,
  METADATA_FILTER_ITEM_MAX_LENGTH,
  SEARCH_QUERY_MAX_LENGTH,
} from "../domain/input-limits.js";

export const RECENT_GAME_COUNT_DEFAULT = 10;
export const RECENT_GAME_COUNT_MIN = 1;
export const RECENT_GAME_COUNT_MAX = 50;
export const METADATA_QUERY_LIMIT_DEFAULT = 50;
export const METADATA_QUERY_LIMIT_MIN = 1;
export const METADATA_QUERY_LIMIT_MAX = 50;

export const emptyInputSchema = z.object({}).strict();

export const searchLibraryInputSchema = z
  .object({
    query: z
      .string()
      .trim()
      .min(1, "Search query must not be blank.")
      .max(SEARCH_QUERY_MAX_LENGTH, "Search query is too long."),
  })
  .strict();

export const appIdSchema = z.number().int().safe().positive("App ID must be a positive integer.");

export const steamGameInputSchema = z
  .object({
    appId: appIdSchema,
  })
  .strict();

export const manualLibraryAccessTypeSchema = z.enum(["manual", "family"]);

export const manualCollectionAddInputSchema = z
  .object({
    steam: z
      .string()
      .trim()
      .min(1, "Steam app ID or store URL must not be blank.")
      .max(MANUAL_STEAM_INPUT_MAX_LENGTH, "Steam app ID or store URL is too long."),
    accessType: manualLibraryAccessTypeSchema.optional(),
    isPlayable: z.boolean().optional(),
  })
  .strict();

export const manualCollectionUpdateInputSchema = z
  .object({
    appId: appIdSchema,
    accessType: manualLibraryAccessTypeSchema.optional(),
    isPlayable: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) => value.accessType !== undefined || value.isPlayable !== undefined,
    "At least one access field must be provided.",
  );

export const manualCollectionRemoveInputSchema = steamGameInputSchema;

const metadataFilterItemSchema = z.string().trim().min(1).max(METADATA_FILTER_ITEM_MAX_LENGTH);

const metadataFilterArraySchema = z
  .array(metadataFilterItemSchema)
  .min(1)
  .max(METADATA_FILTER_ARRAY_MAX_ITEMS);

export const metadataQueryInputSchema = z
  .object({
    genres: metadataFilterArraySchema.optional(),
    tags: metadataFilterArraySchema.optional(),
    themes: metadataFilterArraySchema.optional(),
    releaseYearFrom: z.number().int().safe().optional(),
    releaseYearTo: z.number().int().safe().optional(),
    limit: z
      .number()
      .int("Metadata query limit must be an integer.")
      .safe()
      .min(METADATA_QUERY_LIMIT_MIN)
      .max(METADATA_QUERY_LIMIT_MAX)
      .default(METADATA_QUERY_LIMIT_DEFAULT),
  })
  .strict()
  .refine(
    (value) =>
      value.genres || value.tags || value.themes || value.releaseYearFrom || value.releaseYearTo,
    "At least one metadata filter is required.",
  )
  .refine(
    (value) =>
      value.releaseYearFrom === undefined ||
      value.releaseYearTo === undefined ||
      value.releaseYearFrom <= value.releaseYearTo,
    "Release year range is invalid.",
  );

export const recentGamesInputSchema = z
  .object({
    count: z
      .number()
      .int("Recent game count must be an integer.")
      .safe()
      .min(RECENT_GAME_COUNT_MIN)
      .max(RECENT_GAME_COUNT_MAX)
      .default(RECENT_GAME_COUNT_DEFAULT),
  })
  .strict();

export const taskIdentifierSchema = z.string().trim().min(1).max(MCP_IDENTIFIER_MAX_LENGTH);
