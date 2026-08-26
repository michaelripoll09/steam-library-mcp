import type { GameStatus, OwnershipLookup, TrackerRepository } from "../domain/tracker.js";
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
          writer.setStatus(appId, status, new Date(clock.now()).toISOString()),
        );
        return Object.freeze({ outcome: updated ? "updated" : "unchanged", appId, status });
      } catch (error) {
        throw new TrackerPersistenceError(error);
      }
    },
  });
}

function assertAppId(appId: unknown): asserts appId is number {
  if (typeof appId !== "number" || !Number.isSafeInteger(appId) || appId <= 0) {
    throw new TrackerInputError();
  }
}
