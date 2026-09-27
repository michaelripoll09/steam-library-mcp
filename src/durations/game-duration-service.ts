import type { AbortOptions } from "../abort-options.js";
import { throwIfAborted } from "../abort-options.js";
import type { Clock } from "../cache/ttl-cache.js";
import {
  normalizeIgdbDuration,
  type GameDurationEstimate,
  type GameDurationRepository,
} from "../domain/game-duration.js";
import { createDurationUnavailableEnvelope, type DurationUnavailableEnvelope } from "../errors.js";
import type { IgdbClient } from "../igdb/client.js";
import { isMetadataUnavailable } from "../igdb/token-provider.js";
import type { SteamGame } from "../domain/models.js";
import { selectSteamMatch } from "../domain/metadata.js";

type GameDurationServiceDependencies = Readonly<{
  clock: Clock;
  igdbClient: IgdbClient;
  repository: GameDurationRepository;
}>;

export type GameDurationService = Readonly<{
  getEstimate(
    game: SteamGame,
    options?: AbortOptions,
  ): Promise<GameDurationEstimate | DurationUnavailableEnvelope>;
}>;

function unavailable(
  retryable: boolean,
  message = "Game duration estimates are temporarily unavailable.",
) {
  return createDurationUnavailableEnvelope({ message, retryable });
}

const DURATION_CACHE_TTL_MS = 86_400_000;

function isFreshEstimate(
  estimate: GameDurationEstimate | undefined,
  now: number,
): estimate is GameDurationEstimate {
  if (estimate === undefined) return false;
  const refreshedAt = Date.parse(estimate.refreshedAt);
  return !Number.isNaN(refreshedAt) && now - refreshedAt < DURATION_CACHE_TTL_MS;
}

export function createGameDurationService({
  clock,
  igdbClient,
  repository,
}: GameDurationServiceDependencies): GameDurationService {
  const inFlight = new Map<number, Promise<GameDurationEstimate | DurationUnavailableEnvelope>>();
  return Object.freeze({
    async getEstimate(
      game: SteamGame,
      options?: AbortOptions,
    ): Promise<GameDurationEstimate | DurationUnavailableEnvelope> {
      throwIfAborted(options);
      const cached = repository.get(game.appId);
      if (isFreshEstimate(cached, clock.now())) {
        return cached;
      }
      if (options?.signal !== undefined) return fetchAndStoreEstimate(game, options);
      const ongoing = inFlight.get(game.appId);
      if (ongoing !== undefined) {
        return ongoing;
      }
      const pending = fetchAndStoreEstimate(game);
      inFlight.set(game.appId, pending);
      try {
        return await pending;
      } finally {
        inFlight.delete(game.appId);
      }
    },
  });

  async function fetchAndStoreEstimate(
    game: SteamGame,
    options?: AbortOptions,
  ): Promise<GameDurationEstimate | DurationUnavailableEnvelope> {
    throwIfAborted(options);
    const games = await igdbClient.findGamesForSteamApp(
      game.appId,
      ...(options === undefined ? [] : [options]),
    );
    throwIfAborted(options);
    if (isMetadataUnavailable(games)) {
      return repository.get(game.appId) ?? unavailable(games.error.retryable);
    }

    const matchedGame = selectSteamMatch(games, game.appId);
    if (matchedGame === undefined) {
      return unavailable(false, "No duration estimate is available for this game.");
    }

    const records = await igdbClient.findGameTimeToBeat(
      matchedGame.id,
      ...(options === undefined ? [] : [options]),
    );
    throwIfAborted(options);
    if (isMetadataUnavailable(records)) {
      return repository.get(game.appId) ?? unavailable(records.error.retryable);
    }

    const duration = records.find((record) => record.game_id === matchedGame.id);
    const estimate =
      duration === undefined
        ? undefined
        : normalizeIgdbDuration({
            appId: game.appId,
            igdbGameId: matchedGame.id,
            ...(matchedGame.name === undefined ? {} : { igdbGameName: matchedGame.name }),
            hastilySeconds: duration.hastily,
            normallySeconds: duration.normally,
            completelySeconds: duration.completely,
            refreshedAt: new Date(clock.now()).toISOString(),
          });
    if (estimate === undefined) {
      return unavailable(false, "No duration estimate is available for this game.");
    }

    throwIfAborted(options);
    repository.save(estimate);
    return estimate;
  }
}

export function createUnavailableGameDurationService({
  repository,
}: Pick<GameDurationServiceDependencies, "repository">): GameDurationService {
  return Object.freeze({
    async getEstimate(
      game: SteamGame,
      options?: AbortOptions,
    ): Promise<GameDurationEstimate | DurationUnavailableEnvelope> {
      throwIfAborted(options);
      return (
        repository.get(game.appId) ??
        unavailable(
          false,
          "Configure IGDB_CLIENT_ID and IGDB_CLIENT_SECRET to use game duration estimates.",
        )
      );
    },
  });
}
