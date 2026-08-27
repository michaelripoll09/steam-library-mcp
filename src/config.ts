import { z } from "zod";

import { ConfigError } from "./errors.js";

export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
export const DEFAULT_LIBRARY_CACHE_TTL_MS = 300_000;
export const DEFAULT_TRACKER_DATABASE_PATH = ".steam-library/tracker.sqlite";
export const DEFAULT_DASHBOARD_PORT = 4173;

export type AppConfig = Readonly<{
  steamApiKey: string;
  steamId: string;
  steamWebApiToken?: string;
  steamGridDbApiKey?: string;
  requestTimeoutMs: typeof DEFAULT_REQUEST_TIMEOUT_MS;
  libraryCacheTtlMs: typeof DEFAULT_LIBRARY_CACHE_TTL_MS;
  trackerDatabasePath: string;
  dashboardPort: number;
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
  STEAM_WEBAPI_TOKEN: z.string().trim().min(1).optional(),
  STEAMGRIDDB_API_KEY: z.string().trim().min(1).optional(),
  TRACKER_DATABASE_PATH: z.string().trim().min(1).optional(),
  DASHBOARD_PORT: z
    .string()
    .trim()
    .regex(/^\d+$/)
    .transform(Number)
    .refine((port) => port >= 1 && port <= 65_535)
    .optional(),
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
    STEAM_WEBAPI_TOKEN: environment.STEAM_WEBAPI_TOKEN,
    STEAMGRIDDB_API_KEY: environment.STEAMGRIDDB_API_KEY,
    TRACKER_DATABASE_PATH: environment.TRACKER_DATABASE_PATH,
    DASHBOARD_PORT: environment.DASHBOARD_PORT,
  });

  if (!parsedEnvironment.success) {
    const setting =
      parsedEnvironment.error.issues[0]?.path[0] ??
      (environment.DASHBOARD_PORT === undefined ? undefined : "DASHBOARD_PORT");
    throw new ConfigError(
      requiredSettingNames.includes(setting as RequiredSettingName)
        ? (setting as RequiredSettingName)
        : setting === "DASHBOARD_PORT"
          ? "DASHBOARD_PORT"
          : "STEAM_API_KEY",
    );
  }

  return Object.freeze({
    steamApiKey: parsedEnvironment.data.STEAM_API_KEY,
    steamId: parsedEnvironment.data.STEAM_ID,
    ...(parsedEnvironment.data.STEAM_WEBAPI_TOKEN === undefined
      ? {}
      : { steamWebApiToken: parsedEnvironment.data.STEAM_WEBAPI_TOKEN }),
    ...(parsedEnvironment.data.STEAMGRIDDB_API_KEY === undefined
      ? {}
      : { steamGridDbApiKey: parsedEnvironment.data.STEAMGRIDDB_API_KEY }),
    requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
    libraryCacheTtlMs: DEFAULT_LIBRARY_CACHE_TTL_MS,
    trackerDatabasePath:
      parsedEnvironment.data.TRACKER_DATABASE_PATH ?? DEFAULT_TRACKER_DATABASE_PATH,
    dashboardPort: parsedEnvironment.data.DASHBOARD_PORT ?? DEFAULT_DASHBOARD_PORT,
  });
}
