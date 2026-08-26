import { describe, expect, test } from "vitest";

import type { GameStatus, TrackerWriter } from "../../../src/domain/tracker.js";
import { openTrackerDatabase } from "../../../src/tracker/sqlite/database.js";
import { SqliteTrackerRepository } from "../../../src/tracker/sqlite/tracker-repository.js";

const firstTimestamp = "2026-08-25T01:00:00.000Z";
const laterTimestamp = "2026-08-25T02:00:00.000Z";

function createRepository() {
  const database = openTrackerDatabase(":memory:");
  return { database, repository: new SqliteTrackerRepository(database) };
}

describe("SQLite tracker repository", () => {
  test("binds status values and reports unchanged repeated writes", () => {
    const { database, repository } = createRepository();

    try {
      expect(
        repository.transaction((writer) => writer.setStatus(620, "completed", firstTimestamp)),
      ).toBe(true);
      expect(
        repository.transaction((writer) => writer.setStatus(620, "completed", laterTimestamp)),
      ).toBe(false);
      expect(() =>
        repository.transaction((writer) =>
          writer.setStatus(
            621,
            "completed'); DROP TABLE tracker_entries; --" as GameStatus,
            laterTimestamp,
          ),
        ),
      ).toThrow();
      expect(repository.list()).toEqual([
        {
          appId: 620,
          status: "completed",
          createdAt: firstTimestamp,
          updatedAt: firstTimestamp,
        },
      ]);
    } finally {
      database.close();
    }
  });

  test("enforces one playing entry with the partial unique index", () => {
    const { database, repository } = createRepository();

    try {
      repository.transaction((writer) => writer.setStatus(10, "playing", firstTimestamp));

      expect(() =>
        database
          .prepare(
            "INSERT INTO tracker_entries (app_id, status, created_at, updated_at) VALUES (?, ?, ?, ?)",
          )
          .run(20, "playing", firstTimestamp, firstTimestamp),
      ).toThrow();
      expect(
        database
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'one_playing_entry'",
          )
          .get(),
      ).toEqual({ name: "one_playing_entry" });
    } finally {
      database.close();
    }
  });

  test("orders entries by latest update then app ID", () => {
    const { database, repository } = createRepository();

    try {
      repository.transaction((writer) => {
        writer.setStatus(40, "completed", firstTimestamp);
        writer.setStatus(20, "dropped", laterTimestamp);
        writer.setStatus(30, "backlog", firstTimestamp);
      });

      expect(repository.list().map((entry) => entry.appId)).toEqual([20, 30, 40]);
    } finally {
      database.close();
    }
  });

  test("rolls back all writer changes when the transaction callback fails", () => {
    const { database, repository } = createRepository();

    try {
      expect(() =>
        repository.transaction((writer) => {
          writer.setStatus(10, "playing", firstTimestamp);
          writer.setStatus(20, "completed", laterTimestamp);
          throw new Error("abort tracker update");
        }),
      ).toThrow("abort tracker update");

      expect(repository.list()).toEqual([]);
    } finally {
      database.close();
    }
  });

  test("does not allow a writer to mutate storage after its transaction closes", () => {
    const { database, repository } = createRepository();
    let leakedWriter: TrackerWriter | undefined;

    try {
      repository.transaction((writer) => {
        leakedWriter = writer;
        writer.setStatus(10, "completed", firstTimestamp);
      });

      expect(() => leakedWriter?.setStatus(20, "completed", laterTimestamp)).toThrow(
        "Tracker writer can only be used inside its transaction.",
      );
      expect(repository.list().map((entry) => entry.appId)).toEqual([10]);
    } finally {
      database.close();
    }
  });
});
