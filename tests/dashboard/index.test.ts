import { describe, expect, test, vi } from "vitest";

import { loadConfig } from "../../src/config.js";

const { coreServices, createCoreServices } = vi.hoisted(() => ({
  coreServices: {
    steamService: {},
    gamingTrackerService: {},
    recommendationPreferencesService: {},
    metadataService: {},
    gameDurationService: {},
    playNowRecommendationService: {},
    backlogPlanService: {},
    taskRunner: {},
    close: vi.fn(),
  },
  createCoreServices: vi.fn(),
}));

vi.mock("../../src/core-services.js", () => ({ createCoreServices }));

const { isDashboardEntrypoint, startDashboardServer } =
  await import("../../src/dashboard/index.js");

describe("dashboard executable detection", () => {
  test("closes owned core services when its HTTP server closes", async () => {
    createCoreServices.mockReturnValue(coreServices);
    const server = await startDashboardServer({
      config: loadConfig({
        STEAM_API_KEY: "test-api-key",
        STEAM_ID: "76561198000000000",
      }),
      port: 0,
      installSignalHandlers: false,
    });

    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error === undefined ? resolve() : reject(error))),
    );

    expect(coreServices.close).toHaveBeenCalledTimes(1);
  });

  test.each(["C:/workspace/dist/dashboard/index.js", "C:\\workspace\\dist\\dashboard\\index.js"])(
    "recognizes platform-specific executable path %s",
    (path) => {
      expect(isDashboardEntrypoint(path)).toBe(true);
    },
  );

  test("does not treat another script as the dashboard executable", () => {
    expect(isDashboardEntrypoint("C:\\workspace\\dist\\index.js")).toBe(false);
  });
});
