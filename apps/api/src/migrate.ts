/**
 * Forward-only SQL migrations. Pending files are applied in one transaction under an advisory
 * lock (two replicas starting at once cannot race), and each applied file's checksum is
 * recorded: editing a migration after it ran is refused rather than silently diverging.
 */

import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import pg from "pg";

import { loadConfig } from "./config.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations/", import.meta.url));
const LOCK_ID = 7_364_913;
const FILENAME = /^(\d{4})_([a-z0-9_]+)\.sql$/;

export interface Migration {
  version: string;
  name: string;
  sql: string;
}

const checksum = (sql: string): string => createHash("sha256").update(sql).digest("hex");

export async function loadMigrations(dir = MIGRATIONS_DIR): Promise<Migration[]> {
  const migrations: Migration[] = [];
  for (const file of (await readdir(dir)).sort()) {
    const match = FILENAME.exec(file);
    if (match?.[1] && match[2]) {
      migrations.push({
        version: match[1],
        name: match[2],
        sql: await readFile(join(dir, file), "utf8"),
      });
    }
  }
  return migrations;
}

export async function migrate(
  connectionString: string,
  migrations?: Migration[],
): Promise<string[]> {
  const pending = migrations ?? (await loadMigrations());
  const client = new pg.Client({ connectionString, application_name: "wealthpilot-migrate" });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [LOCK_ID]);
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version text PRIMARY KEY, name text NOT NULL, checksum text NOT NULL,
         applied_at timestamptz NOT NULL DEFAULT now())`,
    );
    const { rows } = await client.query<{ version: string; checksum: string }>(
      "SELECT version, checksum FROM schema_migrations",
    );
    const recorded = new Map(rows.map((row) => [row.version, row.checksum]));
    const applied: string[] = [];
    for (const migration of pending) {
      const label = `${migration.version}_${migration.name}`;
      const existing = recorded.get(migration.version);
      if (existing !== undefined) {
        if (existing !== checksum(migration.sql)) {
          throw new Error(`migration ${label} was edited after it was applied`);
        }
        continue;
      }
      await client.query(migration.sql);
      await client.query(
        "INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)",
        [migration.version, migration.name, checksum(migration.sql)],
      );
      applied.push(label);
    }
    await client.query("COMMIT");
    return applied;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  migrate(loadConfig().migrationDatabaseUrl).then(
    (applied) => {
      console.log(JSON.stringify({ applied }));
    },
    (error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    },
  );
}
