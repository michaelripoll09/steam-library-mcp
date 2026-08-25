import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { join } from "node:path";

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
