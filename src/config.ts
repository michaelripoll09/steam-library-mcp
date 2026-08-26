import { z } from "zod";

import { ConfigError } from "./errors.js";

export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
export const DEFAULT_LIBRARY_CACHE_TTL_MS = 300_000;
export const DEFAULT_TRACKER_DATABASE_PATH = ".steam-library/tracker.sqlite";

export type AppConfig = Readonly<{
  steamApiKey: string;
  steamId: string;
  requestTimeoutMs: typeof DEFAULT_REQUEST_TIMEOUT_MS;
  libraryCacheTtlMs: typeof DEFAULT_LIBRARY_CACHE_TTL_MS;
  trackerDatabasePath: string;
}>;

export type IgdbCredentials = Readonly<{
  clientId: string;
  clientSecret: string;
}>;

export type IgdbConfig =
  Readonly<{ enabled: false }> | Readonly<{ enabled: true } & IgdbCredentials>;

type Environment = Readonly<Record<string, string | undefined>>;

const requiredSettingNames = ["STEAM_API_KEY", "STEAM_ID"] as const;
type RequiredSettingName = (typeof requiredSettingNames)[number];

const environmentSchema = z.object({
  STEAM_API_KEY: z.string().trim().min(1),
  STEAM_ID: z.string().trim().min(1),
  TRACKER_DATABASE_PATH: z.string().trim().min(1).optional(),
});

const igdbEnvironmentSchema = z.object({
  IGDB_CLIENT_ID: z.string().trim().min(1).optional(),
  IGDB_CLIENT_SECRET: z.string().trim().min(1).optional(),
});

export function loadIgdbConfig(environment: Environment = process.env): IgdbConfig {
  const parsedEnvironment = igdbEnvironmentSchema.safeParse({
    IGDB_CLIENT_ID: environment.IGDB_CLIENT_ID,
    IGDB_CLIENT_SECRET: environment.IGDB_CLIENT_SECRET,
  });

  if (!parsedEnvironment.success) {
    return Object.freeze({ enabled: false });
  }

  const { IGDB_CLIENT_ID: clientId, IGDB_CLIENT_SECRET: clientSecret } = parsedEnvironment.data;
  if (clientId === undefined || clientSecret === undefined) {
    return Object.freeze({ enabled: false });
  }

  return Object.freeze({ enabled: true, clientId, clientSecret });
}

export function loadConfig(environment: Environment = process.env): AppConfig {
  const parsedEnvironment = environmentSchema.safeParse({
    STEAM_API_KEY: environment.STEAM_API_KEY,
    STEAM_ID: environment.STEAM_ID,
    TRACKER_DATABASE_PATH: environment.TRACKER_DATABASE_PATH,
  });

  if (!parsedEnvironment.success) {
    const setting = parsedEnvironment.error.issues[0]?.path[0];
    throw new ConfigError(
      requiredSettingNames.includes(setting as RequiredSettingName)
        ? (setting as RequiredSettingName)
        : "STEAM_API_KEY",
    );
  }

  return Object.freeze({
    steamApiKey: parsedEnvironment.data.STEAM_API_KEY,
    steamId: parsedEnvironment.data.STEAM_ID,
    requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
    libraryCacheTtlMs: DEFAULT_LIBRARY_CACHE_TTL_MS,
    trackerDatabasePath:
      parsedEnvironment.data.TRACKER_DATABASE_PATH ?? DEFAULT_TRACKER_DATABASE_PATH,
  });
}
