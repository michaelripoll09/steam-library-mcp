import { describe, expect, test, vi } from "vitest";

import { createDashboardApi } from "../../dashboard-ui/src/api.js";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
  } as Response;
}

describe("dashboard task API", () => {
  test("uses relative list, poll, and cancellation endpoints", async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ tasks: [] }));
    const api = createDashboardApi(fetch);

    await api.getTasks();
    await api.getTask("task/one");
    await api.cancelTask("task/one");

    expect(fetch.mock.calls).toEqual([
      ["/api/tasks", { method: "GET" }],
      ["/api/tasks/task%2Fone", { method: "GET" }],
      ["/api/tasks/task%2Fone/cancel", { method: "POST" }],
    ]);
  });
});
