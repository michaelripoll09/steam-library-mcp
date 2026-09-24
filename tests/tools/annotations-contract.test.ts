import { describe, expect, test, vi } from "vitest";

import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { registerAchievementTools } from "../../src/tools/register-achievement-tools.js";
import { registerGamingTools } from "../../src/tools/register-gaming-tools.js";
import { registerIntelligenceTools } from "../../src/tools/register-intelligence-tools.js";
import { registerMetadataTools } from "../../src/tools/register-metadata-tools.js";
import type { ToolRegistrar } from "../../src/tools/register-steam-tools.js";
import { registerSteamTools } from "../../src/tools/register-steam-tools.js";
import { registerTaskTools } from "../../src/tools/register-task-tools.js";

type Captured = Readonly<{
  description: string;
  annotations?: ToolAnnotations;
}>;

function captureAllTools(): Map<string, Captured> {
  const tools = new Map<string, Captured>();
  const registrar: ToolRegistrar = {
    registerTool(name, configuration) {
      if (tools.has(name)) throw new Error(`duplicate tool registration: ${name}`);
      tools.set(name, {
        description: configuration.description,
        annotations: configuration.annotations,
      });
    },
  };
  const stub = new Proxy({}, { get: () => vi.fn() }) as never;
  registerSteamTools(registrar, stub);
  registerAchievementTools(registrar, stub);
  registerGamingTools(registrar, stub);
  registerMetadataTools(registrar, stub);
  registerIntelligenceTools(registrar, {
    preferences: stub,
    recommendations: stub,
    plans: stub,
  });
  registerTaskTools(registrar, stub);
  return tools;
}

const EXPECTED: Readonly<Record<string, Omit<Required<ToolAnnotations>, "title">>> = {
  steam_get_library: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  steam_search_library: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  steam_get_game: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  steam_get_recent_games: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  steam_get_library_stats: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  steam_get_manual_collection: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  steam_add_manual_collection: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  steam_update_manual_collection: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  steam_remove_manual_collection: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  steam_get_game_achievements: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  gaming_get_backlog: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  gaming_get_current_game: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  gaming_mark_playing: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  gaming_mark_paused: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  gaming_mark_completed: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  gaming_mark_dropped: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  gaming_get_completed: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  steam_get_game_metadata: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  steam_query_library_metadata: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  recommendation_get_game_preference: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  recommendation_set_game_preference: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  recommendation_get_play_now: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  backlog_create_plan: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  backlog_list_active_plans: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  backlog_update_plan_item_progress: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  task_list: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  task_get: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  task_cancel: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
};

describe("MCP tool annotation contract", () => {
  test("registers every expected tool exactly once with audited annotations", () => {
    const tools = captureAllTools();

    expect([...tools.keys()].sort()).toEqual(Object.keys(EXPECTED).sort());
    expect(tools.size).toBe(28);
    for (const [name, expected] of Object.entries(EXPECTED)) {
      const actual = tools.get(name);
      expect(actual?.description, `${name} description`).toMatch(/.+/);
      expect(actual?.annotations, `${name} annotations`).toEqual(expected);
    }
  });
});
