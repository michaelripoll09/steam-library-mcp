import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import Database from "better-sqlite3";

import { migrateDatabase } from "./migrations.js";

export type TrackerDatabase = Database.Database;

export function openTrackerDatabase(databasePath: string): TrackerDatabase {
  if (databasePath !== ":memory:") {
    mkdirSync(dirname(databasePath), { recursive: true });
  }

  const database = new Database(databasePath);

  try {
    database.pragma("foreign_keys = ON");
    migrateDatabase(database);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}
