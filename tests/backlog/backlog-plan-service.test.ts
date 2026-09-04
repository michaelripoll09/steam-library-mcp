import { describe, expect, test, vi } from "vitest";

import type { Clock } from "../../src/cache/ttl-cache.js";
import type { PlayNowRecommendationService } from "../../src/recommendations/play-now-recommendation-service.js";
import { InputError } from "../../src/errors.js";
import {
  createBacklogPlanService,
  type BacklogPlanRepository,
} from "../../src/backlog/backlog-plan-service.js";
import { SqliteBacklogPlanRepository } from "../../src/backlog/sqlite/backlog-plan-repository.js";
import { openTrackerDatabase } from "../../src/tracker/sqlite/database.js";

const now = "2026-08-28T12:00:00.000Z";
const clock: Clock = { now: () => Date.parse(now) };

function recommendation(appId: number, name: string, durationEstimateMinutes: number | null) {
  return {
    appId,
    name,
    durationEstimateMinutes,
    estimatedRemainingMinutes: durationEstimateMinutes,
    reasons: [],
    explanation: `Recommendation for ${name}.`,
  } as const;
}

function createRecommendationService(
  recommendations = [recommendation(620, "Portal 2", 480), recommendation(730, "CS2", null)],
): Pick<PlayNowRecommendationService, "recommend"> {
  return {
    recommend: vi.fn(async () => ({
      request: { availableMinutes: 120, maxResults: 2, sessionMode: "solo" as const },
      recommendations,
      exclusions: [],
    })),
  };
}

function createRepository(): BacklogPlanRepository {
  return {
    replaceActive: vi.fn(),
    getById: vi.fn(),
    listActive: vi.fn(() => []),
    setItemProgress: vi.fn(() => true),
  };
}

describe("BacklogPlanService", () => {
  test("snapshots selected play-now recommendations in rank order", async () => {
    const recommendations = createRecommendationService();
    const repository = createRepository();
    const service = createBacklogPlanService({
      clock,
      createId: () => "weekly-1",
      recommendationService: recommendations,
      repository,
    });

    const result = await service.create({
      cadence: "weekly",
      availableMinutes: 120,
      targetGameCount: 2,
    });

    expect(recommendations.recommend).toHaveBeenCalledWith({
      availableMinutes: 120,
      maxResults: 2,
      sessionMode: "solo",
    });
    expect(result.plan).toMatchObject({
      id: "weekly-1",
      cadence: "weekly",
      availableMinutes: 120,
      targetGameCount: 2,
      lifecycle: "active",
      createdAt: now,
      updatedAt: now,
      items: [
        {
          id: "weekly-1:1",
          rank: 1,
          appId: 620,
          name: "Portal 2",
          durationEstimateMinutes: 480,
          explanation: "Recommendation for Portal 2.",
          progress: "not_started",
        },
        {
          id: "weekly-1:2",
          rank: 2,
          appId: 730,
          name: "CS2",
          durationEstimateMinutes: null,
          explanation: "Recommendation for CS2.",
          progress: "not_started",
        },
      ],
    });
    expect(repository.replaceActive).toHaveBeenCalledWith(result.plan);
  });

  test("reports a shortfall without exceeding the requested item limit", async () => {
    const repository = createRepository();
    const service = createBacklogPlanService({
      clock,
      createId: () => "monthly-1",
      recommendationService: createRecommendationService([recommendation(620, "Portal 2", 480)]),
      repository,
    });

    const result = await service.create({
      cadence: "monthly",
      availableMinutes: 240,
      targetGameCount: 3,
    });

    expect(result.plan.items).toHaveLength(1);
    expect(result.shortfall).toEqual({
      requestedGameCount: 3,
      selectedGameCount: 1,
      message: "Only 1 eligible game was available for this plan; 2 more were requested.",
    });
  });

  test("rejects invalid plan inputs before invoking injected dependencies", async () => {
    const recommendationService = createRecommendationService();
    const repository = createRepository();
    const service = createBacklogPlanService({
      clock,
      createId: () => "unused",
      recommendationService,
      repository,
    });

    await expect(
      service.create({ cadence: "daily", availableMinutes: 60, targetGameCount: 1 }),
    ).rejects.toBeInstanceOf(InputError);
    await expect(
      service.create({ cadence: "weekly", availableMinutes: 0, targetGameCount: 1 }),
    ).rejects.toBeInstanceOf(InputError);
    await expect(
      service.create({ cadence: "weekly", availableMinutes: 60, targetGameCount: 0 }),
    ).rejects.toBeInstanceOf(InputError);
    expect(recommendationService.recommend).not.toHaveBeenCalled();
    expect(repository.replaceActive).not.toHaveBeenCalled();
  });

  test("rejects invalid plan IDs and progress transitions before persistence", async () => {
    const repository = createRepository();
    const service = createBacklogPlanService({
      clock,
      createId: () => "unused",
      recommendationService: createRecommendationService(),
      repository,
    });

    await expect(service.setItemProgress("", "item-1", "done")).rejects.toBeInstanceOf(InputError);
    await expect(service.setItemProgress("plan-1", "", "done")).rejects.toBeInstanceOf(InputError);
    await expect(service.setItemProgress("plan-1", "item-1", "completed")).rejects.toBeInstanceOf(
      InputError,
    );
    expect(repository.setItemProgress).not.toHaveBeenCalled();
  });

  test("archives an existing active cadence plan transactionally when creating its replacement", async () => {
    const database = openTrackerDatabase(":memory:");
    const repository = new SqliteBacklogPlanRepository(database);
    const recommendations = createRecommendationService([recommendation(620, "Portal 2", 480)]);
    let nextId = 1;
    const service = createBacklogPlanService({
      clock,
      createId: () => `weekly-${nextId++}`,
      recommendationService: recommendations,
      repository,
    });

    try {
      const first = await service.create({
        cadence: "weekly",
        availableMinutes: 60,
        targetGameCount: 1,
      });
      const replacement = await service.create({
        cadence: "weekly",
        availableMinutes: 120,
        targetGameCount: 1,
      });

      expect(repository.getById(first.plan.id)).toMatchObject({ lifecycle: "archived" });
      expect(await service.listActive()).toEqual([replacement.plan]);
      expect(
        database
          .prepare(
            "SELECT COUNT(*) AS count FROM backlog_plans WHERE cadence = 'weekly' AND lifecycle = 'active'",
          )
          .get(),
      ).toEqual({ count: 1 });
    } finally {
      database.close();
    }
  });

  test("keeps archived plan items readable but immutable through service and repository", async () => {
    const database = openTrackerDatabase(":memory:");
    const repository = new SqliteBacklogPlanRepository(database);
    let nextId = 1;
    const service = createBacklogPlanService({
      clock,
      createId: () => `weekly-${nextId++}`,
      recommendationService: createRecommendationService([recommendation(620, "Portal 2", 480)]),
      repository,
    });

    try {
      const archived = await service.create({
        cadence: "weekly",
        availableMinutes: 60,
        targetGameCount: 1,
      });
      await service.create({ cadence: "weekly", availableMinutes: 120, targetGameCount: 1 });

      expect(service.get(archived.plan.id)).toMatchObject({
        lifecycle: "archived",
        items: [{ id: archived.plan.items[0].id, progress: "not_started" }],
      });
      await expect(
        service.setItemProgress(archived.plan.id, archived.plan.items[0].id, "done"),
      ).rejects.toBeInstanceOf(InputError);
      expect(
        repository.setItemProgress(archived.plan.id, archived.plan.items[0].id, "done", now),
      ).toBe(false);
      expect(service.get(archived.plan.id)?.items[0]).toMatchObject({ progress: "not_started" });
    } finally {
      database.close();
    }
  });

  test("persists manual plan-item progress without writing tracker state", async () => {
    const database = openTrackerDatabase(":memory:");
    const repository = new SqliteBacklogPlanRepository(database);
    const service = createBacklogPlanService({
      clock,
      createId: () => "weekly-1",
      recommendationService: createRecommendationService([recommendation(620, "Portal 2", 480)]),
      repository,
    });

    try {
      const { plan } = await service.create({
        cadence: "weekly",
        availableMinutes: 60,
        targetGameCount: 1,
      });
      await expect(
        service.setItemProgress(plan.id, plan.items[0].id, "in_progress"),
      ).resolves.toEqual(expect.objectContaining({ progress: "in_progress" }));
      await expect(service.setItemProgress(plan.id, plan.items[0].id, "done")).resolves.toEqual(
        expect.objectContaining({ progress: "done" }),
      );
      await expect(
        service.setItemProgress(plan.id, plan.items[0].id, "not_started"),
      ).rejects.toBeInstanceOf(InputError);
      expect(database.prepare("SELECT COUNT(*) AS count FROM tracker_entries").get()).toEqual({
        count: 0,
      });
      expect(repository.getById(plan.id)?.items[0]).toMatchObject({ progress: "done" });
    } finally {
      database.close();
    }
  });
});
