import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

const readme = () => readFileSync(join(process.cwd(), "README.md"), "utf8");

describe("README release guidance", () => {
  test("documents installation, required configuration, and the stdio launch command", () => {
    const content = readme();

    expect(content).toContain("npm install");
    expect(content).toContain("STEAM_API_KEY");
    expect(content).toContain("STEAM_ID");
    expect(content).toContain("npm run build");
    expect(content).toContain("node dist/index.js");
  });

  test("documents the protocol and secret-handling boundaries without embedding credentials", () => {
    const content = readme();

    expect(content).toMatch(/stdout.*protocol/i);
    expect(content).toMatch(/secret|credential|API key/i);
    expect(content).not.toContain("super-secret-steam-api-key");
  });
});
