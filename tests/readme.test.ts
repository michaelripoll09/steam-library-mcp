import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

const readme = () => readFileSync(join(process.cwd(), "README.md"), "utf8");

describe("README release guidance", () => {
  test("documents installation, required configuration, and the local env-file launch command", () => {
    const content = readme();

    expect(content).toContain("npm install");
    expect(content).toContain("STEAM_API_KEY");
    expect(content).toContain("STEAM_ID");
    expect(content).toContain("npm run build");
    expect(content).toContain("npm start");
    expect(content).toContain(".env.example");
    expect(content).toMatch(/shell.*take precedence/i);
  });

  test("documents the protocol and secret-handling boundaries without embedding credentials", () => {
    const content = readme();

    expect(content).toMatch(/stdout.*protocol/i);
    expect(content).toMatch(/secret|credential|API key/i);
    expect(content).not.toContain("super-secret-steam-api-key");
  });

  test("documents local tracker storage, backup, and recovery", () => {
    const content = readme();
    expect(content).toContain("TRACKER_DATABASE_PATH");
    expect(content).toMatch(/backup/i);
    expect(content).toMatch(/recovery|restore/i);
    expect(content).toContain("gaming_mark_playing");
  });

  test("documents the 1.0 library, collection, tracker, and planning surface", () => {
    const content = readme();

    expect(content).toMatch(/family access.*user-declared local metadata/i);
    expect(content).toMatch(/not verified Steam Families synchronization/i);
    expect(content).toContain("steam_get_game_achievements");
    expect(content).toMatch(/achievements.*on demand/i);
    expect(content).toContain("steam_update_manual_collection");
    expect(content).toContain("gaming_mark_paused");
    expect(content).toMatch(/sessionMode/i);
    expect(content).toMatch(/Play Now.*Backlog Planner|Backlog Planner.*Play Now/i);
    expect(content).toContain("npm test -- --run tests/readme.test.ts");
    expect(content).toContain("npm run typecheck");
    expect(content).toContain("npm run lint");
    expect(content).toContain("npm run build");
  });
});
