import { TRACKER_ERROR_MESSAGES } from "./domain/tracker.js";

export type AppErrorCode =
  | "CONFIG_INVALID"
  | "INPUT_INVALID"
  | "STEAM_UNAVAILABLE"
  | "STEAM_TIMEOUT"
  | "STEAM_RESPONSE_INVALID"
  | "GAME_NOT_FOUND"
  | "INVALID_INPUT"
  | "OWNERSHIP_UNAVAILABLE"
  | "PERSISTENCE_FAILURE";

export type MetadataUnavailableEnvelope = Readonly<{
  isError: true;
  error: Readonly<{
    code: "METADATA_UNAVAILABLE";
    message: string;
    retryable: boolean;
  }>;
}>;

export type DurationUnavailableEnvelope = Readonly<{
  isError: true;
  error: Readonly<{
    code: "DURATION_UNAVAILABLE";
    message: string;
    retryable: boolean;
  }>;
}>;

type MetadataUnavailableOptions = Readonly<{
  message: string;
  retryable: boolean;
  cause?: unknown;
}>;

export function createMetadataUnavailableEnvelope(
  options: MetadataUnavailableOptions,
): MetadataUnavailableEnvelope {
  return Object.freeze({
    isError: true,
    error: Object.freeze({
      code: "METADATA_UNAVAILABLE" as const,
      message: options.message,
      retryable: options.retryable,
    }),
  });
}

export function createDurationUnavailableEnvelope(
  options: MetadataUnavailableOptions,
): DurationUnavailableEnvelope {
  return Object.freeze({
    isError: true,
    error: Object.freeze({
      code: "DURATION_UNAVAILABLE" as const,
      message: options.message,
      retryable: options.retryable,
    }),
  });
}

type SafeErrorPayload = Readonly<{
  code: AppErrorCode;
  message: string;
}>;

export abstract class AppError extends Error {
  readonly code: AppErrorCode;
  readonly safeMessage: string;

  protected constructor(code: AppErrorCode, safeMessage: string, cause?: unknown) {
    super(safeMessage);
    this.name = new.target.name;
    this.code = code;
    this.safeMessage = safeMessage;

    if (cause !== undefined) {
      Object.defineProperty(this, "cause", {
        configurable: false,
        enumerable: false,
        value: cause,
        writable: false,
      });
    }
  }

  toJSON(): SafeErrorPayload {
    return { code: this.code, message: this.safeMessage };
  }
}

export class ConfigError extends AppError {
  constructor(setting: string) {
    super(
      "CONFIG_INVALID",
      `Missing required setting ${setting}. Set ${setting} in your environment and restart the server.`,
    );
  }
}

export class InputError extends AppError {
  constructor(message: string) {
    super("INPUT_INVALID", message);
  }
}

export class SteamUnavailableError extends AppError {
  constructor(cause?: unknown) {
    super("STEAM_UNAVAILABLE", "Steam is currently unavailable. Try again later.", cause);
  }
}

export class SteamTimeoutError extends AppError {
  constructor(cause?: unknown) {
    super("STEAM_TIMEOUT", "Steam did not respond in time. Try again later.", cause);
  }
}

export class SteamResponseError extends AppError {
  constructor(cause?: unknown) {
    super("STEAM_RESPONSE_INVALID", "Steam returned an invalid response. Try again later.", cause);
  }
}

export class GameNotFoundError extends AppError {
  constructor(appId: number) {
    super("GAME_NOT_FOUND", `No accessible game was found for app ID ${appId}.`);
  }
}

export class TrackerInputError extends AppError {
  constructor() {
    super("INVALID_INPUT", TRACKER_ERROR_MESSAGES.invalidInput);
  }
}

export class TrackerOwnershipUnavailableError extends AppError {
  constructor(cause?: unknown) {
    super("OWNERSHIP_UNAVAILABLE", TRACKER_ERROR_MESSAGES.ownershipUnavailable, cause);
  }
}

export class TrackerPersistenceError extends AppError {
  constructor(cause?: unknown) {
    super("PERSISTENCE_FAILURE", TRACKER_ERROR_MESSAGES.persistenceFailure, cause);
  }
}
