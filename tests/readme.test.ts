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

  test("documents final 1.0 dashboard, manual collection, and achievement behavior", () => {
    const content = readme();

    expect(content).toMatch(/playing.*paused.*completed.*dropped/i);
    expect(content).toMatch(/manual.*family/i);
    expect(content).toMatch(/isPlayable|playable/i);
    expect(content).toMatch(/achievement.*dashboard|dashboard.*achievement/i);
    expect(content).not.toContain("Local status changes (playing, completed, or dropped).");
    expect(content).not.toContain("are treated as not playable by recommendation logic.");
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

  test("has no literal escaped-newline artifacts and matches the env-file surface", async () => {
    const { readFile } = await import("node:fs/promises");
    const content = readme();
    const envExample = await readFile(join(process.cwd(), ".env.example"), "utf8");

    expect(content).not.toContain("\\n");
    for (const variable of [
      "STEAM_API_KEY",
      "STEAM_ID",
      "STEAMGRIDDB_API_KEY",
      "TRACKER_DATABASE_PATH",
      "DASHBOARD_PORT",
      "DASHBOARD_UI_PORT",
      "IGDB_CLIENT_ID",
      "IGDB_CLIENT_SECRET",
    ]) {
      expect(content).toContain(variable);
      expect(envExample).toContain(variable);
    }
    expect(envExample).toContain("DASHBOARD_PORT=4173");
    expect(envExample).toContain("DASHBOARD_UI_PORT=5173");
    expect(envExample).not.toMatch(/sk-(live|test)-[A-Za-z0-9]+/);
    expect(envExample).not.toMatch(/\b[0-9a-f]{32,}\b/i);
  });

  test("documents current duration, backlog, and audit-gate behavior", () => {
    const content = readme();

    expect(content).toMatch(/24 hour/i);
    expect(content).toMatch(/correct/i);
    expect(content).toMatch(/WAL/i);
    expect(content).toContain("npm audit --audit-level moderate");
  });
});
