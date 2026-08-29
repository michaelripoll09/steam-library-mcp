import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "vitest";

import {
  MIGRATIONS,
  MigrationError,
  migrateDatabase,
} from "../../../src/tracker/sqlite/migrations.js";
import { openTrackerDatabase } from "../../../src/tracker/sqlite/database.js";

describe("tracker SQLite migrations", () => {
  test("opens a tracker database with the current schema", () => {
    const database = openTrackerDatabase(":memory:");

    expect(database.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get()).toEqual({
      count: MIGRATIONS.length,
    });

    database.close();
  });

  test("migrates an older database once and leaves it unchanged on restart", () => {
    const directory = mkdtempSync(join(tmpdir(), "steam-library-tracker-"));
    const databasePath = join(directory, "tracker.sqlite");
    const firstDatabase = openTrackerDatabase(databasePath);
    const firstApplied = firstDatabase
      .prepare("SELECT version, name, checksum FROM schema_migrations ORDER BY version")
      .all();
    firstDatabase.close();

    const restartedDatabase = openTrackerDatabase(databasePath);
    const secondApplied = restartedDatabase
      .prepare("SELECT version, name, checksum FROM schema_migrations ORDER BY version")
      .all();

    try {
      expect(firstApplied).toEqual(
        MIGRATIONS.map(({ checksum, name, version }) => ({ checksum, name, version })),
      );
      expect(secondApplied).toEqual(firstApplied);
      expect(
        restartedDatabase
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tracker_entries'",
          )
          .get(),
      ).toEqual({ name: "tracker_entries" });
    } finally {
      restartedDatabase.close();
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("adds recommendation preferences to an existing version-two tracker database", () => {
    const database = new Database(":memory:");

    try {
      migrateDatabase(database, MIGRATIONS.slice(0, 2));
      migrateDatabase(database);

      expect(
        database
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'recommendation_preferences'",
          )
          .get(),
      ).toEqual({ name: "recommendation_preferences" });
      expect(
        database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get(),
      ).toEqual({
        version: MIGRATIONS.at(-1)?.version,
      });
    } finally {
      database.close();
    }
  });

  test("adds local game-duration estimates to existing tracker storage", () => {
    const database = new Database(":memory:");

    try {
      migrateDatabase(database, MIGRATIONS.slice(0, 3));
      migrateDatabase(database);

      expect(
        database
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'game_duration_estimates'",
          )
          .get(),
      ).toEqual({ name: "game_duration_estimates" });
      expect(
        database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get(),
      ).toEqual({ version: MIGRATIONS.at(-1)?.version });
    } finally {
      database.close();
    }
  });

  test("adds durable backlog plans and items to existing version-four tracker storage", () => {
    const database = new Database(":memory:");

    try {
      migrateDatabase(database, MIGRATIONS.slice(0, 4));
      migrateDatabase(database);

      expect(
        database
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'backlog_plans'")
          .get(),
      ).toEqual({ name: "backlog_plans" });
      expect(
        database
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'backlog_plan_items'",
          )
          .get(),
      ).toEqual({ name: "backlog_plan_items" });
      expect(
        database
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'one_active_backlog_plan_per_cadence'",
          )
          .get(),
      ).toEqual({ name: "one_active_backlog_plan_per_cadence" });
    } finally {
      database.close();
    }
  });

  test("adds durable local tasks for polling and cancellation to existing tracker storage", () => {
    const database = new Database(":memory:");

    try {
      migrateDatabase(database, MIGRATIONS.slice(0, 5));
      migrateDatabase(database);

      expect(
        database
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'local_tasks'")
          .get(),
      ).toEqual({ name: "local_tasks" });
      expect(
        database
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'local_tasks_polling'",
          )
          .get(),
      ).toEqual({ name: "local_tasks_polling" });
    } finally {
      database.close();
    }
  });

  test("rejects an edited migration history without applying pending migrations", () => {
    const database = new Database(":memory:");
    migrateDatabase(database);
    database.prepare("UPDATE schema_migrations SET checksum = ? WHERE version = 1").run("edited");

    expect(() => migrateDatabase(database)).toThrow(MigrationError);
    expect(() => migrateDatabase(database)).toThrow("checksum does not match");
    expect(database.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get()).toEqual({
      count: MIGRATIONS.length,
    });
  });

  test("rejects a database newer than the supported migration history", () => {
    const database = new Database(":memory:");
    migrateDatabase(database);
    database
      .prepare(
        "INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
      )
      .run(999, "future", "future-checksum", "2026-08-25T00:00:00.000Z");

    expect(() => migrateDatabase(database)).toThrow(MigrationError);
    expect(() => migrateDatabase(database)).toThrow("newer than this tracker supports");
  });

  test("rolls back every schema change when a migration fails", () => {
    const database = new Database(":memory:");
    const brokenMigrations = [
      {
        version: 1,
        name: "create-temporary-table",
        checksum: "first",
        statements: ["CREATE TABLE temporary_migration_data (id INTEGER PRIMARY KEY)"],
      },
      {
        version: 2,
        name: "invalid-statement",
        checksum: "second",
        statements: ["THIS IS NOT SQLITE"],
      },
    ] as const;

    expect(() => migrateDatabase(database, brokenMigrations)).toThrow();
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'temporary_migration_data'",
        )
        .get(),
    ).toBeUndefined();
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
        )
        .get(),
    ).toBeUndefined();
  });
});
