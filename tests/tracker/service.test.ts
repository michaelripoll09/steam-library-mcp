import { describe, expect, test, vi } from "vitest";

import type { OwnershipLookup, TrackerRepository } from "../../src/domain/tracker.js";
import {
  TrackerInputError,
  TrackerOwnershipUnavailableError,
  TrackerPersistenceError,
} from "../../src/errors.js";
import { createGamingTrackerService } from "../../src/tracker/gaming-tracker-service.js";

const ownedGames = [{ appId: 620, name: "Portal 2", playtimeMinutes: 0 }] as const;

function createRepository(): TrackerRepository {
  return {
    list: vi.fn(() => []),
    transaction: vi.fn(),
  };
}

function createOwnershipLookup(
  games: readonly { appId: number; name: string; playtimeMinutes: number }[] = ownedGames,
): OwnershipLookup {
  return { getOwnedGames: vi.fn(async () => games) };
}

describe("GamingTrackerService ownership gate", () => {
  test.each([undefined, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid app ID %p before ownership or SQLite access",
    async (appId) => {
      const ownershipLookup = createOwnershipLookup();
      const repository = createRepository();
      const service = createGamingTrackerService({
        clock: { now: () => 1_700_000_000_000 },
        ownershipLookup,
        repository,
      });

      await expect(service.mark(appId, "playing")).rejects.toBeInstanceOf(TrackerInputError);
      expect(ownershipLookup.getOwnedGames).not.toHaveBeenCalled();
      expect(repository.transaction).not.toHaveBeenCalled();
    },
  );

  test("returns not-owned without opening a write transaction", async () => {
    const ownershipLookup = createOwnershipLookup([]);
    const repository = createRepository();
    const service = createGamingTrackerService({
      clock: { now: () => 1_700_000_000_000 },
      ownershipLookup,
      repository,
    });

    await expect(service.mark(730, "completed")).resolves.toEqual({
      outcome: "not_owned",
      appId: 730,
    });
    expect(ownershipLookup.getOwnedGames).toHaveBeenCalledTimes(1);
    expect(repository.transaction).not.toHaveBeenCalled();
  });

  test("maps unavailable ownership to a safe typed error without writes", async () => {
    const ownershipLookup: OwnershipLookup = {
      getOwnedGames: vi.fn(async () => {
        throw new Error("raw Steam payload includes a private token");
      }),
    };
    const repository = createRepository();
    const service = createGamingTrackerService({
      clock: { now: () => 1_700_000_000_000 },
      ownershipLookup,
      repository,
    });

    let thrown: unknown;
    try {
      await service.mark(620, "playing");
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(TrackerOwnershipUnavailableError);
    expect(JSON.stringify(thrown)).toBe(
      '{"code":"OWNERSHIP_UNAVAILABLE","message":"Steam ownership could not be verified. Try again later."}',
    );
    expect(JSON.stringify(thrown)).not.toContain("private token");
    expect(repository.transaction).not.toHaveBeenCalled();
  });

  test("maps SQLite failure to a safe typed error instead of reporting an update", async () => {
    const ownershipLookup = createOwnershipLookup();
    const repository: TrackerRepository = {
      list: vi.fn(() => []),
      transaction: vi.fn(() => {
        throw new Error("SQLITE_BUSY at C:/private/tracker.sqlite");
      }),
    };
    const service = createGamingTrackerService({
      clock: { now: () => 1_700_000_000_000 },
      ownershipLookup,
      repository,
    });

    await expect(service.mark(620, "playing")).rejects.toBeInstanceOf(TrackerPersistenceError);
    expect(repository.transaction).toHaveBeenCalledTimes(1);
  });
});
