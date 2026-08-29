import { PassThrough } from "node:stream";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { describe, expect, test, vi } from "vitest";

import { TtlCache } from "../src/cache/ttl-cache.js";
import { loadConfig } from "../src/config.js";
import { createServer, startStdioServer } from "../src/server.js";
import type { SteamApiClient } from "../src/steam/client.js";
import type { GamingTrackerService } from "../src/tracker/gaming-tracker-service.js";

const config = loadConfig({
  STEAM_API_KEY: "secret-api-key",
  STEAM_ID: "76561198000000000",
});

function createSteamClient(): SteamApiClient {
  return {
    getOwnedGames: vi.fn(async () => ({
      response: {
        games: [{ appid: 620, name: "Portal 2", playtime_forever: 135 }],
      },
    })),
    getRecentGames: vi.fn(async () => ({
      response: {
        games: [{ appid: 620, name: "Portal 2", playtime_forever: 135 }],
      },
    })),
  };
}

function createGamingTrackerService(): GamingTrackerService {
  return {
    getBacklog: vi.fn(async () => []),
    getCurrentGame: vi.fn(async () => null),
    getCompleted: vi.fn(async () => []),
    getStatuses: vi.fn(async () => []),
    mark: vi.fn(async (appId) => ({ outcome: "not_owned" as const, appId: appId as number })),
  };
}

describe("MCP server composition", () => {
  test("lists the complete task-enabled Steam, tracker, metadata, and intelligence surface", async () => {
    const steamClient = createSteamClient();
    const server = createServer({
      config,
      steamClient,
      cache: new TtlCache(),
      clock: { now: () => 0 },
      gamingTrackerService: createGamingTrackerService(),
    });
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const listedTools = await client.listTools();
    expect(listedTools.tools).toHaveLength(22);
    expect(listedTools).toMatchObject({
      tools: [
        { name: "steam_get_library" },
        { name: "steam_search_library" },
        { name: "steam_get_game" },
        { name: "steam_get_recent_games" },
        { name: "steam_get_library_stats" },
        {
          name: "gaming_get_backlog",
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
        },
        {
          name: "gaming_get_current_game",
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
        },
        {
          name: "gaming_mark_playing",
          inputSchema: {
            type: "object",
            properties: { appId: { type: "integer" } },
            additionalProperties: false,
          },
        },
        {
          name: "gaming_mark_completed",
          inputSchema: {
            type: "object",
            properties: { appId: { type: "integer" } },
            additionalProperties: false,
          },
        },
        {
          name: "gaming_mark_dropped",
          inputSchema: {
            type: "object",
            properties: { appId: { type: "integer" } },
            additionalProperties: false,
          },
        },
        {
          name: "gaming_get_completed",
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
        },
        { name: "steam_get_game_metadata" },
        { name: "steam_query_library_metadata" },
        { name: "recommendation_get_game_preference" },
        { name: "recommendation_set_game_preference" },
        { name: "recommendation_get_play_now" },
        { name: "backlog_create_plan" },
        { name: "backlog_list_active_plans" },
        { name: "backlog_update_plan_item_progress" },
        { name: "task_list" },
        { name: "task_get" },
        { name: "task_cancel" },
      ],
    });
    await expect(
      client.callTool({ name: "steam_get_recent_games", arguments: {} }),
    ).resolves.toMatchObject({
      content: [
        {
          type: "text",
          text: JSON.stringify([{ appId: 620, name: "Portal 2", playtimeMinutes: 135 }]),
        },
      ],
    });
    expect(steamClient.getRecentGames).toHaveBeenCalledWith(config.steamId, 10);

    const resources = await client.listResources();
    expect(resources.resources).toEqual(
      expect.arrayContaining([expect.objectContaining({ uri: "steam-library://tasks" })]),
    );
    const templates = await client.listResourceTemplates();
    expect(templates.resourceTemplates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ uriTemplate: "steam-library://tasks/{taskId}" }),
      ]),
    );

    await client.close();
    await server.close();
  });

  test("exposes protocol-defaulted empty content with the unavailable metadata envelope", async () => {
    const server = createServer({
      config,
      steamClient: createSteamClient(),
      cache: new TtlCache(),
      clock: { now: () => 0 },
      gamingTrackerService: createGamingTrackerService(),
    });
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    await expect(
      client.callTool({ name: "steam_get_game_metadata", arguments: { appId: 620 } }),
    ).resolves.toEqual({
      content: [],
      isError: true,
      error: {
        code: "METADATA_UNAVAILABLE",
        message: "Configure IGDB_CLIENT_ID and IGDB_CLIENT_SECRET to use metadata tools.",
        retryable: false,
      },
    });

    await client.close();
    await server.close();
  });

  test("keeps malformed stdio input and startup failures off stdout", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const transport = new StdioServerTransport(input, output);
    const errors: Error[] = [];
    transport.onerror = (error) => errors.push(error);
    await transport.start();

    input.write("not-json\n");
    await new Promise((resolve) => setImmediate(resolve));
    expect(errors).toHaveLength(1);
    expect(output.read()).toBeNull();
    await transport.close();

    const connect = vi.fn(async () => {
      throw new Error("secret-api-key must not be logged");
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(startStdioServer({ server: { connect } })).rejects.toThrow("secret-api-key");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
