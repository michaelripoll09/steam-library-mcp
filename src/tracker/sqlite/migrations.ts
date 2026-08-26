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
