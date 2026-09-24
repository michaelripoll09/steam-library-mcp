import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

import { PACKAGE_METADATA, parsePackageMetadata } from "../src/package-metadata.js";

describe("package metadata", () => {
  test("reads the single runtime name and version from package.json", () => {
    expect(PACKAGE_METADATA).toEqual({ name: "steam-library-mcp", version: "2.0.1" });
  });

  test("matches the locked root package versions", () => {
    const lockfile = JSON.parse(readFileSync("package-lock.json", "utf8")) as {
      version?: unknown;
      packages?: Record<string, { version?: unknown }>;
    };
    expect(lockfile.version).toBe(PACKAGE_METADATA.version);
    expect(lockfile.packages?.[""]?.version).toBe(PACKAGE_METADATA.version);
  });

  test("production server source has no independent literal version", () => {
    const serverSource = readFileSync("src/server.ts", "utf8");
    expect(serverSource).not.toMatch(/version:\s*"\d+\.\d+\.\d+"/);
    expect(serverSource).toContain("PACKAGE_METADATA");
  });

  test("rejects malformed package metadata safely", () => {
    for (const value of [
      null,
      undefined,
      "steam-library-mcp",
      {},
      { name: "", version: "2.0.1" },
      { name: "steam-library-mcp" },
      { name: "steam-library-mcp", version: "" },
      { name: "steam-library-mcp", version: "2.0" },
      { name: "steam-library-mcp", version: "latest" },
      { name: "steam-library-mcp", version: 201 },
    ]) {
      expect(() => parsePackageMetadata(value)).toThrow();
    }
    expect(parsePackageMetadata({ name: "steam-library-mcp", version: "2.0.1" })).toEqual({
      name: "steam-library-mcp",
      version: "2.0.1",
    });
  });
});
