import { afterAll } from "vitest";

import { adminPool, pool } from "./helpers.js";

afterAll(async () => {
  await pool.end();
  await adminPool.end();
});
