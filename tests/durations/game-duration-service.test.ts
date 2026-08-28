import { describe, expect, test, vi } from "vitest";

import type { GameDurationRepository } from "../../src/domain/game-duration.js";
import {
  createGameDurationService,
  createUnavailableGameDurationService,
} from "../../src/durations/game-duration-service.js";
import type { IgdbClient } from "../../src/igdb/client.js";

const portal = { appId: 620, name: "Portal 2", playtimeMinutes: 0 } as const;

function createRepository(
  existing?: ReturnType<GameDurationRepository["get"]>,
): GameDurationRepository {
  let value = existing;
  return {
    get: vi.fn(() => value),
    save: vi.fn((estimate) => {
      value = estimate;
    }),
  };
}

describe("game duration service", () => {
  test("maps a verified Steam-to-IGDB match, normalizes it, and stores the estimate locally", async () => {
    const repository = createRepository();
    const igdbClient = {
      findGamesForSteamApp: vi.fn(async () => [
        { id: 3, name: "Portal 2", external_games: [{ category: 1, uid: "620" }] },
      ]),
      findGameTimeToBeat: vi.fn(async () => [
        { game_id: 3, hastily: 5_400, normally: 7_200, completely: 9_000 },
      ]),
    } as unknown as IgdbClient;
    const service = createGameDurationService({
      clock: { now: () => 0 },
      igdbClient,
      repository,
    });

    await expect(service.getEstimate(portal)).resolves.toEqual({
      appId: 620,
      igdbGameId: 3,
      igdbGameName: "Portal 2",
      source: "igdb",
      refreshedAt: "1970-01-01T00:00:00.000Z",
      hastily: { minutes: 90, hours: 1.5 },
      normally: { minutes: 120, hours: 2 },
      completely: { minutes: 150, hours: 2.5 },
    });
    expect(repository.save).toHaveBeenCalledWith({
      appId: 620,
      igdbGameId: 3,
      igdbGameName: "Portal 2",
      source: "igdb",
      refreshedAt: "1970-01-01T00:00:00.000Z",
      hastily: { minutes: 90, hours: 1.5 },
      normally: { minutes: 120, hours: 2 },
      completely: { minutes: 150, hours: 2.5 },
    });
    expect(igdbClient.findGameTimeToBeat).toHaveBeenCalledWith(3);
  });

  test("returns a verified cached estimate when the provider is unavailable", async () => {
    const cached = {
      appId: 620,
      igdbGameId: 3,
      igdbGameName: "Portal 2",
      source: "igdb" as const,
      refreshedAt: "2026-08-01T00:00:00.000Z",
      normally: { minutes: 120, hours: 2 },
    };
    const repository = createRepository(cached);
    const igdbClient = {
      findGamesForSteamApp: vi.fn(async () => ({
        isError: true as const,
        error: { code: "METADATA_UNAVAILABLE" as const, message: "temporary", retryable: true },
      })),
      findGameTimeToBeat: vi.fn(),
    } as unknown as IgdbClient;
    const service = createGameDurationService({
      clock: { now: () => 0 },
      igdbClient,
      repository,
    });

    await expect(service.getEstimate(portal)).resolves.toEqual(cached);
    expect(repository.save).not.toHaveBeenCalled();
    expect(repository.get).toHaveBeenCalledWith(620);
  });

  test("returns a verified cached estimate when IGDB is disabled", async () => {
    const cached = {
      appId: 620,
      igdbGameId: 3,
      igdbGameName: "Portal 2",
      source: "igdb" as const,
      refreshedAt: "2026-08-28T12:00:00.000Z",
      normally: { minutes: 120, hours: 2 },
    };
    const repository = createRepository(cached);
    const service = createUnavailableGameDurationService({ repository });

    await expect(service.getEstimate(portal)).resolves.toEqual(cached);
    expect(repository.get).toHaveBeenCalledWith(620);
    expect(repository.save).not.toHaveBeenCalled();
  });
});
