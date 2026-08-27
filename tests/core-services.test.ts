import { describe, expect, test } from "vitest";

import { createCoreServices } from "../src/core-services.js";
import type { MetadataService } from "../src/services/metadata-service.js";
import type { SteamService } from "../src/services/steam-service.js";
import type { GamingTrackerService } from "../src/tracker/gaming-tracker-service.js";

describe("core services", () => {
  test("reuses injected services without reading environment or opening tracker storage", () => {
    const steamService = {} as SteamService;
    const gamingTrackerService = {} as GamingTrackerService;
    const metadataService = {} as MetadataService;

    const services = createCoreServices({
      steamService,
      gamingTrackerService,
      metadataService,
    });

    expect(services).toEqual({ steamService, gamingTrackerService, metadataService });
  });
});
