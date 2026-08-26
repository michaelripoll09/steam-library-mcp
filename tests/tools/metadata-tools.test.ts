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

  test("accepts bounded query limits and returns unavailable metadata as the exact top-level envelope", async () => {
    const tools = new Map<string, (input: unknown) => Promise<unknown>>();
    const server: ToolRegistrar = {
      registerTool: (name, _config, handler) => tools.set(name, handler),
    };
    const unavailable = {
      isError: true as const,
      error: {
        code: "METADATA_UNAVAILABLE" as const,
        message: "Configure IGDB_CLIENT_ID and IGDB_CLIENT_SECRET to use metadata tools.",
        retryable: false,
      },
    };
    const service = {
      getOwnedGameMetadata: vi.fn(async () => unavailable),
      queryOwnedMetadata: vi.fn(async () => unavailable),
    } as unknown as MetadataService;
    registerMetadataTools(server, service);

    await expect(
      tools.get("steam_query_library_metadata")?.({ genres: ["puzzle"], limit: 1 }),
    ).resolves.toEqual(unavailable);
    await expect(
      tools.get("steam_query_library_metadata")?.({ genres: ["puzzle"], limit: 0 }),
    ).resolves.toMatchObject({ isError: true });
    await expect(
      tools.get("steam_query_library_metadata")?.({ genres: ["puzzle"], limit: 51 }),
    ).resolves.toMatchObject({ isError: true });
    await expect(
      tools.get("steam_query_library_metadata")?.({ releaseYearFrom: 2025, releaseYearTo: 2024 }),
    ).resolves.toMatchObject({ isError: true });
    expect(service.queryOwnedMetadata).toHaveBeenCalledTimes(1);
    expect(service.queryOwnedMetadata).toHaveBeenCalledWith({ genres: ["puzzle"], limit: 1 });
  });

  test("passes successful query payloads through the normal MCP content response", async () => {
    const tools = new Map<string, (input: unknown) => Promise<unknown>>();
    const server: ToolRegistrar = {
      registerTool: (name, _config, handler) => tools.set(name, handler),
    };
    const payload = [{ appId: 620, metadataStatus: "complete" }];
    const service = {
      getOwnedGameMetadata: vi.fn(),
      queryOwnedMetadata: vi.fn(async () => payload),
    } as unknown as MetadataService;
    registerMetadataTools(server, service);

    await expect(
      tools.get("steam_query_library_metadata")?.({ genres: ["puzzle"] }),
    ).resolves.toEqual({ content: [{ type: "text", text: JSON.stringify(payload) }] });
    expect(service.queryOwnedMetadata).toHaveBeenCalledWith({ genres: ["puzzle"], limit: 50 });
  });
});
