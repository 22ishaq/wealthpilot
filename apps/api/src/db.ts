import pg from "pg";

// BIGINT columns hold pence. Refuse to hand back a number that has silently lost precision.
pg.types.setTypeParser(pg.types.builtins.INT8, (value: string) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new RangeError(`bigint ${value} is outside the safe integer range`);
  }
  return parsed;
});

export type Pool = pg.Pool;
export type Tx = pg.PoolClient;

export function createPool(connectionString: string, max = 10): Pool {
  return new pg.Pool({
    connectionString,
    max,
    idleTimeoutMillis: 30_000,
    application_name: "wealthpilot-api",
  });
}

export interface TenantScope {
  tenantId: string;
  userId: string | null;
}

/** Run `fn` in a transaction. Without a tenant scope, RLS hides every tenant-owned row. */
export async function transaction<T>(pool: Pool, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let broken: Error | undefined;
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch((rollbackError: unknown) => {
      broken = rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
    });
    throw error;
  } finally {
    client.release(broken);
  }
}

/**
 * Run `fn` in a transaction scoped to one tenant. `set_config(..., true)` lasts only until the
 * transaction ends, so a pooled connection can never carry one tenant's scope into another
 * tenant's request.
 */
export async function withTenant<T>(
  pool: Pool,
  scope: TenantScope,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return transaction(pool, async (tx) => {
    await tx.query("SELECT set_config('app.tenant_id', $1, true)", [scope.tenantId]);
    return fn(tx);
  });
}
