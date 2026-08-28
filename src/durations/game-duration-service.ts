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
  getEstimate(game: SteamGame): Promise<GameDurationEstimate | DurationUnavailableEnvelope>;
}>;

function unavailable(
  retryable: boolean,
  message = "Game duration estimates are temporarily unavailable.",
) {
  return createDurationUnavailableEnvelope({ message, retryable });
}

export function createGameDurationService({
  clock,
  igdbClient,
  repository,
}: GameDurationServiceDependencies): GameDurationService {
  return Object.freeze({
    async getEstimate(
      game: SteamGame,
    ): Promise<GameDurationEstimate | DurationUnavailableEnvelope> {
      const games = await igdbClient.findGamesForSteamApp(game.appId);
      if (isMetadataUnavailable(games)) {
        return repository.get(game.appId) ?? unavailable(games.error.retryable);
      }

      const matchedGame = selectSteamMatch(games, game.appId);
      if (matchedGame === undefined) {
        return unavailable(false, "No duration estimate is available for this game.");
      }

      const records = await igdbClient.findGameTimeToBeat(matchedGame.id);
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

      repository.save(estimate);
      return estimate;
    },
  });
}

export function createUnavailableGameDurationService({
  repository,
}: Pick<GameDurationServiceDependencies, "repository">): GameDurationService {
  return Object.freeze({
    async getEstimate(
      game: SteamGame,
    ): Promise<GameDurationEstimate | DurationUnavailableEnvelope> {
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
