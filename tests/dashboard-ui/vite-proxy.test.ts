import type { Server } from "node:http";
import { once } from "node:events";

import { afterEach, describe, expect, test, vi } from "vitest";
import { createServer as createViteServer, type ViteDevServer } from "vite";

import type { DashboardLibrary } from "../../src/dashboard/contracts.js";
import { createDashboardHttpServer } from "../../src/dashboard/http/server.js";

const library: DashboardLibrary = {
  games: [],
  totals: { totalGames: 0, playedGames: 0, unplayedGames: 0, totalPlaytimeMinutes: 0 },
  statusStats: { backlog: 0, playing: 0, completed: 0, dropped: 0, paused: 0 },
};

let dashboardServer: Server | undefined;
let viteServer: ViteDevServer | undefined;

afterEach(async () => {
  await viteServer?.close();
  viteServer = undefined;
  await closeServer(dashboardServer);
  dashboardServer = undefined;
});

describe("Vite dashboard API proxy", () => {
  test("forwards library reads through the loopback dashboard server", async () => {
    const { baseUrl, getLibrary } = await startProxy();

    const response = await fetch(`${baseUrl}/api/library`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(library);
    expect(getLibrary).toHaveBeenCalledTimes(1);
  });

  test("rewrites mutating request origins for sync and status updates", async () => {
    const { baseUrl, syncLibrary, updateStatus } = await startProxy();

    const syncResponse = await fetch(`${baseUrl}/api/library/sync`, {
      method: "POST",
      headers: { Origin: baseUrl },
    });
    const statusResponse = await fetch(`${baseUrl}/api/games/42/status`, {
      method: "PATCH",
      headers: { Origin: baseUrl, "Content-Type": "application/json" },
      body: JSON.stringify({ status: "completed" }),
    });

    expect(syncResponse.status).toBe(200);
    expect(statusResponse.status).toBe(200);
    expect(syncLibrary).toHaveBeenCalledTimes(1);
    expect(updateStatus).toHaveBeenCalledWith(42, "completed");
  });
});

async function startProxy() {
  const getLibrary = vi.fn(async () => library);
  const syncLibrary = vi.fn(async () => library);
  const updateStatus = vi.fn(async () => ({
    mark: { outcome: "updated" as const, appId: 42, status: "completed" as const },
    library,
  }));
  dashboardServer = createDashboardHttpServer({
    dashboardService: { getLibrary, syncLibrary, updateStatus },
  });
  dashboardServer.listen(4173, "127.0.0.1");
  await once(dashboardServer, "listening");

  viteServer = await createViteServer({
    configFile: "vite.config.ts",
    server: { host: "127.0.0.1", port: 0 },
  });
  await viteServer.listen();
  const address = viteServer.httpServer?.address();
  if (address === null || typeof address !== "object") throw new Error("Vite server did not bind.");

  return { baseUrl: `http://127.0.0.1:${address.port}`, getLibrary, syncLibrary, updateStatus };
}

async function closeServer(server: Server | undefined): Promise<void> {
  if (server === undefined || !server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}
