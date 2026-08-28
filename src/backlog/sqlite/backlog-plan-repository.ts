import type Database from "better-sqlite3";

import type {
  BacklogPlan,
  BacklogPlanCadence,
  BacklogPlanItem,
  BacklogPlanItemProgress,
  BacklogPlanLifecycle,
} from "../../domain/backlog-plan.js";
import type { BacklogPlanRepository } from "../backlog-plan-service.js";

type BacklogPlanRow = Readonly<{
  id: string;
  cadence: BacklogPlanCadence;
  availableMinutes: number;
  targetGameCount: number;
  lifecycle: BacklogPlanLifecycle;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}>;

type BacklogPlanItemRow = Readonly<{
  id: string;
  rank: number;
  appId: number;
  name: string;
  durationEstimateMinutes: number | null;
  explanation: string;
  progress: BacklogPlanItemProgress;
  createdAt: string;
  updatedAt: string;
}>;

export class SqliteBacklogPlanRepository implements BacklogPlanRepository {
  readonly #database: Database.Database;

  constructor(database: Database.Database) {
    this.#database = database;
  }

  replaceActive(plan: BacklogPlan): void {
    const archiveActive = this.#database.prepare(
      `UPDATE backlog_plans
       SET lifecycle = 'archived', archived_at = ?, updated_at = ?
       WHERE cadence = ? AND lifecycle = 'active'`,
    );
    const insertPlan = this.#database.prepare(
      `INSERT INTO backlog_plans (
        id, cadence, available_minutes, target_game_count, lifecycle, created_at, updated_at, archived_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertItem = this.#database.prepare(
      `INSERT INTO backlog_plan_items (
        id, plan_id, rank, app_id, game_name, duration_estimate_minutes, explanation, progress, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    this.#database.exec("BEGIN IMMEDIATE");
    try {
      archiveActive.run(plan.createdAt, plan.createdAt, plan.cadence);
      insertPlan.run(
        plan.id,
        plan.cadence,
        plan.availableMinutes,
        plan.targetGameCount,
        plan.lifecycle,
        plan.createdAt,
        plan.updatedAt,
        plan.archivedAt,
      );
      for (const item of plan.items) {
        insertItem.run(
          item.id,
          plan.id,
          item.rank,
          item.appId,
          item.name,
          item.durationEstimateMinutes,
          item.explanation,
          item.progress,
          item.createdAt,
          item.updatedAt,
        );
      }
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  getById(id: string): BacklogPlan | undefined {
    const row = this.#database
      .prepare(
        `SELECT
          id,
          cadence,
          available_minutes AS availableMinutes,
          target_game_count AS targetGameCount,
          lifecycle,
          created_at AS createdAt,
          updated_at AS updatedAt,
          archived_at AS archivedAt
        FROM backlog_plans
        WHERE id = ?`,
      )
      .get(id) as BacklogPlanRow | undefined;

    return row === undefined ? undefined : this.toPlan(row);
  }

  listActive(): readonly BacklogPlan[] {
    const rows = this.#database
      .prepare(
        `SELECT
          id,
          cadence,
          available_minutes AS availableMinutes,
          target_game_count AS targetGameCount,
          lifecycle,
          created_at AS createdAt,
          updated_at AS updatedAt,
          archived_at AS archivedAt
        FROM backlog_plans
        WHERE lifecycle = 'active'
        ORDER BY cadence ASC`,
      )
      .all() as BacklogPlanRow[];
    return Object.freeze(rows.map((row) => this.toPlan(row)));
  }

  setItemProgress(
    planId: string,
    itemId: string,
    progress: BacklogPlanItemProgress,
    updatedAt: string,
  ): boolean {
    return (
      this.#database
        .prepare(
          `UPDATE backlog_plan_items
           SET progress = ?, updated_at = ?
           WHERE id = ? AND plan_id = ?
             AND EXISTS (
               SELECT 1
               FROM backlog_plans
               WHERE backlog_plans.id = backlog_plan_items.plan_id
                 AND backlog_plans.lifecycle = 'active'
             )`,
        )
        .run(progress, updatedAt, itemId, planId).changes === 1
    );
  }

  private toPlan(row: BacklogPlanRow): BacklogPlan {
    const itemRows = this.#database
      .prepare(
        `SELECT
          id,
          rank,
          app_id AS appId,
          game_name AS name,
          duration_estimate_minutes AS durationEstimateMinutes,
          explanation,
          progress,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM backlog_plan_items
        WHERE plan_id = ?
        ORDER BY rank ASC`,
      )
      .all(row.id) as BacklogPlanItemRow[];

    return Object.freeze({
      ...row,
      items: Object.freeze(itemRows.map((item) => Object.freeze({ ...item }) as BacklogPlanItem)),
    });
  }
}
