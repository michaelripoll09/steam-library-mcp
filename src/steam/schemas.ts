import { z } from "zod";

const steamGameSchema = z.object({
  appid: z.number().int().nonnegative(),
  name: z.string().trim().min(1),
  playtime_forever: z.number().int().nonnegative().optional().default(0),
  playtime_2weeks: z.number().int().nonnegative().optional(),
  rtime_last_played: z.number().int().nonnegative().optional(),
  img_logo_url: z.string().trim().min(1).optional(),
});

const steamResponseSchema = z.object({
  response: z.object({
    game_count: z.number().int().nonnegative().optional(),
    total_count: z.number().int().nonnegative().optional(),
    games: z.array(steamGameSchema).optional().default([]),
  }),
});

const playerAchievementSchema = z.object({
  apiname: z.string().min(1),
  achieved: z.number().int().min(0).max(1),
  unlocktime: z.number().int().nonnegative().optional(),
});

const playerAchievementsSchema = z.object({
  steamID: z.string().min(1).optional(),
  gameName: z.string().min(1).optional(),
  success: z.boolean(),
  achievements: z.array(playerAchievementSchema).optional().default([]),
});

const gameAchievementSchema = z.object({
  name: z.string().min(1),
  defaultvalue: z.number().optional(),
  displayName: z.string().optional(),
  hidden: z.number().int().optional(),
  description: z.string().optional(),
  icon: z.string().url().optional(),
  icongray: z.string().url().optional(),
});

export const ownedGamesResponseSchema = steamResponseSchema;
export const recentGamesResponseSchema = steamResponseSchema;
export const playerAchievementsResponseSchema = z.object({
  playerstats: playerAchievementsSchema,
});
export const gameSchemaResponseSchema = z.object({
  game: z.object({
    gameName: z.string().min(1),
    availableGameStats: z.object({
      achievements: z.array(gameAchievementSchema).optional().default([]),
    }),
  }),
});

export type SteamOwnedGamesResponse = z.infer<typeof ownedGamesResponseSchema>;
export type SteamRecentGamesResponse = z.infer<typeof recentGamesResponseSchema>;
export type SteamPlayerAchievementsResponse = z.infer<typeof playerAchievementsResponseSchema>;
export type SteamGameSchemaResponse = z.infer<typeof gameSchemaResponseSchema>;
export type SteamGameDto = z.infer<typeof steamGameSchema>;
