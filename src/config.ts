import { z } from "zod";

import { ConfigError } from "./errors.js";

export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
export const DEFAULT_LIBRARY_CACHE_TTL_MS = 300_000;

export type AppConfig = Readonly<{
  steamApiKey: string;
  steamId: string;
  requestTimeoutMs: typeof DEFAULT_REQUEST_TIMEOUT_MS;
  libraryCacheTtlMs: typeof DEFAULT_LIBRARY_CACHE_TTL_MS;
}>;

type Environment = Readonly<Record<string, string | undefined>>;

const requiredSettingNames = ["STEAM_API_KEY", "STEAM_ID"] as const;
type RequiredSettingName = (typeof requiredSettingNames)[number];

const environmentSchema = z.object({
  STEAM_API_KEY: z.string().trim().min(1),
  STEAM_ID: z.string().trim().min(1),
});

export function loadConfig(environment: Environment = process.env): AppConfig {
  const parsedEnvironment = environmentSchema.safeParse({
    STEAM_API_KEY: environment.STEAM_API_KEY,
    STEAM_ID: environment.STEAM_ID,
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
  });
}
