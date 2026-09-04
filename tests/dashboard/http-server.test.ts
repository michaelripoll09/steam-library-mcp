import { afterEach, describe, expect, test, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";

import { InputError, SteamUnavailableError } from "../../src/errors.js";
import { createDashboardHttpServer } from "../../src/dashboard/http/server.js";
import type { DashboardLibrary, DashboardStatusUpdate } from "../../src/dashboard/contracts.js";
import type { ArtworkResolver } from "../../src/dashboard/artwork-resolver.js";

const library: DashboardLibrary = {
  games: [],
  totals: { totalGames: 0, playedGames: 0, unplayedGames: 0, totalPlaytimeMinutes: 0 },
  statusStats: { backlog: 0, playing: 0, completed: 0, dropped: 0, paused: 0 },
};

const update: DashboardStatusUpdate = {
  mark: { outcome: "updated", appId: 10, status: "playing" },
  library,
};

function startServer(
  service: {
    getLibrary: () => Promise<DashboardLibrary>;
    syncLibrary: () => Promise<DashboardLibrary>;
    updateStatus: (appId: unknown, status: unknown) => Promise<DashboardStatusUpdate>;
  },
  staticRoot: string,
  artworkResolver?: ArtworkResolver,
) {
  const server = createDashboardHttpServer({
    dashboardService: service as never,
    staticRoot,
    artworkResolver,
    port: 0,
  });
  return new Promise<{ server: ReturnType<typeof createDashboardHttpServer>; port: number }>(
    (resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (address === null || typeof address === "string") throw new Error("not listening");
        resolve({ server, port: address.port });
      });
    },
  );
}

function call(
  port: number,
  path: string,
  options: { method?: string; body?: string; headers?: Record<string, string> } = {},
) {
  return new Promise<{
    status: number;
    headers: Record<string, string | string[] | undefined>;
    body: string;
  }>((resolve, reject) => {
    const req = request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: options.method ?? "GET",
        headers: options.headers,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.on("error", reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

describe("dashboard HTTP server", () => {
  let root: string | undefined;
  let server: ReturnType<typeof createDashboardHttpServer> | undefined;

  afterEach(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  async function setup() {
    root = await mkdtemp(join(tmpdir(), "dashboard-http-"));
    await writeFile(join(root, "index.html"), "<!doctype html><title>Dashboard</title>");
    const service = {
      getLibrary: vi.fn(async () => library),
      syncLibrary: vi.fn(async () => library),
      updateStatus: vi.fn(async () => update),
    };
    const started = await startServer(service, root);
    server = started.server;
    return { ...started, service };
  }

  test("routes library, sync, and exact status update payloads", async () => {
    const { port, service } = await setup();
    expect((await call(port, "/api/library")).status).toBe(200);
    expect(service.getLibrary).toHaveBeenCalledOnce();
    expect((await call(port, "/api/library/sync", { method: "POST" })).status).toBe(200);
    expect(service.syncLibrary).toHaveBeenCalledOnce();
    const response = await call(port, "/api/games/10/status", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "playing" }),
    });
    expect(response.status).toBe(200);
    expect(service.updateStatus).toHaveBeenCalledWith(10, "playing");
    expect(JSON.parse(response.body)).toEqual(update);
  });

  test("does not expose a Steam Families status endpoint", async () => {
    const { port } = await setup();
    expect((await call(port, "/api/steam-families/status")).status).toBe(404);
  });

  test("rejects malformed, oversized, invalid, and unknown API requests safely", async () => {
    const { port, service } = await setup();
    expect(
      (
        await call(port, "/api/games/0/status", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: '{"status":"playing"}',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call(port, "/api/games/10/status", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: '{"status":"backlog"}',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call(port, "/api/games/10/status", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: "{",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call(port, "/api/games/10/status", {
          method: "PATCH",
          headers: { "content-type": "text/plain" },
          body: '{"status":"playing"}',
        })
      ).status,
    ).toBe(415);
    expect((await call(port, "/api/nope")).status).toBe(404);
    expect(service.updateStatus).not.toHaveBeenCalled();
  });

  test("does not resolve artwork for app IDs outside the configured library", async () => {
    root = await mkdtemp(join(tmpdir(), "dashboard-http-"));
    await writeFile(join(root, "index.html"), "<!doctype html><title>Dashboard</title>");
    const service = {
      getLibrary: vi.fn(async () => library),
      syncLibrary: vi.fn(async () => library),
      updateStatus: vi.fn(async () => update),
    };
    const artworkResolver: ArtworkResolver = { resolve: vi.fn(async () => undefined) };
    const started = await startServer(service, root, artworkResolver);
    server = started.server;

    expect((await call(started.port, "/api/artwork/999")).status).toBe(404);
    expect(service.getLibrary).toHaveBeenCalledOnce();
    expect(artworkResolver.resolve).not.toHaveBeenCalled();
  });

  test("enforces local host/origin and security headers", async () => {
    const { port } = await setup();
    const mismatch = await call(port, "/api/library", { headers: { host: "evil.example" } });
    expect(mismatch.status).toBe(403);
    const origin = await call(port, "/api/library/sync", {
      method: "POST",
      headers: { origin: "https://evil.example" },
    });
    expect(origin.status).toBe(403);
    const response = await call(port, "/");
    expect(response.status).toBe(200);
    expect(response.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(response.headers["content-security-policy"]).toContain(
      "img-src 'self' https://cdn.cloudflare.steamstatic.com",
    );
    expect(response.headers["content-security-policy"]).not.toContain(
      "shared.cloudflare.steamstatic.com",
    );
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  test("serves static assets, HEAD, SPA fallback, and API 404 separately", async () => {
    const { port } = await setup();
    await writeFile(join(root as string, "app.js"), "console.log('ok')");
    const asset = await call(port, "/app.js");
    expect(asset.status).toBe(200);
    expect(asset.headers["content-type"]).toContain("application/javascript");
    const head = await call(port, "/app.js", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.body).toBe("");
    expect((await call(port, "/nested/route")).status).toBe(200);
    expect((await call(port, "/missing.js")).status).toBe(404);
    expect((await call(port, "/api/missing")).status).toBe(404);
  });

  test("maps safe errors and hides unexpected causes", async () => {
    const secret = "raw-secret-token";
    const { port, service } = await setup();
    service.getLibrary.mockRejectedValueOnce(new SteamUnavailableError(new Error(secret)));
    const safe = await call(port, "/api/library");
    expect(safe.status).toBe(503);
    expect(safe.body).not.toContain(secret);
    service.getLibrary.mockRejectedValueOnce(new Error(secret));
    const generic = await call(port, "/api/library");
    expect(generic.status).toBe(500);
    expect(generic.body).not.toContain(secret);
    service.updateStatus.mockRejectedValueOnce(new InputError("bad status"));
  });
  test("serves artwork orientation metadata with the cached image", async () => {
    root = await mkdtemp(join(tmpdir(), "dashboard-http-"));
    const artworkFile = join(root, "cover.img");
    await Promise.all([
      writeFile(join(root, "index.html"), "<!doctype html><title>Dashboard</title>"),
      writeFile(artworkFile, new Uint8Array([1, 2, 3])),
    ]);
    const service = {
      getLibrary: vi.fn(async () => ({
        ...library,
        games: [
          {
            appId: 10,
            name: "Celeste",
            status: "backlog",
            coverUrl: "/api/artwork/10",
            accessType: "owned",
            isPlayable: true,
            playtimeMinutes: 0,
          },
        ] as const,
      })),
      syncLibrary: vi.fn(async () => library),
      updateStatus: vi.fn(async () => update),
    };
    const artworkResolver: ArtworkResolver = {
      resolve: vi.fn(async () => ({
        filePath: artworkFile,
        contentType: "image/jpeg",
        orientation: "portrait" as const,
      })),
    };
    const started = await startServer(service, root, artworkResolver);
    server = started.server;

    const response = await call(started.port, "/api/artwork/10");
    expect(response.status).toBe(200);
    expect(response.headers["x-artwork-orientation"]).toBe("portrait");
    expect(artworkResolver.resolve).toHaveBeenCalledWith(10, "Celeste");
  });

  test("routes intelligence reads and explicit local preference and plan writes", async () => {
    const { port, service } = await setup();
    Object.assign(service, {
      getIntelligenceSnapshot: vi.fn(async () => ({ library: { totalGames: 0 } })),
      getRecommendations: vi.fn(async (availableMinutes: number) => ({
        availableMinutes,
        recommendations: [],
      })),
      getPreference: vi.fn((appId: number) => ({
        appId,
        priority: "normal",
        excludedFromRecommendations: false,
        playMode: "any",
      })),
      savePreference: vi.fn((appId: number, preference: unknown) => ({
        appId,
        ...(preference as object),
      })),
      listPlans: vi.fn(() => []),
      createPlan: vi.fn(async (request: unknown) => ({
        plan: { id: "weekly-1", ...(request as object), items: [] },
        shortfall: null,
      })),
      updatePlanItemProgress: vi.fn(async (_planId: string, _itemId: string, progress: string) => ({
        progress,
      })),
    });
    const intelligenceService = service as unknown as {
      getIntelligenceSnapshot: ReturnType<typeof vi.fn>;
      getRecommendations: ReturnType<typeof vi.fn>;
      savePreference: ReturnType<typeof vi.fn>;
      createPlan: ReturnType<typeof vi.fn>;
      updatePlanItemProgress: ReturnType<typeof vi.fn>;
    };

    expect((await call(port, "/api/intelligence/insights")).status).toBe(200);
    expect(
      JSON.parse((await call(port, "/api/intelligence/recommendations?availableMinutes=45")).body),
    ).toEqual({ availableMinutes: 45, recommendations: [] });
    await call(port, "/api/games/10/preference", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        priority: "high",
        excludedFromRecommendations: false,
        playMode: "solo",
      }),
    });
    await call(port, "/api/backlog-plans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cadence: "weekly", availableMinutes: 45, targetGameCount: 2 }),
    });
    await call(port, "/api/backlog-plans/weekly-1/items/weekly-1%3A1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ progress: "done" }),
    });

    expect(intelligenceService.getIntelligenceSnapshot).toHaveBeenCalledOnce();
    expect(intelligenceService.getRecommendations).toHaveBeenCalledWith(45);
    expect(intelligenceService.savePreference).toHaveBeenCalledWith(10, {
      priority: "high",
      excludedFromRecommendations: false,
      playMode: "solo",
    });
    expect(intelligenceService.createPlan).toHaveBeenCalledWith({
      cadence: "weekly",
      availableMinutes: 45,
      targetGameCount: 2,
    });
    expect(intelligenceService.updatePlanItemProgress).toHaveBeenCalledWith(
      "weekly-1",
      "weekly-1:1",
      "done",
    );
  });

  test("rejects malformed intelligence input without invoking local mutations", async () => {
    const { port, service } = await setup();
    Object.assign(service, {
      getRecommendations: vi.fn(),
      savePreference: vi.fn(),
      createPlan: vi.fn(),
      updatePlanItemProgress: vi.fn(),
    });
    expect((await call(port, "/api/intelligence/recommendations?availableMinutes=0")).status).toBe(
      400,
    );
    expect(
      (
        await call(port, "/api/games/10/preference", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ priority: "wrong" }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call(port, "/api/backlog-plans", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cadence: "daily", availableMinutes: 0, targetGameCount: 0 }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call(port, "/api/backlog-plans/plan/items/item", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ progress: "invalid" }),
        })
      ).status,
    ).toBe(400);
    expect(
      (service as unknown as { getRecommendations: ReturnType<typeof vi.fn> }).getRecommendations,
    ).not.toHaveBeenCalled();
  });

  test("rejects cross-origin preference writes before invoking local mutations", async () => {
    const { port, service } = await setup();
    Object.assign(service, {
      savePreference: vi.fn(() => ({
        appId: 10,
        priority: "high",
        excludedFromRecommendations: false,
        playMode: "solo",
      })),
    });

    const response = await call(port, "/api/games/10/preference", {
      method: "PUT",
      headers: {
        origin: "https://evil.example",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        priority: "high",
        excludedFromRecommendations: false,
        playMode: "solo",
      }),
    });

    expect(response.status).toBe(403);
    expect(
      (service as unknown as { savePreference: ReturnType<typeof vi.fn> }).savePreference,
    ).not.toHaveBeenCalled();
  });

  test("updates manual collection access metadata with an exact PATCH payload", async () => {
    const { port, service } = await setup();
    Object.assign(service, {
      updateManualCollection: vi.fn(async () => ({
        appId: 1245620,
        name: "ELDEN RING",
        accessType: "family",
        isPlayable: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      })),
    });
    const manualCollectionService = service as unknown as {
      updateManualCollection: ReturnType<typeof vi.fn>;
    };

    const response = await call(port, "/api/manual-collection/1245620", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accessType: "family", isPlayable: true }),
    });

    expect(response.status).toBe(200);
    expect(manualCollectionService.updateManualCollection).toHaveBeenCalledWith(1245620, {
      accessType: "family",
      isPlayable: true,
    });
    expect(JSON.parse(response.body)).toMatchObject({ accessType: "family", isPlayable: true });
  });

  test("rejects empty manual collection PATCH payloads", async () => {
    const { port, service } = await setup();
    Object.assign(service, { updateManualCollection: vi.fn() });

    const response = await call(port, "/api/manual-collection/1245620", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "INPUT_INVALID", message: "At least one access field must be provided." },
    });
    expect(
      (service as unknown as { updateManualCollection: ReturnType<typeof vi.fn> })
        .updateManualCollection,
    ).not.toHaveBeenCalled();
  });

  test("rejects cross-origin manual collection deletes and permits same-origin deletes", async () => {
    const { port, service } = await setup();
    Object.assign(service, { removeManualCollection: vi.fn(() => true) });
    const manualCollectionService = service as unknown as {
      removeManualCollection: ReturnType<typeof vi.fn>;
    };

    const rejected = await call(port, "/api/manual-collection/10", {
      method: "DELETE",
      headers: { origin: "https://evil.example" },
    });

    expect(rejected.status).toBe(403);
    expect(manualCollectionService.removeManualCollection).not.toHaveBeenCalled();

    const permitted = await call(port, "/api/manual-collection/10", {
      method: "DELETE",
      headers: { origin: `http://127.0.0.1:${port}` },
    });

    expect(permitted.status).toBe(200);
    expect(manualCollectionService.removeManualCollection).toHaveBeenCalledWith(10);
  });

  test("returns not found when cached artwork is evicted before its stream opens", async () => {
    root = await mkdtemp(join(tmpdir(), "dashboard-http-"));
    const artworkFile = join(root, "cover.img");
    await Promise.all([
      writeFile(join(root, "index.html"), "<!doctype html><title>Dashboard</title>"),
      writeFile(artworkFile, new Uint8Array([1, 2, 3])),
    ]);
    const service = {
      getLibrary: vi.fn(async () => ({
        ...library,
        games: [
          {
            appId: 10,
            name: "Celeste",
            status: "backlog",
            coverUrl: "/api/artwork/10",
            accessType: "owned",
            isPlayable: true,
            playtimeMinutes: 0,
          },
        ] as const,
      })),
      syncLibrary: vi.fn(async () => library),
      updateStatus: vi.fn(async () => update),
    };
    const artworkResolver: ArtworkResolver = {
      resolve: vi.fn(async () => {
        await rm(artworkFile);
        return {
          filePath: artworkFile,
          contentType: "image/jpeg",
          orientation: "portrait" as const,
        };
      }),
    };
    const started = await startServer(service, root, artworkResolver);
    server = started.server;

    const response = await call(started.port, "/api/artwork/10");

    expect(response.status).toBe(404);
    expect(JSON.parse(response.body)).toEqual({
      error: { code: "NOT_FOUND", message: "Artwork not found." },
    });
  });
});
