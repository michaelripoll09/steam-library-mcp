import { createHash } from "node:crypto";

import type Database from "better-sqlite3";

export type Migration = Readonly<{
  version: number;
  name: string;
  checksum: string;
  statements: readonly string[];
}>;

type MigrationDefinition = Omit<Migration, "checksum">;
type AppliedMigration = Readonly<{ version: number; checksum: string }>;

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationError";
  }
}

function checksumFor({ name, statements, version }: MigrationDefinition): string {
  return createHash("sha256").update(JSON.stringify({ name, statements, version })).digest("hex");
}

function createMigration(definition: MigrationDefinition): Migration {
  return Object.freeze({
    ...definition,
    checksum: checksumFor(definition),
    statements: Object.freeze([...definition.statements]),
  });
}

export const MIGRATIONS = Object.freeze([
  createMigration({
    version: 1,
    name: "create-tracker-entries",
    statements: [
      `CREATE TABLE tracker_entries (
        app_id INTEGER PRIMARY KEY,
        status TEXT NOT NULL CHECK (status IN ('backlog', 'playing', 'completed', 'dropped', 'paused')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
    ],
  }),
  createMigration({
    version: 2,
    name: "enforce-one-playing-entry",
    statements: [
      "CREATE UNIQUE INDEX one_playing_entry ON tracker_entries (status) WHERE status = 'playing'",
    ],
  }),
  createMigration({
    version: 3,
    name: "create-recommendation-preferences",
    statements: [
      `CREATE TABLE recommendation_preferences (
        app_id INTEGER PRIMARY KEY,
        priority TEXT NOT NULL CHECK (priority IN ('normal', 'high')),
        excluded_from_recommendations INTEGER NOT NULL CHECK (excluded_from_recommendations IN (0, 1)),
        play_mode TEXT NOT NULL CHECK (play_mode IN ('any', 'solo', 'with_friends'))
      )`,
    ],
  }),
  createMigration({
    version: 4,
    name: "create-game-duration-estimates",
    statements: [
      `CREATE TABLE game_duration_estimates (
        app_id INTEGER PRIMARY KEY,
        igdb_game_id INTEGER NOT NULL,
        igdb_game_name TEXT,
        source TEXT NOT NULL CHECK (source = 'igdb'),
        refreshed_at TEXT NOT NULL,
        hastily_minutes INTEGER CHECK (hastily_minutes IS NULL OR hastily_minutes > 0),
        normally_minutes INTEGER CHECK (normally_minutes IS NULL OR normally_minutes > 0),
        completely_minutes INTEGER CHECK (completely_minutes IS NULL OR completely_minutes > 0),
        CHECK (
          hastily_minutes IS NOT NULL OR
          normally_minutes IS NOT NULL OR
          completely_minutes IS NOT NULL
        )
      )`,
    ],
  }),
  createMigration({
    version: 5,
    name: "create-backlog-plans",
    statements: [
      `CREATE TABLE backlog_plans (
        id TEXT PRIMARY KEY,
        cadence TEXT NOT NULL CHECK (cadence IN ('weekly', 'monthly')),
        available_minutes INTEGER NOT NULL CHECK (available_minutes > 0),
        target_game_count INTEGER NOT NULL CHECK (target_game_count > 0),
        lifecycle TEXT NOT NULL CHECK (lifecycle IN ('active', 'archived')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT
      )`,
      `CREATE TABLE backlog_plan_items (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL REFERENCES backlog_plans(id) ON DELETE CASCADE,
        rank INTEGER NOT NULL CHECK (rank > 0),
        app_id INTEGER NOT NULL CHECK (app_id > 0),
        game_name TEXT NOT NULL,
        duration_estimate_minutes INTEGER CHECK (duration_estimate_minutes IS NULL OR duration_estimate_minutes > 0),
        explanation TEXT NOT NULL,
        progress TEXT NOT NULL CHECK (progress IN ('not_started', 'in_progress', 'done', 'skipped')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (plan_id, rank)
      )`,
      "CREATE UNIQUE INDEX one_active_backlog_plan_per_cadence ON backlog_plans (cadence) WHERE lifecycle = 'active'",
    ],
  }),
  createMigration({
    version: 6,
    name: "create-local-tasks",
    statements: [
      `CREATE TABLE local_tasks (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN ('sync_library', 'enrich_durations', 'recalculate_plan')),
        request_json TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
        progress_completed INTEGER NOT NULL CHECK (progress_completed >= 0),
        progress_total INTEGER CHECK (progress_total IS NULL OR progress_total >= progress_completed),
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        error_code TEXT,
        error_message TEXT,
        cancellation_requested INTEGER NOT NULL DEFAULT 0 CHECK (cancellation_requested IN (0, 1)),
        CHECK (
          (state IN ('queued', 'running') AND completed_at IS NULL) OR
          (state IN ('completed', 'failed', 'cancelled') AND completed_at IS NOT NULL)
        ),
        CHECK (
          (state = 'failed' AND error_code IS NOT NULL AND error_message IS NOT NULL) OR
          (state != 'failed' AND error_code IS NULL AND error_message IS NULL)
        )
      )`,
      "CREATE INDEX local_tasks_polling ON local_tasks (created_at DESC)",
    ],
  }),
  createMigration({
    version: 7,
    name: "create-manual-library-games",
    statements: [
      `CREATE TABLE manual_library_games (
        app_id INTEGER PRIMARY KEY CHECK (app_id > 0),
        name TEXT NOT NULL CHECK (length(trim(name)) > 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
    ],
  }),
  createMigration({
    version: 8,
    name: "add-manual-library-access-state",
    statements: [
      `ALTER TABLE manual_library_games
        ADD COLUMN access_type TEXT NOT NULL DEFAULT 'manual'
        CHECK (access_type IN ('manual', 'family'))`,
      `ALTER TABLE manual_library_games
        ADD COLUMN is_playable INTEGER NOT NULL DEFAULT 0
        CHECK (is_playable IN (0, 1))`,
    ],
  }),
]);

const createMigrationTable = `CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL
)`;

function getAppliedMigrations(database: Database.Database): readonly AppliedMigration[] {
  return database
    .prepare("SELECT version, checksum FROM schema_migrations ORDER BY version")
    .all() as AppliedMigration[];
}

function verifyAppliedMigrations(
  appliedMigrations: readonly AppliedMigration[],
  migrations: readonly Migration[],
): void {
  const expectedByVersion = new Map(migrations.map((migration) => [migration.version, migration]));

  for (const applied of appliedMigrations) {
    const expected = expectedByVersion.get(applied.version);
    if (expected === undefined) {
      throw new MigrationError("Tracker database is newer than this tracker supports.");
    }
    if (applied.checksum !== expected.checksum) {
      throw new MigrationError("Tracker migration checksum does not match the recorded history.");
    }
  }
}

export function migrateDatabase(
  database: Database.Database,
  migrations: readonly Migration[] = MIGRATIONS,
  appliedAt = new Date().toISOString(),
): void {
  database.exec("BEGIN IMMEDIATE");

  try {
    database.exec(createMigrationTable);
    const appliedMigrations = getAppliedMigrations(database);
    verifyAppliedMigrations(appliedMigrations, migrations);
    const appliedVersions = new Set(appliedMigrations.map((migration) => migration.version));
    const recordMigration = database.prepare(
      "INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
    );

    for (const migration of migrations) {
      if (appliedVersions.has(migration.version)) {
        continue;
      }

      for (const statement of migration.statements) {
        database.exec(statement);
      }
      recordMigration.run(migration.version, migration.name, migration.checksum, appliedAt);
    }

    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
