import { startStdioServer } from "./server.js";

void startStdioServer().catch(() => {
  process.exitCode = 1;
});
