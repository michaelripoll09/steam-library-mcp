import { z } from "zod";

const namedMetadataSchema = z.object({ name: z.string().trim().min(1) });

export const twitchTokenSchema = z.object({
  access_token: z.string().trim().min(1),
  token_type: z.string().trim().min(1),
  expires_in: z.number().positive(),
});

export const igdbGamesResponseSchema = z.array(
  z.object({
    id: z.number().int().positive(),
    external_games: z.array(
      z.object({ category: z.number().int().optional(), uid: z.string().trim().min(1) }),
    ),
    genres: z.array(namedMetadataSchema).optional(),
    keywords: z.array(namedMetadataSchema).optional(),
    themes: z.array(namedMetadataSchema).optional(),
    first_release_date: z.number().int().nonnegative().optional(),
  }),
);

export type IgdbGame = z.infer<typeof igdbGamesResponseSchema>[number];
