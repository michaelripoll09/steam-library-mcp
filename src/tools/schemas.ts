import { z } from "zod";

export const RECENT_GAME_COUNT_DEFAULT = 10;
export const RECENT_GAME_COUNT_MIN = 1;
export const RECENT_GAME_COUNT_MAX = 50;
export const METADATA_QUERY_LIMIT_DEFAULT = 50;
export const METADATA_QUERY_LIMIT_MIN = 1;
export const METADATA_QUERY_LIMIT_MAX = 50;

export const emptyInputSchema = z.object({}).strict();

export const searchLibraryInputSchema = z
  .object({
    query: z.string().trim().min(1, "Search query must not be blank."),
  })
  .strict();

export const steamGameInputSchema = z
  .object({
    appId: z.number().int().positive("App ID must be a positive integer."),
  })
  .strict();

export const metadataQueryInputSchema = z
  .object({
    genres: z.array(z.string().trim().min(1)).min(1).optional(),
    tags: z.array(z.string().trim().min(1)).min(1).optional(),
    themes: z.array(z.string().trim().min(1)).min(1).optional(),
    releaseYearFrom: z.number().int().optional(),
    releaseYearTo: z.number().int().optional(),
    limit: z
      .number()
      .int("Metadata query limit must be an integer.")
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
      .min(RECENT_GAME_COUNT_MIN)
      .max(RECENT_GAME_COUNT_MAX)
      .default(RECENT_GAME_COUNT_DEFAULT),
  })
  .strict();
