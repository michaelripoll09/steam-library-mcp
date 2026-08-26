import { describe, expect, test, vi } from "vitest";
import { registerMetadataTools } from "../../src/tools/register-metadata-tools.js";
import type { ToolRegistrar } from "../../src/tools/register-steam-tools.js";
import type { MetadataService } from "../../src/services/metadata-service.js";

describe("metadata MCP tools", () => {
  test("registers the two owned-metadata tools and rejects invalid input before upstream calls", async () => {
    const tools = new Map<string, (input: unknown) => Promise<unknown>>();
    const server: ToolRegistrar = {
      registerTool: (name, _config, handler) => tools.set(name, handler),
    };
    const service = {
      getOwnedGameMetadata: vi.fn(async () => ({ appId: 620 })),
      queryOwnedMetadata: vi.fn(async () => []),
    } as unknown as MetadataService;
    registerMetadataTools(server, service);
    expect([...tools.keys()]).toEqual(["steam_get_game_metadata", "steam_query_library_metadata"]);
    await expect(tools.get("steam_get_game_metadata")?.({ appId: 0 })).resolves.toMatchObject({
      isError: true,
    });
    await expect(tools.get("steam_query_library_metadata")?.({})).resolves.toMatchObject({
      isError: true,
    });
    expect(service.getOwnedGameMetadata).not.toHaveBeenCalled();
    expect(service.queryOwnedMetadata).not.toHaveBeenCalled();
  });
});
