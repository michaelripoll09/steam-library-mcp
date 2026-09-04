import type Database from "better-sqlite3";

import { InputError, SteamResponseError, SteamUnavailableError } from "../errors.js";

export type ManualLibraryAccessType = "family" | "manual";

export type ManualLibraryGame = Readonly<{
  appId: number;
  name: string;
  accessType: ManualLibraryAccessType;
  isPlayable: boolean;
  createdAt: string;
  updatedAt: string;
}>;

type ManualLibraryGameInput = Readonly<
  Omit<ManualLibraryGame, "accessType" | "isPlayable"> &
    Partial<Pick<ManualLibraryGame, "accessType" | "isPlayable">>
>;

type ManualLibraryGameRow = Readonly<{
  appId: number;
  name: string;
  accessType: ManualLibraryAccessType;
  isPlayable: 0 | 1;
  createdAt: string;
  updatedAt: string;
}>;

export interface ManualLibraryRepository {
  list(): readonly ManualLibraryGame[];
  upsert(game: ManualLibraryGameInput): ManualLibraryGame;
  remove(appId: number): boolean;
}

function mapManualLibraryGame(row: ManualLibraryGameRow): ManualLibraryGame {
  return Object.freeze({
    appId: row.appId,
    name: row.name,
    accessType: row.accessType,
    isPlayable: row.isPlayable === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export class SqliteManualLibraryRepository implements ManualLibraryRepository {
  constructor(private readonly database: Database.Database) {}
  list(): readonly ManualLibraryGame[] {
    const rows = this.database
      .prepare(
        "SELECT app_id as appId, name, access_type as accessType, is_playable as isPlayable, created_at as createdAt, updated_at as updatedAt FROM manual_library_games ORDER BY name COLLATE NOCASE, app_id",
      )
      .all() as ManualLibraryGameRow[];
    return rows.map(mapManualLibraryGame);
  }
  upsert(game: ManualLibraryGameInput): ManualLibraryGame {
    this.database
      .prepare(
        `INSERT INTO manual_library_games (app_id, name, access_type, is_playable, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(app_id) DO UPDATE SET name = excluded.name, access_type = excluded.access_type, is_playable = excluded.is_playable, updated_at = excluded.updated_at`,
      )
      .run(
        game.appId,
        game.name,
        game.accessType ?? "manual",
        game.isPlayable === true ? 1 : 0,
        game.createdAt,
        game.updatedAt,
      );
    const row = this.database
      .prepare(
        "SELECT app_id as appId, name, access_type as accessType, is_playable as isPlayable, created_at as createdAt, updated_at as updatedAt FROM manual_library_games WHERE app_id = ?",
      )
      .get(game.appId) as ManualLibraryGameRow;
    return mapManualLibraryGame(row);
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
