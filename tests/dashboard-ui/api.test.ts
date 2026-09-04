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
    await api.updateGameStatus(42, "paused");

    expect(fetch.mock.calls).toEqual([
      ["/api/library/sync", { method: "POST" }],
      [
        "/api/games/42/status",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "paused" }),
        },
      ],
    ]);
  });

  test("updates manual collection access metadata with an exact PATCH request", async () => {
    const module = await loadApi();
    expect(module).toBeDefined();
    if (module === undefined) return;
    const fetch = vi.fn<FetchLike>().mockResolvedValue(jsonResponse({}));
    const api = module.createDashboardApi(fetch) as unknown as {
      updateManualCollection: (
        appId: number,
        patch: { accessType?: "manual" | "family"; isPlayable?: boolean },
      ) => Promise<unknown>;
    };

    await api.updateManualCollection(1245620, { accessType: "family", isPlayable: true });

    expect(fetch.mock.calls).toEqual([
      [
        "/api/manual-collection/1245620",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessType: "family", isPlayable: true }),
        },
      ],
    ]);
  });

  test("uses dashboard-only intelligence endpoints for reads and explicit local writes", async () => {
    const module = await loadApi();
    expect(module).toBeDefined();
    if (module === undefined) return;
    const fetch = vi.fn<FetchLike>().mockResolvedValue(jsonResponse({}));
    const api = module.createDashboardApi(fetch) as unknown as {
      getInsights: () => Promise<unknown>;
      getRecommendations: (
        minutes: number,
        sessionMode: "solo" | "with_friends" | "any",
      ) => Promise<unknown>;
      savePreference: (appId: number, preference: object) => Promise<unknown>;
      createPlan: (request: object) => Promise<unknown>;
      updatePlanItemProgress: (
        planId: string,
        itemId: string,
        progress: string,
      ) => Promise<unknown>;
    };

    await api.getInsights();
    await api.getRecommendations(45, "with_friends");
    await api.savePreference(10, {
      priority: "high",
      excludedFromRecommendations: false,
      playMode: "solo",
    });
    await api.createPlan({ cadence: "weekly", availableMinutes: 45, targetGameCount: 2 });
    await api.updatePlanItemProgress("weekly-1", "weekly-1:1", "done");

    expect(fetch.mock.calls).toEqual([
      ["/api/intelligence/insights", { method: "GET" }],
      [
        "/api/intelligence/recommendations?availableMinutes=45&sessionMode=with_friends",
        { method: "GET" },
      ],
      [
        "/api/games/10/preference",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            priority: "high",
            excludedFromRecommendations: false,
            playMode: "solo",
          }),
        },
      ],
      [
        "/api/backlog-plans",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cadence: "weekly", availableMinutes: 45, targetGameCount: 2 }),
        },
      ],
      [
        "/api/backlog-plans/weekly-1/items/weekly-1%3A1",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ progress: "done" }),
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
