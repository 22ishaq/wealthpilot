/**
 * Tenant isolation inside PostgreSQL itself. These tests bypass the API and use the
 * application role directly, so they hold even if a route forgot a check.
 */

import type pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import { type Firm, adminPool, createClient, openAccount, pool, signUp } from "./helpers.js";

let firmA: Firm;
let firmB: Firm;
let clientA: string;

beforeAll(async () => {
  firmA = await signUp("RLS A");
  firmB = await signUp("RLS B");
  clientA = (await createClient(firmA.agent, { name: "Client A" })).id;
  await openAccount(firmA.agent, clientA, "50.00");
  await createClient(firmB.agent, { name: "Client B" });
});

/** Run as the application role in a transaction that is always rolled back. */
async function asApp<T>(
  tenantId: string | null,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (tenantId) await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    return await fn(client);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

async function sqlState(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return (error as { code: string }).code;
  }
  return "no error";
}

describe("the application role", () => {
  it("is not a superuser and cannot bypass row-level security", async () => {
    const { rows } = await pool.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user",
    );
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it("owns none of the tables (owners are exempt from RLS)", async () => {
    const { rows } = await pool.query(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tableowner = current_user",
    );
    expect(rows).toEqual([]);
  });

  it("has row-level security enabled on every tenant-owned table", async () => {
    const { rows } = await adminPool.query<{ relname: string }>(
      `SELECT relname FROM pg_class
        WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND NOT relrowsecurity
        ORDER BY relname`,
    );
    expect(rows.map((row) => row.relname)).toEqual(["schema_migrations", "securities"]);
  });
});

describe("row-level security", () => {
  it("shows nothing at all without a tenant in scope", async () => {
    const counts = await asApp(null, async (client) => {
      const tables = ["tenants", "users", "clients", "accounts", "audit_events"];
      const result: Record<string, number> = {};
      for (const table of tables) {
        const { rows } = await client.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM ${table}`,
        );
        result[table] = rows[0]?.n ?? -1;
      }
      return result;
    });
    expect(counts).toEqual({ tenants: 0, users: 0, clients: 0, accounts: 0, audit_events: 0 });
  });

  it("shows exactly one tenant's rows when scoped to it", async () => {
    const names = await asApp(firmA.me.tenant.id, async (client) => {
      const { rows } = await client.query<{ name: string }>("SELECT name FROM clients");
      return rows.map((row) => row.name);
    });
    expect(names).toEqual(["Client A"]);
  });

  it("refuses to write a row into another tenant", async () => {
    const state = await sqlState(
      asApp(firmA.me.tenant.id, (client) =>
        client.query(
          "INSERT INTO clients (tenant_id, name, risk_profile) VALUES ($1, 'Smuggled', 'growth')",
          [firmB.me.tenant.id],
        ),
      ),
    );
    expect(state).toBe("42501");
  });

  it("cannot update or delete another tenant's rows (they are invisible)", async () => {
    const affected = await asApp(firmB.me.tenant.id, async (client) => {
      const update = await client.query("UPDATE clients SET name = 'Hijacked' WHERE id = $1", [
        clientA,
      ]);
      const remove = await client.query("DELETE FROM clients WHERE id = $1", [clientA]);
      return [update.rowCount, remove.rowCount];
    });
    expect(affected).toEqual([0, 0]);
  });

  it("cannot move a row to another tenant", async () => {
    const state = await sqlState(
      asApp(firmA.me.tenant.id, (client) =>
        client.query("UPDATE clients SET tenant_id = $1 WHERE id = $2", [
          firmB.me.tenant.id,
          clientA,
        ]),
      ),
    );
    expect(state).toBe("42501");
  });
});

describe("column and table privileges", () => {
  it("cannot read password hashes, even in its own tenant", async () => {
    const state = await sqlState(
      asApp(firmA.me.tenant.id, (client) => client.query("SELECT password_hash FROM users")),
    );
    expect(state).toBe("42501");
  });

  it("cannot touch the sessions table directly", async () => {
    const read = await sqlState(
      asApp(firmA.me.tenant.id, (client) => client.query("SELECT token_hash FROM sessions")),
    );
    expect(read).toBe("42501");
    const state = await sqlState(
      asApp(firmA.me.tenant.id, (client) =>
        client.query(
          "INSERT INTO sessions (token_hash, user_id, tenant_id, expires_at) VALUES ($1, $2, $3, now())",
          ["0".repeat(64), firmA.me.user.id, firmA.me.tenant.id],
        ),
      ),
    );
    expect(state).toBe("42501");
  });

  it("can only append to the audit trail", async () => {
    const update = await sqlState(
      asApp(firmA.me.tenant.id, (client) => client.query("UPDATE audit_events SET action = 'x'")),
    );
    const remove = await sqlState(
      asApp(firmA.me.tenant.id, (client) => client.query("DELETE FROM audit_events")),
    );
    expect([update, remove]).toEqual(["42501", "42501"]);
  });

  it("can read but not change reference securities", async () => {
    const state = await sqlState(
      asApp(firmA.me.tenant.id, (client) => client.query("UPDATE securities SET price_pence = 1")),
    );
    expect(state).toBe("42501");
  });
});

describe("composite foreign keys", () => {
  it("block cross-tenant references even for a connection that bypasses RLS", async () => {
    // The schema owner is not subject to RLS; the foreign key still refuses an account that
    // belongs to tenant B but points at tenant A's client.
    const state = await sqlState(
      adminPool.query(
        "INSERT INTO accounts (tenant_id, client_id, name, type) VALUES ($1, $2, 'Bad', 'isa')",
        [firmB.me.tenant.id, clientA],
      ),
    );
    expect(state).toBe("23503");
  });
});
