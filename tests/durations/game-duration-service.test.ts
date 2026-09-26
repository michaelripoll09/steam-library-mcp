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

  test("returns a fresh cached estimate without calling IGDB", async () => {
    const cached = {
      appId: 620,
      igdbGameId: 3,
      igdbGameName: "Portal 2",
      source: "igdb" as const,
      refreshedAt: "1970-01-01T01:00:00.000Z",
      normally: { minutes: 120, hours: 2 },
    };
    const repository = createRepository(cached);
    const igdbClient = {
      findGamesForSteamApp: vi.fn(async () => [
        { id: 3, name: "Portal 2", external_games: [{ category: 1, uid: "620" }] },
      ]),
      findGameTimeToBeat: vi.fn(async () => [
        { game_id: 3, hastily: 5_400, normally: 7_200, completely: 9_000 },
      ]),
    } as unknown as IgdbClient;
    const service = createGameDurationService({
      clock: { now: () => 3_600_000 },
      igdbClient,
      repository,
    });

    await expect(service.getEstimate(portal)).resolves.toEqual(cached);
    expect(igdbClient.findGamesForSteamApp).not.toHaveBeenCalled();
    expect(igdbClient.findGameTimeToBeat).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
  });

  test("deduplicates concurrent estimate requests for the same game", async () => {
    const repository = createRepository();
    let releaseGames!: (value: unknown) => void;
    const gamesGate = new Promise<unknown>((resolve) => {
      releaseGames = resolve;
    });
    const igdbClient = {
      findGamesForSteamApp: vi.fn(() => gamesGate),
      findGameTimeToBeat: vi.fn(async () => [
        { game_id: 3, hastily: 5_400, normally: 7_200, completely: 9_000 },
      ]),
    } as unknown as IgdbClient;
    const service = createGameDurationService({
      clock: { now: () => 0 },
      igdbClient,
      repository,
    });

    const first = service.getEstimate(portal);
    const second = service.getEstimate(portal);
    releaseGames([{ id: 3, name: "Portal 2", external_games: [{ category: 1, uid: "620" }] }]);
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toEqual(secondResult);
    expect(igdbClient.findGamesForSteamApp).toHaveBeenCalledTimes(1);
  });

  test("isolates a cancellable caller from shared non-cancellable requests", async () => {
    const repository = createRepository();
    const createGate = () => {
      let release!: (value: unknown) => void;
      const promise = new Promise<unknown>((resolve) => {
        release = resolve;
      });
      return { promise, release };
    };
    const providerGates = [createGate(), createGate()];
    const providerSignals: (AbortSignal | undefined)[] = [];
    const igdbClient = {
      findGamesForSteamApp: vi.fn((_appId: number, options?: { signal?: AbortSignal }) => {
        const gate = providerGates[providerSignals.length];
        providerSignals.push(options?.signal);
        return gate.promise;
      }),
      findGameTimeToBeat: vi.fn(async () => [
        { game_id: 3, hastily: 5_400, normally: 7_200, completely: 9_000 },
      ]),
    } as unknown as IgdbClient;
    const service = createGameDurationService({
      clock: { now: () => 0 },
      igdbClient,
      repository,
    });
    const controller = new AbortController();
    const cancellable = service.getEstimate(portal, { signal: controller.signal });
    const ordinaryFirst = service.getEstimate(portal);
    const ordinarySecond = service.getEstimate(portal);

    controller.abort();
    const games = [{ id: 3, name: "Portal 2", external_games: [{ category: 1, uid: "620" }] }];
    providerGates[0].release(games);
    providerGates[1].release(games);
    const [cancellableResult, ordinaryFirstResult, ordinarySecondResult] = await Promise.allSettled(
      [cancellable, ordinaryFirst, ordinarySecond],
    );

    expect.soft(igdbClient.findGamesForSteamApp).toHaveBeenCalledTimes(2);
    expect.soft(providerSignals).toEqual([controller.signal, undefined]);
    expect.soft(cancellableResult).toMatchObject({
      status: "rejected",
      reason: { name: "AbortError" },
    });
    expect.soft(ordinaryFirstResult.status).toBe("fulfilled");
    expect.soft(ordinarySecondResult).toEqual(ordinaryFirstResult);
  });

  test("rejects a cancelled estimate without persisting its late provider result", async () => {
    const repository = createRepository();
    let releaseGames!: (value: unknown) => void;
    const gamesGate = new Promise<unknown>((resolve) => {
      releaseGames = resolve;
    });
    const igdbClient = {
      findGamesForSteamApp: vi.fn(() => gamesGate),
      findGameTimeToBeat: vi.fn(async () => [
        { game_id: 3, hastily: 5_400, normally: 7_200, completely: 9_000 },
      ]),
    } as unknown as IgdbClient;
    const service = createGameDurationService({
      clock: { now: () => 0 },
      igdbClient,
      repository,
    });
    const controller = new AbortController();
    const estimate = service.getEstimate(portal, { signal: controller.signal });
    await Promise.resolve();
    controller.abort();
    releaseGames([{ id: 3, name: "Portal 2", external_games: [{ category: 1, uid: "620" }] }]);

    const [estimateResult] = await Promise.allSettled([estimate]);

    expect.soft(estimateResult).toMatchObject({
      status: "rejected",
      reason: { name: "AbortError" },
    });
    expect.soft(repository.save).not.toHaveBeenCalled();
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

    const controller = new AbortController();
    controller.abort();
    const [abortedResult] = await Promise.allSettled([
      service.getEstimate(portal, { signal: controller.signal }),
    ]);
    expect.soft(abortedResult).toMatchObject({
      status: "rejected",
      reason: { name: "AbortError" },
    });
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
