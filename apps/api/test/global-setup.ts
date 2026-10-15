/**
 * Once per test run: reset the test database, make sure the restricted application role can
 * log in, and apply the migrations as the schema owner. Tests then talk to PostgreSQL the way
 * production does: the API through wealthpilot_app, which row-level security restricts.
 */

import pg from "pg";

import { migrate } from "../src/migrate.js";

export default async function setup(): Promise<void> {
  const adminUrl = process.env["TEST_ADMIN_DATABASE_URL"];
  const appUrl = process.env["TEST_DATABASE_URL"];
  if (!adminUrl || !appUrl) {
    throw new Error("Set TEST_ADMIN_DATABASE_URL (schema owner) and TEST_DATABASE_URL (app role)");
  }
  const app = new URL(appUrl);
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    const { rows } = await admin.query<{ db: string }>("SELECT current_database() AS db");
    const database = rows[0]?.db ?? "";
    if (!database.includes("test")) {
      throw new Error(`Refusing to reset "${database}": test database names must contain "test"`);
    }
    await admin.query("DROP SCHEMA IF EXISTS public CASCADE");
    await admin.query("CREATE SCHEMA public");
    const role = admin.escapeIdentifier(decodeURIComponent(app.username));
    const password = admin.escapeLiteral(decodeURIComponent(app.password));
    const exists = await admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [
      decodeURIComponent(app.username),
    ]);
    await admin.query(
      `${exists.rowCount ? "ALTER" : "CREATE"} ROLE ${role} LOGIN PASSWORD ${password} NOSUPERUSER NOBYPASSRLS`,
    );
    await admin.query(`GRANT CONNECT ON DATABASE ${admin.escapeIdentifier(database)} TO ${role}`);
  } finally {
    await admin.end();
  }
  await migrate(adminUrl);
}
