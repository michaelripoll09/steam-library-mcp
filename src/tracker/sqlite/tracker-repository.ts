import type Database from "better-sqlite3";

import type {
  GameStatus,
  TrackerEntry,
  TrackerRepository,
  TrackerWriter,
} from "../../domain/tracker.js";

type TrackerEntryRow = Readonly<{
  appId: number;
  status: GameStatus;
  createdAt: string;
  updatedAt: string;
}>;

const writerOutsideTransactionMessage = "Tracker writer can only be used inside its transaction.";

export class SqliteTrackerRepository implements TrackerRepository {
  readonly #database: Database.Database;

  constructor(database: Database.Database) {
    this.#database = database;
  }

  list(): readonly TrackerEntry[] {
    const rows = this.#database
      .prepare(
        `SELECT
          app_id AS appId,
          status,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM tracker_entries
        ORDER BY updated_at DESC, app_id ASC`,
      )
      .all() as TrackerEntryRow[];

    return Object.freeze(rows.map((row) => Object.freeze({ ...row })));
  }

  transaction<T>(work: (writer: TrackerWriter) => T): T {
    let isActive = true;
    const writer = this.createWriter(() => isActive);

    this.#database.exec("BEGIN IMMEDIATE");

    try {
      const result = work(writer);
      this.#database.exec("COMMIT");
      return result;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    } finally {
      isActive = false;
    }
  }

  private createWriter(isActive: () => boolean): TrackerWriter {
    const pauseCurrent = this.#database.prepare(
      "UPDATE tracker_entries SET status = 'paused', updated_at = ? WHERE status = 'playing' AND app_id != ?",
    );
    const setStatus = this.#database.prepare(
      `INSERT INTO tracker_entries (app_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(app_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at
       WHERE tracker_entries.status != excluded.status`,
    );
    const assertActive = () => {
      if (!isActive()) {
        throw new Error(writerOutsideTransactionMessage);
      }
    };

    return Object.freeze({
      pauseCurrent: (exceptAppId: number, at: string) => {
        assertActive();
        pauseCurrent.run(at, exceptAppId);
      },
      setStatus: (appId: number, status: GameStatus, at: string) => {
        assertActive();
        return setStatus.run(appId, status, at, at).changes === 1;
      },
    });
  }
}
