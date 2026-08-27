import { afterEach, describe, expect, test, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";

import { InputError, SteamUnavailableError } from "../../src/errors.js";
import { createDashboardHttpServer } from "../../src/dashboard/http/server.js";
import type { DashboardLibrary, DashboardStatusUpdate } from "../../src/dashboard/contracts.js";

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
) {
  const server = createDashboardHttpServer({ dashboardService: service, staticRoot, port: 0 });
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
});
