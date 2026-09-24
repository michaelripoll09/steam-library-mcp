import { describe, expect, test, vi } from "vitest";

import { loadConfig } from "../../src/config.js";
import { createCoreServices } from "../../src/core-services.js";
import type { GameDurationService } from "../../src/durations/game-duration-service.js";
import type { SteamGame } from "../../src/domain/models.js";
import type { SteamService } from "../../src/services/steam-service.js";
import { openTrackerDatabase } from "../../src/tracker/sqlite/database.js";

const fetchedAt = "2026-09-04T00:00:00.000Z";

function games(count: number): SteamGame[] {
  return Array.from({ length: count }, (_, index) => ({
    appId: index + 1,
    name: `Game ${index + 1}`,
    playtimeMinutes: 0,
    isPlayable: true,
  }));
}

function createServices({
  library,
  getEstimate,
}: {
  library: SteamGame[];
  getEstimate: (game: SteamGame) => Promise<unknown>;
}) {
  const database = openTrackerDatabase(":memory:");
  const steamService = {
    getLibrary: vi.fn(async () => ({ steamId: "test-steam-id", games: library, fetchedAt })),
    refreshLibrary: vi.fn(async () => ({ steamId: "test-steam-id", games: library, fetchedAt })),
  } as unknown as SteamService;
  const services = createCoreServices({
    config: loadConfig({ STEAM_API_KEY: "test-key", STEAM_ID: "test-steam-id" }),
    database,
    steamService,
    gameDurationService: {
      getEstimate: vi.fn(getEstimate),
    } as unknown as GameDurationService,
  });
  return { services, database };
}

async function waitForState(
  services: ReturnType<typeof createCoreServices>,
  id: string,
  state: string,
): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (services.taskRunner.get(id)?.state === state) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Task ${id} did not reach ${state}.`);
}

describe("enrich_durations bounded concurrency", () => {
  test("processes every game with at most 4 concurrent estimates and full progress", async () => {
    const library = games(8);
    let active = 0;
    let maxActive = 0;
    const seenAppIds: number[] = [];
    const { services, database } = createServices({
      library,
      getEstimate: async (game) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        seenAppIds.push(game.appId);
        try {
          await new Promise<void>((resolve) => setTimeout(resolve, 5));
          return undefined;
        } finally {
          active -= 1;
        }
      },
    });

    try {
      const task = services.taskRunner.enqueue({ type: "enrich_durations" });
      await waitForState(services, task.id, "completed");

      expect(seenAppIds.sort((left, right) => left - right)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(maxActive).toBeLessThanOrEqual(4);
      expect(services.taskRunner.get(task.id)).toMatchObject({
        state: "completed",
        progress: { completed: 8, total: 8 },
      });
      services.close();
    } finally {
      database.close();
    }
  });

  test("cancellation stops scheduling new estimates without duplicating work", async () => {
    const library = games(8);
    let releaseEstimates!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseEstimates = resolve;
    });
    const seenAppIds: number[] = [];
    const { services, database } = createServices({
      library,
      getEstimate: async (game) => {
        seenAppIds.push(game.appId);
        await gate;
        return undefined;
      },
    });

    try {
      const task = services.taskRunner.enqueue({ type: "enrich_durations" });
      for (let attempt = 0; attempt < 50 && seenAppIds.length < 4; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      expect(seenAppIds).toHaveLength(4);
      services.taskRunner.cancel(task.id);
      releaseEstimates();
      await waitForState(services, task.id, "cancelled");

      expect(seenAppIds).toHaveLength(4);
      expect(new Set(seenAppIds).size).toBe(4);
      expect(services.taskRunner.get(task.id)?.state).toBe("cancelled");
      services.close();
    } finally {
      database.close();
    }
  });
});
