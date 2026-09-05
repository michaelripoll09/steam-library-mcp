import { describe, expect, test, vi } from "vitest";

import type { ToolRegistrar } from "../../src/tools/register-steam-tools.js";
import { TrackerPersistenceError } from "../../src/errors.js";
import { registerGamingTools } from "../../src/tools/register-gaming-tools.js";
import type { GamingTrackerService } from "../../src/tracker/gaming-tracker-service.js";

type Result = { content: readonly { type: "text"; text: string }[]; isError?: boolean };

function setup() {
  const tools = new Map<string, (input: unknown) => Promise<Result>>();
  const configurations = new Map<string, { inputSchema?: unknown }>();
  const registrar: ToolRegistrar = {
    registerTool(name, config, handler) {
      tools.set(name, handler);
      configurations.set(name, config);
    },
  };
  const service: GamingTrackerService = {
    getBacklog: vi.fn(async () => []),
    getCurrentGame: vi.fn(async () => null),
    getCompleted: vi.fn(async () => []),
    getStatuses: vi.fn(async () => []),
    mark: vi.fn(async (appId, status) => ({
      outcome: "updated" as const,
      appId: appId as number,
      status,
    })),
  };
  registerGamingTools(registrar, service);
  return { configurations, tools, service };
}

describe("gaming MCP tools", () => {
  test("registers the seven strict tracker tools with canonical empty results", async () => {
    const { configurations, tools } = setup();
    expect([...tools.keys()]).toEqual([
      "gaming_get_backlog",
      "gaming_get_current_game",
      "gaming_mark_playing",
      "gaming_mark_paused",
      "gaming_mark_completed",
      "gaming_mark_dropped",
      "gaming_get_completed",
    ]);
    await expect(tools.get("gaming_get_backlog")?.({})).resolves.toMatchObject({
      content: [{ text: '{"games":[]}' }],
    });
    await expect(tools.get("gaming_get_current_game")?.({})).resolves.toMatchObject({
      content: [{ text: '{"game":null}' }],
    });
    await expect(tools.get("gaming_get_completed")?.({})).resolves.toMatchObject({
      content: [{ text: '{"games":[]}' }],
    });
    for (const name of ["gaming_get_backlog", "gaming_get_current_game", "gaming_get_completed"]) {
      expect(configurations.get(name)?.inputSchema).toMatchObject({});
      await expect(tools.get(name)?.({ unexpected: true })).resolves.toMatchObject({
        isError: true,
        content: [
          {
            text: '{"error":{"code":"INVALID_INPUT","message":"appId must be a positive safe integer."}}',
          },
        ],
      });
    }
  });

  test("validates mark input before invoking the service and preserves success contracts", async () => {
    const { tools, service } = setup();
    await expect(tools.get("gaming_mark_playing")?.({ appId: 620 })).resolves.toMatchObject({
      content: [{ text: '{"outcome":"updated","appId":620,"status":"playing"}' }],
    });
    await expect(tools.get("gaming_mark_paused")?.({ appId: 620 })).resolves.toMatchObject({
      content: [{ text: '{"outcome":"updated","appId":620,"status":"paused"}' }],
    });
    await expect(tools.get("gaming_mark_completed")?.({ appId: 0 })).resolves.toMatchObject({
      isError: true,
      content: [
        {
          text: '{"error":{"code":"INVALID_INPUT","message":"appId must be a positive safe integer."}}',
        },
      ],
    });
    expect(service.mark).toHaveBeenCalledTimes(2);
    expect(service.mark).toHaveBeenCalledWith(620, "playing");
    expect(service.mark).toHaveBeenCalledWith(620, "paused");
  });

  test.each([
    "gaming_mark_playing",
    "gaming_mark_paused",
    "gaming_mark_completed",
    "gaming_mark_dropped",
  ])(
    "rejects unknown keys for strict mark schema %s",
    async (name) => {
      const { service, tools } = setup();

      await expect(tools.get(name)?.({ appId: 620, unexpected: true })).resolves.toMatchObject({
        isError: true,
        content: [
          {
            text: '{"error":{"code":"INVALID_INPUT","message":"appId must be a positive safe integer."}}',
          },
        ],
      });
      expect(service.mark).not.toHaveBeenCalled();
    },
  );

  test("wraps tracker persistence errors in the canonical nested error envelope", async () => {
    const { service, tools } = setup();
    vi.mocked(service.mark).mockRejectedValueOnce(
      new TrackerPersistenceError(new Error("SQLITE_BUSY C:/private/tracker.sqlite")),
    );

    await expect(tools.get("gaming_mark_playing")?.({ appId: 620 })).resolves.toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: '{"error":{"code":"PERSISTENCE_FAILURE","message":"Tracker storage is unavailable. Check the database path and try again."}}',
        },
      ],
    });
  });
});
