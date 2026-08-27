import type {
  DashboardLibrary,
  DashboardMutableStatus,
  DashboardStatusUpdate,
} from "../../src/dashboard/contracts.js";

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
