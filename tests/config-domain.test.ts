import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";

import {
  DEFAULT_LIBRARY_CACHE_TTL_MS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_TRACKER_DATABASE_PATH,
  loadConfig,
} from "../src/config.js";

describe("loadConfig", () => {
  test("returns one validated Steam identity with fixed runtime defaults", () => {
    expect(
      loadConfig({
        STEAM_API_KEY: "test-api-key",
        STEAM_ID: "76561198000000000",
      }),
    ).toEqual({
      steamApiKey: "test-api-key",
      steamId: "76561198000000000",
      requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
      libraryCacheTtlMs: DEFAULT_LIBRARY_CACHE_TTL_MS,
      trackerDatabasePath: DEFAULT_TRACKER_DATABASE_PATH,
    });
  });

  test("names and remediates a missing API key", () => {
    expect(() => loadConfig({ STEAM_ID: "76561198000000000" })).toThrow(
      "Set STEAM_API_KEY in your environment and restart the server.",
    );
  });

  test("does not disclose the configured API key when another setting is blank", () => {
    const secret = "never-disclose-this-api-key";

    try {
      loadConfig({ STEAM_API_KEY: secret, STEAM_ID: "   " });
      throw new Error("expected loadConfig to reject a blank Steam ID");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("STEAM_ID");
      expect((error as Error).message).toContain("Set STEAM_ID");
      expect((error as Error).message).not.toContain(secret);
    }
  });
});
import { createSteamGame, createSteamLibrary } from "../src/domain/models.js";
import {
  ConfigError,
  GameNotFoundError,
  InputError,
  SteamResponseError,
  SteamTimeoutError,
  SteamUnavailableError,
} from "../src/errors.js";

describe("domain models", () => {
  test("keeps only documented game fields when optional data is present", () => {
    const game = createSteamGame({
      appId: 620,
      name: "Portal 2",
      playtimeMinutes: 135,
      recentPlaytimeMinutes: 42,
      lastPlayedAt: "2026-08-25T00:00:00.000Z",
      imageUrl: "https://cdn.example/portal-2.jpg",
      upstreamPayload: "must not cross the boundary",
    });

    expect(game).toEqual({
      appId: 620,
      name: "Portal 2",
      playtimeMinutes: 135,
      recentPlaytimeMinutes: 42,
      lastPlayedAt: "2026-08-25T00:00:00.000Z",
      imageUrl: "https://cdn.example/portal-2.jpg",
    });
  });

  test("retains usable identity when optional game fields are absent", () => {
    const game = createSteamGame({
      appId: 440,
      name: "Team Fortress 2",
      playtimeMinutes: 0,
    });
    const library = createSteamLibrary({
      steamId: "76561198000000000",
      games: [game],
      fetchedAt: "2026-08-25T00:00:00.000Z",
      ignored: true,
    });

    expect(game).toEqual({ appId: 440, name: "Team Fortress 2", playtimeMinutes: 0 });
    expect(library).toEqual({
      steamId: "76561198000000000",
      games: [game],
      fetchedAt: "2026-08-25T00:00:00.000Z",
    });
    expect(Object.isFrozen(game)).toBe(true);
    expect(Object.isFrozen(library.games)).toBe(true);
  });
});

describe("safe application errors", () => {
  test("serializes a configuration error with remediation but no cause", () => {
    const error = new ConfigError("STEAM_API_KEY");

    expect(error.safeMessage).toContain("Set STEAM_API_KEY");
    expect(JSON.stringify(error)).toBe(
      '{"code":"CONFIG_INVALID","message":"Missing required setting STEAM_API_KEY. Set STEAM_API_KEY in your environment and restart the server."}',
    );
  });

  test("hides an upstream cause from safe serialization", () => {
    const error = new SteamUnavailableError(new Error("raw Steam payload: secret-token"));

    expect(error.safeMessage).toBe("Steam is currently unavailable. Try again later.");
    expect(JSON.stringify(error)).toBe(
      '{"code":"STEAM_UNAVAILABLE","message":"Steam is currently unavailable. Try again later."}',
    );
    expect(Object.keys(error)).not.toContain("cause");
  });

  test("assigns stable safe messages to the remaining application errors", () => {
    expect(JSON.stringify(new InputError("The app ID must be positive."))).toBe(
      '{"code":"INPUT_INVALID","message":"The app ID must be positive."}',
    );
    expect(JSON.stringify(new SteamTimeoutError(new Error("upstream timeout body")))).toBe(
      '{"code":"STEAM_TIMEOUT","message":"Steam did not respond in time. Try again later."}',
    );
    expect(JSON.stringify(new SteamResponseError(new Error("raw invalid payload")))).toBe(
      '{"code":"STEAM_RESPONSE_INVALID","message":"Steam returned an invalid response. Try again later."}',
    );
    expect(JSON.stringify(new GameNotFoundError(730))).toBe(
      '{"code":"GAME_NOT_FOUND","message":"No accessible game was found for app ID 730."}',
    );
  });
});

describe("project tooling", () => {
  test("declares an ESM TypeScript runtime", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { type?: string };

    expect(manifest.type).toBe("module");
  });

  test("loads local environment files before starting the compiled server", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(manifest.scripts?.start).toBe("node --env-file=.env dist/index.js");
    expect(manifest.scripts?.dev).toBe("npm run build && npm run start");
  });
});
