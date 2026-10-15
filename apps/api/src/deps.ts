import type { Logger } from "pino";

import type { Config } from "./config.js";
import type { Pool } from "./db.js";

export interface Deps {
  pool: Pool;
  config: Config;
  logger: Logger;
}

/** The first row of a query that must return one, e.g. `INSERT ... RETURNING`. */
export function firstRow<T>(rows: T[]): T {
  const row = rows[0];
  if (row === undefined) throw new Error("expected a row");
  return row;
}
