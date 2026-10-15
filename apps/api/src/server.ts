import { pino } from "pino";

import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createPool } from "./db.js";

const config = loadConfig();
const logger = pino({ level: config.logLevel });
const pool = createPool(config.databaseUrl, config.poolMax);
const app = createApp({ pool, config, logger });

const server = app.listen(config.port, () => {
  logger.info({ port: config.port }, "WealthPilot API listening");
});

function shutdown(signal: string): void {
  logger.info({ signal }, "shutting down");
  server.close(() => {
    void pool.end().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.once("SIGTERM", () => {
  shutdown("SIGTERM");
});
process.once("SIGINT", () => {
  shutdown("SIGINT");
});
