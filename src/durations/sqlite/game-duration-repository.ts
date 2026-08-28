import type Database from "better-sqlite3";

import type { GameDurationEstimate, GameDurationRepository } from "../../domain/game-duration.js";

type DurationRow = Readonly<{
  appId: number;
  igdbGameId: number;
  igdbGameName: string | null;
  source: "igdb";
  refreshedAt: string;
  hastilyMinutes: number | null;
  normallyMinutes: number | null;
  completelyMinutes: number | null;
}>;

const toDuration = (minutes: number | null) =>
  minutes === null ? undefined : Object.freeze({ minutes, hours: minutes / 60 });

export class SqliteGameDurationRepository implements GameDurationRepository {
  readonly #database: Database.Database;

  constructor(database: Database.Database) {
    this.#database = database;
  }

  get(appId: number): GameDurationEstimate | undefined {
    const row = this.#database
      .prepare(
        `SELECT
          app_id AS appId,
          igdb_game_id AS igdbGameId,
          igdb_game_name AS igdbGameName,
          source,
          refreshed_at AS refreshedAt,
          hastily_minutes AS hastilyMinutes,
          normally_minutes AS normallyMinutes,
          completely_minutes AS completelyMinutes
        FROM game_duration_estimates
        WHERE app_id = ?`,
      )
      .get(appId) as DurationRow | undefined;

    if (row === undefined) {
      return undefined;
    }

    const hastily = toDuration(row.hastilyMinutes);
    const normally = toDuration(row.normallyMinutes);
    const completely = toDuration(row.completelyMinutes);
    return Object.freeze({
      appId: row.appId,
      igdbGameId: row.igdbGameId,
      ...(row.igdbGameName === null ? {} : { igdbGameName: row.igdbGameName }),
      source: row.source,
      refreshedAt: row.refreshedAt,
      ...(hastily === undefined ? {} : { hastily }),
      ...(normally === undefined ? {} : { normally }),
      ...(completely === undefined ? {} : { completely }),
    });
  }

  save(estimate: GameDurationEstimate): void {
    this.#database
      .prepare(
        `INSERT INTO game_duration_estimates (
          app_id, igdb_game_id, igdb_game_name, source, refreshed_at,
          hastily_minutes, normally_minutes, completely_minutes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(app_id) DO UPDATE SET
          igdb_game_id = excluded.igdb_game_id,
          igdb_game_name = excluded.igdb_game_name,
          source = excluded.source,
          refreshed_at = excluded.refreshed_at,
          hastily_minutes = excluded.hastily_minutes,
          normally_minutes = excluded.normally_minutes,
          completely_minutes = excluded.completely_minutes`,
      )
      .run(
        estimate.appId,
        estimate.igdbGameId,
        estimate.igdbGameName ?? null,
        estimate.source,
        estimate.refreshedAt,
        estimate.hastily?.minutes ?? null,
        estimate.normally?.minutes ?? null,
        estimate.completely?.minutes ?? null,
      );
  }
}
