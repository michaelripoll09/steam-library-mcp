import { describe, expect, test } from "vitest";

import { isDashboardEntrypoint } from "../../src/dashboard/index.js";

describe("dashboard executable detection", () => {
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
