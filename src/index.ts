import { AppError } from "./errors.js";
import { startStdioServer } from "./server.js";

void startStdioServer().catch((error: unknown) => {
  if (error instanceof AppError) {
    process.stderr.write(`${error.code}: ${error.safeMessage}\n`);
  }
  process.exitCode = 1;
});
