import { z } from "zod";

export const RECENT_GAME_COUNT_DEFAULT = 10;
export const RECENT_GAME_COUNT_MIN = 1;
export const RECENT_GAME_COUNT_MAX = 50;

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
