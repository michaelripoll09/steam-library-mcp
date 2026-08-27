// @vitest-environment jsdom

import { describe, expect, test, vi } from "vitest";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

type DashboardApiModule = Readonly<{
  createDashboardApi: (fetch: FetchLike) => Readonly<{
    getLibrary: () => Promise<unknown>;
    syncLibrary: () => Promise<unknown>;
    updateGameStatus: (appId: number, status: string) => Promise<unknown>;
  }>;
  DashboardApiError: new (status: number, code: string | undefined, message: string) => Error;
}>;

async function loadApi(): Promise<DashboardApiModule | undefined> {
  return import("../../dashboard-ui/src/api.js").catch(() => undefined) as Promise<
    DashboardApiModule | undefined
  >;
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
  } as Response;
}

describe("dashboard browser API", () => {
  test("uses the relative library endpoint with an exact GET request", async () => {
    const module = await loadApi();
    expect(module).toBeDefined();
    if (module === undefined) return;
    const fetch = vi.fn<FetchLike>().mockResolvedValue(jsonResponse({ games: [] }));

    await module.createDashboardApi(fetch).getLibrary();

    expect(fetch.mock.calls).toEqual([["/api/library", { method: "GET" }]]);
  });

  test("uses exact sync and status update requests without caller-provided headers", async () => {
    const module = await loadApi();
    expect(module).toBeDefined();
    if (module === undefined) return;
    const fetch = vi.fn<FetchLike>().mockResolvedValue(jsonResponse({ games: [] }));
    const api = module.createDashboardApi(fetch);

    await api.syncLibrary();
    await api.updateGameStatus(42, "completed");

    expect(fetch.mock.calls).toEqual([
      ["/api/library/sync", { method: "POST" }],
      [
        "/api/games/42/status",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "completed" }),
        },
      ],
    ]);
  });

  test("uses a safe fallback when a non-success response cannot provide an API error", async () => {
    const module = await loadApi();
    expect(module).toBeDefined();
    if (module === undefined) return;
    const fetch = vi.fn<FetchLike>().mockResolvedValue({
      ok: false,
      status: 503,
      headers: new Headers({ "content-type": "text/plain" }),
      json: async () => {
        throw new Error("Unexpected HTML response");
      },
    } as unknown as Response);

    await expect(module.createDashboardApi(fetch).getLibrary()).rejects.toEqual(
      new module.DashboardApiError(503, undefined, "Dashboard request failed."),
    );
  });

  test("preserves a structured API error without exposing unrelated response data", async () => {
    const module = await loadApi();
    expect(module).toBeDefined();
    if (module === undefined) return;
    const fetch = vi.fn<FetchLike>().mockResolvedValue(
      jsonResponse(
        {
          error: { code: "STEAM_UNAVAILABLE", message: "Steam is unavailable." },
          debug: "secret",
        },
        503,
      ),
    );

    await expect(module.createDashboardApi(fetch).syncLibrary()).rejects.toEqual(
      new module.DashboardApiError(503, "STEAM_UNAVAILABLE", "Steam is unavailable."),
    );
  });
});
