import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { createApp } from "./app.js";

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, "LedgerFlow backend listening");
});

const shutdown = (signal: string) => {
  logger.info({ signal }, "Shutting down");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
