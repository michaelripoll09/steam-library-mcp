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

export const ownedGamesResponseSchema = steamResponseSchema;
export const recentGamesResponseSchema = steamResponseSchema;

export type SteamOwnedGamesResponse = z.infer<typeof ownedGamesResponseSchema>;
export type SteamRecentGamesResponse = z.infer<typeof recentGamesResponseSchema>;
export type SteamGameDto = z.infer<typeof steamGameSchema>;
