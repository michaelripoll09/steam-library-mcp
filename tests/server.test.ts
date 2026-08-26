import { PassThrough } from "node:stream";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { describe, expect, test, vi } from "vitest";

import { TtlCache } from "../src/cache/ttl-cache.js";
import { loadConfig } from "../src/config.js";
import { createServer, startStdioServer } from "../src/server.js";
import type { SteamApiClient } from "../src/steam/client.js";

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

describe("MCP server composition", () => {
  test("connects an injected Steam service through exactly five MCP tools", async () => {
    const steamClient = createSteamClient();
    const server = createServer({
      config,
      steamClient,
      cache: new TtlCache(),
      clock: { now: () => 0 },
    });
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    await expect(client.listTools()).resolves.toMatchObject({
      tools: [
        { name: "steam_get_library" },
        { name: "steam_search_library" },
        { name: "steam_get_game" },
        { name: "steam_get_recent_games" },
        { name: "steam_get_library_stats" },
        { name: "gaming_get_backlog" },
        { name: "gaming_get_current_game" },
        { name: "gaming_mark_playing" },
        { name: "gaming_mark_completed" },
        { name: "gaming_mark_dropped" },
        { name: "gaming_get_completed" },
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
