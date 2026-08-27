import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer, request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";

import { beforeAll, describe, expect, test } from "vitest";

const apiKey = "super-secret-steam-api-key";
const entrypoint = join(process.cwd(), "dist", "index.js");
const dashboardEntrypoint = join(process.cwd(), "dist", "dashboard", "index.js");
const dashboardUiDirectory = join(process.cwd(), "dist", "dashboard-ui");
const buildSecretMarker = "dashboard-release-test-secret-marker";

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

async function reserveLoopbackPort(): Promise<number> {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();
  if (address === null || typeof address === "string") throw new Error("Expected a TCP address.");
  await new Promise<void>((resolve, reject) =>
    probe.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

async function waitForDashboard(url: string, process?: ChildProcess): Promise<Response> {
  const deadline = Date.now() + 5_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    if (process?.exitCode !== null && process?.exitCode !== undefined) {
      throw new Error(`Dashboard process exited with code ${process.exitCode}.`);
    }
    try {
      return await fetch(url);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw lastError ?? new Error(`Dashboard did not listen at ${url}.`);
}

function callDashboard(port: number, path: string, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const requestHandle = request(
      { hostname: "127.0.0.1", port, path, headers: { host } },
      (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode ?? 0));
      },
    );
    requestHandle.on("error", reject);
    requestHandle.end();
  });
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  const close = once(child, "close");
  if (process.platform === "win32" && child.pid !== undefined) {
    try {
      execFileSync(process.env.ComSpec ?? "cmd.exe", [
        "/d",
        "/s",
        "/c",
        `taskkill /pid ${child.pid} /t /f`,
      ]);
    } catch {
      child.kill();
    }
  } else {
    child.kill();
  }
  await close;
}

function startDashboardCommand(environment: NodeJS.ProcessEnv): ChildProcess {
  if (process.platform === "win32") {
    return spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "npm run dashboard"], {
      cwd: process.cwd(),
      env: { ...process.env, ...environment },
      stdio: "ignore",
    });
  }
  return spawn("npm", ["run", "dashboard"], {
    cwd: process.cwd(),
    env: { ...process.env, ...environment },
    stdio: "ignore",
  });
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
  expect(existsSync(dashboardEntrypoint)).toBe(true);
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
      expect(result.stderr).toContain("PERSISTENCE_FAILURE");
      expect(result.stderr).toContain("Check the database path and try again.");
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

describe("released dashboard", () => {
  test("serves temporary UI assets on loopback and keeps API 404s separate", async () => {
    const staticRoot = mkdtempSync(join(tmpdir(), "steam-library-dashboard-ui-"));
    writeFileSync(
      join(staticRoot, "index.html"),
      "<!doctype html><title>Release dashboard</title>",
    );
    writeFileSync(join(staticRoot, "asset.js"), "console.log('release asset')");
    try {
      const { startDashboardServer } = await import(pathToFileURL(dashboardEntrypoint).href);
      const server = await startDashboardServer({
        config: { dashboardPort: 0 },
        dashboardService: {
          getLibrary: async () => ({ games: [] }),
          syncLibrary: async () => ({ games: [] }),
          updateStatus: async () => ({ games: [] }),
        },
        staticRoot,
        installSignalHandlers: false,
      });
      try {
        const address = server.address();
        expect(address).not.toBeNull();
        expect(typeof address).not.toBe("string");
        const port = (address as { address: string; port: number }).port;
        expect((address as { address: string }).address).toBe("127.0.0.1");

        const root = await fetch(`http://127.0.0.1:${port}/`);
        expect(root.status).toBe(200);
        expect(await root.text()).toContain("Release dashboard");
        expect((await fetch(`http://127.0.0.1:${port}/asset.js`)).status).toBe(200);
        expect((await fetch(`http://127.0.0.1:${port}/api/missing`)).status).toBe(404);
        expect(await callDashboard(port, "/api/library", "evil.example")).toBe(403);
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((error: Error | undefined) => (error ? reject(error) : resolve())),
        );
      }
    } finally {
      rmSync(staticRoot, { force: true, recursive: true });
    }
  });

  test("starts the compiled dashboard command without embedding test secrets in built UI assets", async () => {
    const port = await reserveLoopbackPort();
    const databaseDirectory = mkdtempSync(join(tmpdir(), "steam-library-dashboard-command-"));
    const dashboard = startDashboardCommand({
      STEAM_API_KEY: buildSecretMarker,
      STEAM_ID: "76561198000000000",
      DASHBOARD_PORT: String(port),
      TRACKER_DATABASE_PATH: join(databaseDirectory, "tracker.sqlite"),
    });
    try {
      const root = await waitForDashboard(`http://127.0.0.1:${port}/`, dashboard);
      expect(root.status).toBe(200);
      expect(await root.text()).toContain('<div id="root">');
      for (const outputPath of readdirSync(dashboardUiDirectory, {
        encoding: "utf8",
        recursive: true,
      })) {
        const path = join(dashboardUiDirectory, outputPath);
        if (statSync(path).isFile()) {
          expect(readFileSync(path, "utf8")).not.toContain(buildSecretMarker);
        }
      }
    } finally {
      await stopProcess(dashboard);
      rmSync(databaseDirectory, { force: true, recursive: true });
    }
  });
});
