import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

import { beforeAll, describe, expect, test } from "vitest";

const apiKey = "super-secret-steam-api-key";
const entrypoint = join(process.cwd(), "dist", "index.js");

type ProcessResult = Readonly<{
  code: number | null;
  stderr: string;
  stdout: string;
}>;

function runServer(environment: NodeJS.ProcessEnv, input?: string): Promise<ProcessResult> {
  const child = spawn(process.execPath, [entrypoint], {
    env: { ...process.env, ...environment },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  child.stdin.end(input);

  return once(child, "close").then(([code]) => ({ code, stderr, stdout }));
}

beforeAll(() => {
  if (process.platform === "win32") {
    execFileSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "npm run build"], {
      stdio: "pipe",
    });
  } else {
    execFileSync("npm", ["run", "build"], { stdio: "pipe" });
  }
  expect(existsSync(entrypoint)).toBe(true);
});

describe("released stdio entrypoint", () => {
  test("restarts with the same tracker database", async () => {
    const directory = mkdtempSync(join(tmpdir(), "steam-library-stdio-"));
    const databasePath = join(directory, "tracker.sqlite");
    const input = `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "restart", version: "1" } } })}\n`;
    try {
      await expect(
        runServer(
          {
            STEAM_API_KEY: apiKey,
            STEAM_ID: "76561198000000000",
            TRACKER_DATABASE_PATH: databasePath,
          },
          input,
        ),
      ).resolves.toMatchObject({ code: 0 });
      await expect(
        runServer(
          {
            STEAM_API_KEY: apiKey,
            STEAM_ID: "76561198000000000",
            TRACKER_DATABASE_PATH: databasePath,
          },
          input,
        ),
      ).resolves.toMatchObject({ code: 0 });
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("fails startup safely for a database newer than supported", async () => {
    const directory = mkdtempSync(join(tmpdir(), "steam-library-stdio-"));
    const databasePath = join(directory, "tracker.sqlite");
    const database = new Database(databasePath);
    database.exec(
      "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)",
    );
    database
      .prepare("INSERT INTO schema_migrations VALUES (?, ?, ?, ?)")
      .run(999, "future", "checksum", "2026-08-25T00:00:00.000Z");
    database.close();
    try {
      const result = await runServer({
        STEAM_API_KEY: apiKey,
        STEAM_ID: "76561198000000000",
        TRACKER_DATABASE_PATH: databasePath,
      });
      expect(result).toMatchObject({ code: 1, stdout: "" });
      expect(`${result.stdout}${result.stderr}`).not.toContain(databasePath);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
  test("responds to a valid framed MCP initialize request", async () => {
    const result = await runServer(
      { STEAM_API_KEY: apiKey, STEAM_ID: "76561198000000000" },
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "release-e2e", version: "1.0.0" },
        },
      })}\n`,
    );

    expect(result).toMatchObject({ code: 0 });
    expect(JSON.parse(result.stdout)).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: { serverInfo: { name: "steam-library-mcp" } },
    });
  });

  test("keeps malformed frames and configured secrets out of stdout and stderr", async () => {
    const result = await runServer(
      { STEAM_API_KEY: apiKey, STEAM_ID: "76561198000000000" },
      "not-json\n",
    );

    expect(result).toMatchObject({ code: 0, stdout: "" });
    expect(`${result.stdout}${result.stderr}`).not.toContain(apiKey);
  });

  test("rejects invalid startup configuration without serving protocol output or leaking secrets", async () => {
    const result = await runServer({ STEAM_API_KEY: apiKey, STEAM_ID: "" });

    expect(result).toMatchObject({ code: 1, stdout: "" });
    expect(`${result.stdout}${result.stderr}`).not.toContain(apiKey);
  });
});
