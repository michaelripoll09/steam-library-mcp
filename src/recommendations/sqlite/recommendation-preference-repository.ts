import type Database from "better-sqlite3";

import type {
  GameRecommendationPreference,
  PlayMode,
  RecommendationPreferenceRepository,
  RecommendationPriority,
} from "../../domain/recommendation-preferences.js";

type RecommendationPreferenceRow = Readonly<{
  appId: number;
  priority: RecommendationPriority;
  excludedFromRecommendations: 0 | 1;
  playMode: PlayMode;
}>;

export class SqliteRecommendationPreferenceRepository implements RecommendationPreferenceRepository {
  readonly #database: Database.Database;

  constructor(database: Database.Database) {
    this.#database = database;
  }

  get(appId: number): GameRecommendationPreference | undefined {
    const row = this.#database
      .prepare(
        `SELECT
          app_id AS appId,
          priority,
          excluded_from_recommendations AS excludedFromRecommendations,
          play_mode AS playMode
        FROM recommendation_preferences
        WHERE app_id = ?`,
      )
      .get(appId) as RecommendationPreferenceRow | undefined;

    return row === undefined
      ? undefined
      : Object.freeze({
          appId: row.appId,
          priority: row.priority,
          excludedFromRecommendations: row.excludedFromRecommendations === 1,
          playMode: row.playMode,
        });
  }

  save(preference: GameRecommendationPreference): void {
    this.#database
      .prepare(
        `INSERT INTO recommendation_preferences (
          app_id,
          priority,
          excluded_from_recommendations,
          play_mode
        ) VALUES (?, ?, ?, ?)
        ON CONFLICT(app_id) DO UPDATE SET
          priority = excluded.priority,
          excluded_from_recommendations = excluded.excluded_from_recommendations,
          play_mode = excluded.play_mode`,
      )
      .run(
        preference.appId,
        preference.priority,
        preference.excludedFromRecommendations ? 1 : 0,
        preference.playMode,
      );
  }

  remove(appId: number): void {
    this.#database.prepare("DELETE FROM recommendation_preferences WHERE app_id = ?").run(appId);
  }
}
