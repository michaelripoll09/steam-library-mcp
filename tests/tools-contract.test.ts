import { describe, expect, test, vi } from "vitest";

import {
  manualCollectionAddInputSchema,
  manualCollectionRemoveInputSchema,
  recentGamesInputSchema,
  searchLibraryInputSchema,
  steamGameInputSchema,
} from "../src/tools/schemas.js";
import { registerSteamTools, type ToolRegistrar } from "../src/tools/register-steam-tools.js";
import type { SteamService } from "../src/services/steam-service.js";

type ToolResult = Readonly<{
  content: readonly Readonly<{ type: "text"; text: string }>[];
  isError?: boolean;
}>;

type RegisteredTool = Readonly<{
  handler: (input: unknown) => Promise<ToolResult>;
}>;

function createRegistrar(): readonly [ToolRegistrar, Map<string, RegisteredTool>] {
  const tools = new Map<string, RegisteredTool>();
  const registrar: ToolRegistrar = {
    registerTool(name, _configuration, handler) {
      tools.set(name, { handler: handler as (input: unknown) => Promise<ToolResult> });
    },
  };

  return [registrar, tools];
}

function createService(): SteamService {
  return {
    getLibrary: vi.fn(async () => ({
      steamId: "76561198000000000",
      fetchedAt: "2026-08-25T00:00:00.000Z",
      games: [{ appId: 620, name: "Portal 2", playtimeMinutes: 135 }],
    })),
    refreshLibrary: vi.fn(async () => ({
      steamId: "76561198000000000",
      fetchedAt: "2026-08-25T00:00:00.000Z",
      games: [{ appId: 620, name: "Portal 2", playtimeMinutes: 135 }],
    })),
    searchLibrary: vi.fn(async () => [{ appId: 620, name: "Portal 2", playtimeMinutes: 135 }]),
    getGame: vi.fn(async () => ({ appId: 620, name: "Portal 2", playtimeMinutes: 135 })),
    getRecentGames: vi.fn(async () => [{ appId: 620, name: "Portal 2", playtimeMinutes: 135 }]),
    getLibraryStats: vi.fn(async () => ({
      totalGames: 1,
      playedGames: 1,
      unplayedGames: 0,
      totalPlaytimeMinutes: 135,
      recentlyPlayedGames: 0,
    })),
    getManualCollection: vi.fn(() => []),
    addManualCollection: vi.fn(async () => ({
      appId: 413150,
      name: "Stardew Valley",
      accessType: "manual" as const,
      isPlayable: false,
      createdAt: "2026-08-30T00:00:00.000Z",
      updatedAt: "2026-08-30T00:00:00.000Z",
    })),
    removeManualCollection: vi.fn(() => true),
  };
}

describe("Steam tool input schemas", () => {
  test("rejects blank search, non-positive app IDs, and invalid recent counts", () => {
    expect(searchLibraryInputSchema.safeParse({ query: "   " }).success).toBe(false);
    expect(steamGameInputSchema.safeParse({ appId: 0 }).success).toBe(false);
    expect(recentGamesInputSchema.safeParse({ count: 0 }).success).toBe(false);
    expect(recentGamesInputSchema.safeParse({ count: 51 }).success).toBe(false);
    expect(recentGamesInputSchema.safeParse({ count: 1.5 }).success).toBe(false);
    expect(manualCollectionAddInputSchema.safeParse({ steam: 413150 }).success).toBe(false);
    expect(manualCollectionRemoveInputSchema.safeParse({ appId: 0 }).success).toBe(false);
  });

  test("accepts documented values and defaults a missing recent-game count to ten", () => {
    expect(searchLibraryInputSchema.parse({ query: "Portal" })).toEqual({ query: "Portal" });
    expect(steamGameInputSchema.parse({ appId: 620 })).toEqual({ appId: 620 });
    expect(recentGamesInputSchema.parse({})).toEqual({ count: 10 });
    expect(recentGamesInputSchema.parse({ count: 50 })).toEqual({ count: 50 });
    expect(manualCollectionAddInputSchema.parse({ steam: "413150" })).toEqual({ steam: "413150" });
    expect(manualCollectionRemoveInputSchema.parse({ appId: 413150 })).toEqual({ appId: 413150 });
  });
});

describe("Steam MCP tools", () => {
  test("registers normalized Steam tools and manual collection operations", async () => {
    const [registrar, tools] = createRegistrar();
    const service = createService();

    registerSteamTools(registrar, service);

    expect([...tools.keys()]).toEqual([
      "steam_get_library",
      "steam_search_library",
      "steam_get_game",
      "steam_get_recent_games",
      "steam_get_library_stats",
      "steam_get_manual_collection",
      "steam_add_manual_collection",
      "steam_remove_manual_collection",
    ]);
    await expect(tools.get("steam_get_library")?.handler({})).resolves.toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            steamId: "76561198000000000",
            fetchedAt: "2026-08-25T00:00:00.000Z",
            games: [{ appId: 620, name: "Portal 2", playtimeMinutes: 135 }],
          }),
        },
      ],
    });
    await tools.get("steam_search_library")?.handler({ query: "Portal" });
    await tools.get("steam_get_game")?.handler({ appId: 620 });
    await tools.get("steam_get_recent_games")?.handler({});
    await tools.get("steam_get_library_stats")?.handler({});
    await tools.get("steam_get_manual_collection")?.handler({});
    await tools.get("steam_add_manual_collection")?.handler({ steam: "413150" });
    await tools.get("steam_remove_manual_collection")?.handler({ appId: 413150 });

    expect(service.searchLibrary).toHaveBeenCalledWith("Portal");
    expect(service.getGame).toHaveBeenCalledWith(620);
    expect(service.getRecentGames).toHaveBeenCalledWith(10);
    expect(service.getLibraryStats).toHaveBeenCalledOnce();
    expect(service.getManualCollection).toHaveBeenCalledOnce();
    expect(service.addManualCollection).toHaveBeenCalledWith("413150");
    expect(service.removeManualCollection).toHaveBeenCalledWith(413150);
  });

  test("rejects invalid inputs before contacting Steam and returns safe tool errors", async () => {
    const [registrar, tools] = createRegistrar();
    const service = createService();
    vi.mocked(service.searchLibrary).mockRejectedValueOnce(new Error("secret-api-key"));
    registerSteamTools(registrar, service);

    const invalidSearch = await tools.get("steam_search_library")?.handler({ query: " " });
    const invalidApp = await tools.get("steam_get_game")?.handler({ appId: 0 });
    const invalidCount = await tools.get("steam_get_recent_games")?.handler({ count: 51 });
    const serviceFailure = await tools.get("steam_search_library")?.handler({ query: "Portal" });

    expect(invalidSearch).toMatchObject({ isError: true });
    expect(invalidApp).toMatchObject({ isError: true });
    expect(invalidCount).toMatchObject({ isError: true });
    expect(service.searchLibrary).toHaveBeenCalledTimes(1);
    expect(service.getGame).not.toHaveBeenCalled();
    expect(service.getRecentGames).not.toHaveBeenCalled();
    expect(serviceFailure?.content[0]?.text).not.toContain("secret-api-key");
  });
});
