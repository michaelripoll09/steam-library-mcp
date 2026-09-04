import type {
  DashboardInsightSnapshot,
  DashboardLibrary,
  DashboardMutableStatus,
  DashboardPlan,
  DashboardPlanCreateResult,
  DashboardPlanItem,
  DashboardPlanItemProgress,
  DashboardRecommendationPreference,
  DashboardRecommendations,
  DashboardStatusUpdate,
} from "../../src/dashboard/contracts.js";
import type { LocalTask } from "../../src/tasks/task-runner.js";
import type { ManualLibraryGame } from "../../src/manual-library/manual-library.js";

export type DashboardFetch = (input: string, init?: RequestInit) => Promise<Response>;

export class DashboardApiError extends Error {
  readonly name = "DashboardApiError";

  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
  ) {
    super(message);
  }
}

export type DashboardApi = Readonly<{
  getLibrary: () => Promise<DashboardLibrary>;
  syncLibrary: () => Promise<DashboardLibrary>;
  updateGameStatus: (
    appId: number,
    status: DashboardMutableStatus,
  ) => Promise<DashboardStatusUpdate>;
  getManualCollection: () => Promise<readonly ManualLibraryGame[]>;
  addManualCollection: (steam: string) => Promise<ManualLibraryGame>;
  updateManualCollection: (
    appId: number,
    patch: { accessType?: "manual" | "family"; isPlayable?: boolean },
  ) => Promise<ManualLibraryGame>;
  removeManualCollection: (appId: number) => Promise<Readonly<{ removed: boolean }>>;
  getInsights: () => Promise<DashboardInsightSnapshot>;
  getRecommendations: (availableMinutes: number) => Promise<DashboardRecommendations>;
  getPreference: (appId: number) => Promise<DashboardRecommendationPreference>;
  savePreference: (
    appId: number,
    preference: Omit<DashboardRecommendationPreference, "appId">,
  ) => Promise<DashboardRecommendationPreference>;
  getPlans: () => Promise<readonly DashboardPlan[]>;
  createPlan: (request: {
    cadence: "weekly" | "monthly";
    availableMinutes: number;
    targetGameCount: number;
  }) => Promise<DashboardPlanCreateResult>;
  updatePlanItemProgress: (
    planId: string,
    itemId: string,
    progress: DashboardPlanItemProgress,
  ) => Promise<DashboardPlanItem>;
  getTasks: () => Promise<readonly LocalTask[]>;
  getTask: (id: string) => Promise<LocalTask>;
  cancelTask: (id: string) => Promise<LocalTask>;
}>;

export function createDashboardApi(fetch: DashboardFetch): DashboardApi {
  return {
    getLibrary: () => request<DashboardLibrary>(fetch, "/api/library", { method: "GET" }),
    syncLibrary: () => request<DashboardLibrary>(fetch, "/api/library/sync", { method: "POST" }),
    updateGameStatus: (appId, status) =>
      request<DashboardStatusUpdate>(fetch, `/api/games/${appId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      }),
    getManualCollection: () =>
      request<readonly ManualLibraryGame[]>(fetch, "/api/manual-collection", { method: "GET" }),
    addManualCollection: (steam) =>
      request<ManualLibraryGame>(fetch, "/api/manual-collection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ steam }),
      }),
    updateManualCollection: (appId, patch) =>
      request<ManualLibraryGame>(fetch, `/api/manual-collection/${appId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }),
    removeManualCollection: (appId) =>
      request<Readonly<{ removed: boolean }>>(fetch, `/api/manual-collection/${appId}`, {
        method: "DELETE",
      }),
    getInsights: () =>
      request<DashboardInsightSnapshot>(fetch, "/api/intelligence/insights", { method: "GET" }),
    getRecommendations: (availableMinutes) =>
      request<DashboardRecommendations>(
        fetch,
        `/api/intelligence/recommendations?availableMinutes=${encodeURIComponent(String(availableMinutes))}`,
        { method: "GET" },
      ),
    getPreference: (appId) =>
      request<DashboardRecommendationPreference>(fetch, `/api/games/${appId}/preference`, {
        method: "GET",
      }),
    savePreference: (appId, preference) =>
      request<DashboardRecommendationPreference>(fetch, `/api/games/${appId}/preference`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(preference),
      }),
    getPlans: () =>
      request<readonly DashboardPlan[]>(fetch, "/api/backlog-plans", { method: "GET" }),
    createPlan: (plan) =>
      request<DashboardPlanCreateResult>(fetch, "/api/backlog-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(plan),
      }),
    updatePlanItemProgress: (planId, itemId, progress) =>
      request<DashboardPlanItem>(
        fetch,
        `/api/backlog-plans/${encodeURIComponent(planId)}/items/${encodeURIComponent(itemId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ progress }),
        },
      ),
    getTasks: () => request<readonly LocalTask[]>(fetch, "/api/tasks", { method: "GET" }),
    getTask: (id) =>
      request<LocalTask>(fetch, `/api/tasks/${encodeURIComponent(id)}`, { method: "GET" }),
    cancelTask: (id) =>
      request<LocalTask>(fetch, `/api/tasks/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
  };
}

async function request<T>(fetch: DashboardFetch, path: string, init: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) throw await createApiError(response);
  return (await response.json()) as T;
}

async function createApiError(response: Response): Promise<DashboardApiError> {
  const payload = await readJsonError(response);
  return new DashboardApiError(
    response.status,
    payload?.code,
    payload?.message ?? "Dashboard request failed.",
  );
}

async function readJsonError(
  response: Response,
): Promise<Readonly<{ code: string | undefined; message: string }> | undefined> {
  if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return undefined;
  }
  try {
    const payload: unknown = await response.json();
    if (
      !isRecord(payload) ||
      !isRecord(payload.error) ||
      typeof payload.error.message !== "string"
    ) {
      return undefined;
    }
    return {
      code: typeof payload.error.code === "string" ? payload.error.code : undefined,
      message: payload.error.message,
    };
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
