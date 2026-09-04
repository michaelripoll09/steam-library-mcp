import { AppError } from "./errors.js";
import { createServerRuntime, startStdioServer } from "./server.js";

void (async () => {
  const runtime = createServerRuntime();
  const shutdown = () => {
    runtime.close();
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  process.once("exit", shutdown);

  await startStdioServer({ server: runtime.server });
})().catch((error: unknown) => {
  if (error instanceof AppError) {
    process.stderr.write(`${error.code}: ${error.safeMessage}\n`);
  }
  process.exitCode = 1;
});
