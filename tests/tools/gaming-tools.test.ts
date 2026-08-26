import { describe, expect, test, vi } from "vitest";

import type { ToolRegistrar } from "../../src/tools/register-steam-tools.js";
import { registerGamingTools } from "../../src/tools/register-gaming-tools.js";
import type { GamingTrackerService } from "../../src/tracker/gaming-tracker-service.js";

type Result = { content: readonly { type: "text"; text: string }[]; isError?: boolean };

function setup() {
  const tools = new Map<string, (input: unknown) => Promise<Result>>();
  const registrar: ToolRegistrar = {
    registerTool(name, _config, handler) {
      tools.set(name, handler);
    },
  };
  const service: GamingTrackerService = {
    getBacklog: vi.fn(async () => []),
    getCurrentGame: vi.fn(async () => null),
    getCompleted: vi.fn(async () => []),
    mark: vi.fn(async (appId, status) => ({
      outcome: "updated" as const,
      appId: appId as number,
      status,
    })),
  };
  registerGamingTools(registrar, service);
  return { tools, service };
}

describe("gaming MCP tools", () => {
  test("registers the six strict tracker tools with canonical empty results", async () => {
    const { tools } = setup();
    expect([...tools.keys()]).toEqual([
      "gaming_get_backlog",
      "gaming_get_current_game",
      "gaming_mark_playing",
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
  });

  test("validates mark input before invoking the service and preserves success contracts", async () => {
    const { tools, service } = setup();
    await expect(tools.get("gaming_mark_playing")?.({ appId: 620 })).resolves.toMatchObject({
      content: [{ text: '{"outcome":"updated","appId":620,"status":"playing"}' }],
    });
    await expect(tools.get("gaming_mark_completed")?.({ appId: 0 })).resolves.toMatchObject({
      isError: true,
      content: [
        { text: '{"code":"INVALID_INPUT","message":"appId must be a positive safe integer."}' },
      ],
    });
    expect(service.mark).toHaveBeenCalledTimes(1);
    expect(service.mark).toHaveBeenCalledWith(620, "playing");
  });
});
