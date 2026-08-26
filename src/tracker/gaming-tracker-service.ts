import type {
  GameStatus,
  OwnershipLookup,
  TrackerEntry,
  TrackerGame,
  TrackerRepository,
} from "../domain/tracker.js";
import {
  TrackerInputError,
  TrackerOwnershipUnavailableError,
  TrackerPersistenceError,
} from "../errors.js";

export type TrackerMarkStatus = Extract<GameStatus, "playing" | "completed" | "dropped">;

export type TrackerMarkResult =
  | Readonly<{ outcome: "updated" | "unchanged"; appId: number; status: TrackerMarkStatus }>
  | Readonly<{ outcome: "not_owned"; appId: number }>;

type Clock = Readonly<{ now(): number }>;

type GamingTrackerServiceDependencies = Readonly<{
  clock: Clock;
  ownershipLookup: OwnershipLookup;
  repository: TrackerRepository;
}>;

export type GamingTrackerService = Readonly<{
  mark(appId: unknown, status: TrackerMarkStatus): Promise<TrackerMarkResult>;
  getBacklog(): Promise<readonly TrackerGame[]>;
  getCurrentGame(): Promise<TrackerGame | null>;
  getCompleted(): Promise<readonly TrackerGame[]>;
}>;

export function createGamingTrackerService({
  clock,
  ownershipLookup,
  repository,
}: GamingTrackerServiceDependencies): GamingTrackerService {
  return Object.freeze({
    async mark(appId: unknown, status: TrackerMarkStatus): Promise<TrackerMarkResult> {
      assertAppId(appId);

      let ownedGames;
      try {
        ownedGames = await ownershipLookup.getOwnedGames();
      } catch (error) {
        throw new TrackerOwnershipUnavailableError(error);
      }

      if (!ownedGames.some((game) => game.appId === appId)) {
        return Object.freeze({ outcome: "not_owned", appId });
      }

      try {
        const updated = repository.transaction((writer) =>
          setStatus(writer, appId, status, new Date(clock.now()).toISOString()),
        );
        return Object.freeze({ outcome: updated ? "updated" : "unchanged", appId, status });
      } catch (error) {
        throw new TrackerPersistenceError(error);
      }
    },
    async getBacklog() {
      const games = await getOwnedGames(ownershipLookup);
      const entriesByAppId = new Map(repository.list().map((entry) => [entry.appId, entry]));
      return Object.freeze(
        games
          .filter((game) => {
            const status = entriesByAppId.get(game.appId)?.status;
            return status === undefined || status === "backlog" || status === "paused";
          })
          .map((game) => toTrackerGame(game, entriesByAppId.get(game.appId), "backlog"))
          .sort(compareTrackerGames),
      );
    },
    async getCurrentGame() {
      const games = await getOwnedGames(ownershipLookup);
      const gameByAppId = new Map(games.map((game) => [game.appId, game]));
      const current = repository.list().find((entry) => entry.status === "playing");
      return current === undefined || gameByAppId.get(current.appId) === undefined
        ? null
        : toTrackerGame(gameByAppId.get(current.appId)!, current, "playing");
    },
    async getCompleted() {
      const games = await getOwnedGames(ownershipLookup);
      const gameByAppId = new Map(games.map((game) => [game.appId, game]));
      return Object.freeze(
        repository
          .list()
          .filter((entry) => entry.status === "completed" && gameByAppId.has(entry.appId))
          .map((entry) => toTrackerGame(gameByAppId.get(entry.appId)!, entry, "completed"))
          .sort(compareTrackerGames),
      );
    },
  });
}

function setStatus(
  writer: Parameters<TrackerRepository["transaction"]>[0] extends (writer: infer T) => unknown
    ? T
    : never,
  appId: number,
  status: TrackerMarkStatus,
  at: string,
): boolean {
  if (status === "playing") writer.pauseCurrent(appId, at);
  return writer.setStatus(appId, status, at);
}

async function getOwnedGames(ownershipLookup: OwnershipLookup) {
  try {
    return await ownershipLookup.getOwnedGames();
  } catch (error) {
    throw new TrackerOwnershipUnavailableError(error);
  }
}

function toTrackerGame(
  game: { appId: number; name: string },
  entry: TrackerEntry | undefined,
  status: GameStatus,
): TrackerGame {
  return Object.freeze({
    appId: game.appId,
    name: game.name,
    status,
    createdAt: entry?.createdAt ?? null,
    updatedAt: entry?.updatedAt ?? null,
  });
}

function compareTrackerGames(left: TrackerGame, right: TrackerGame): number {
  if (left.updatedAt !== right.updatedAt) {
    if (left.updatedAt === null) return 1;
    if (right.updatedAt === null) return -1;
    return right.updatedAt.localeCompare(left.updatedAt);
  }
  return left.appId - right.appId;
}

function assertAppId(appId: unknown): asserts appId is number {
  if (typeof appId !== "number" || !Number.isSafeInteger(appId) || appId <= 0) {
    throw new TrackerInputError();
  }
}
