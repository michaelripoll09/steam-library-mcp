import type Database from "better-sqlite3";

import { InputError, SteamResponseError, SteamUnavailableError } from "../errors.js";

export type ManualLibraryGame = Readonly<{
  appId: number;
  name: string;
  createdAt: string;
  updatedAt: string;
}>;

export interface ManualLibraryRepository {
  list(): readonly ManualLibraryGame[];
  upsert(game: ManualLibraryGame): ManualLibraryGame;
  remove(appId: number): boolean;
}

export class SqliteManualLibraryRepository implements ManualLibraryRepository {
  constructor(private readonly database: Database.Database) {}
  list(): readonly ManualLibraryGame[] {
    return this.database
      .prepare(
        "SELECT app_id as appId, name, created_at as createdAt, updated_at as updatedAt FROM manual_library_games ORDER BY name COLLATE NOCASE, app_id",
      )
      .all() as ManualLibraryGame[];
  }
  upsert(game: ManualLibraryGame): ManualLibraryGame {
    this.database
      .prepare(
        `INSERT INTO manual_library_games (app_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(app_id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`,
      )
      .run(game.appId, game.name, game.createdAt, game.updatedAt);
    return this.database
      .prepare(
        "SELECT app_id as appId, name, created_at as createdAt, updated_at as updatedAt FROM manual_library_games WHERE app_id = ?",
      )
      .get(game.appId) as ManualLibraryGame;
  }
  remove(appId: number): boolean {
    return (
      this.database.prepare("DELETE FROM manual_library_games WHERE app_id = ?").run(appId)
        .changes > 0
    );
  }
}

export function parseManualSteamInput(value: unknown): number {
  if (typeof value !== "string")
    throw new InputError("Provide a positive Steam app ID or a Steam store app URL.");
  const input = value.trim();
  if (/^[1-9]\d*$/.test(input)) return validateAppId(Number(input));
  const match =
    /^https:\/\/store\.steampowered\.com\/app\/([1-9]\d*)(?:\/[^?#]*)?(?:\?[^#]*)?(?:#.*)?$/.exec(
      input,
    );
  if (match === null)
    throw new InputError("Provide a positive Steam app ID or a Steam store app URL.");
  return validateAppId(Number(match[1]));
}

function validateAppId(appId: number): number {
  if (!Number.isSafeInteger(appId) || appId <= 0)
    throw new InputError("Provide a positive Steam app ID or a Steam store app URL.");
  return appId;
}

export type PublicSteamGameLookup = (
  appId: number,
) => Promise<Readonly<{ appId: number; name: string }>>;

export function createPublicSteamGameLookup(
  fetchLike: typeof fetch = globalThis.fetch,
): PublicSteamGameLookup {
  return async (appId) => {
    let response: Response;
    try {
      response = await fetchLike(
        `https://store.steampowered.com/api/appdetails?appids=${appId}&l=english`,
      );
    } catch (error) {
      throw new SteamUnavailableError(error);
    }
    if (!response.ok) throw new SteamUnavailableError();
    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      throw new SteamResponseError(error);
    }
    const entry =
      body !== null && typeof body === "object"
        ? (body as Record<string, unknown>)[String(appId)]
        : undefined;
    if (
      entry === null ||
      typeof entry !== "object" ||
      (entry as { success?: unknown }).success !== true
    )
      throw new InputError("That Steam app is not publicly available.");
    const name = (entry as { data?: { name?: unknown } }).data?.name;
    if (typeof name !== "string" || name.trim() === "")
      throw new InputError("That Steam app is not publicly available.");
    return Object.freeze({ appId, name: name.trim() });
  };
}
