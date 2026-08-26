import type { SteamGame } from "./models.js";

export const TRACKER_STATUSES = Object.freeze([
  "backlog",
  "playing",
  "completed",
  "dropped",
  "paused",
] as const);

export type GameStatus = (typeof TRACKER_STATUSES)[number];

export const TRACKER_ERROR_MESSAGES = Object.freeze({
  invalidInput: "appId must be a positive safe integer.",
  ownershipUnavailable: "Steam ownership could not be verified. Try again later.",
  persistenceFailure: "Tracker storage is unavailable. Check the database path and try again.",
});

export interface TrackerGame {
  readonly appId: number;
  readonly name: string;
  readonly status: GameStatus;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
}

export interface TrackerEntry {
  readonly appId: number;
  readonly status: GameStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface OwnershipLookup {
  getOwnedGames(): Promise<readonly SteamGame[]>;
}

export interface TrackerWriter {
  pauseCurrent(exceptAppId: number, at: string): void;
  setStatus(appId: number, status: GameStatus, at: string): boolean;
}

export interface TrackerRepository {
  list(): readonly TrackerEntry[];
  transaction<T>(work: (writer: TrackerWriter) => T): T;
}

type TrackerGameInput = TrackerGame & Readonly<Record<string, unknown>>;

export function createTrackerGame(input: TrackerGameInput): TrackerGame {
  return Object.freeze({
    appId: input.appId,
    name: input.name,
    status: input.status,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  });
}
