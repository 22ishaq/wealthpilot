import {
  accountCreateSchema,
  accountUpdateSchema,
  clientCreateSchema,
  clientListQuerySchema,
  clientUpdateSchema,
  holdingCreateSchema,
  holdingUpdateSchema,
  type ClientDetail,
} from "@wealthpilot/shared";
import { Router, type Request } from "express";

import { withTenant, type Tx } from "../db.js";
import { firstRow, type Deps } from "../deps.js";
import { AppError, notFound } from "../errors.js";
import { authOf, paramId, requirePermission, scopeOf } from "../http/middleware.js";
import { recordAudit } from "./audit.js";
import { clientExists, getAccount, getClient, listClients } from "./portfolio.js";

const canWrite = requirePermission("clients:write");

async function clientOr404(tx: Tx, clientId: string): Promise<ClientDetail> {
  const client = await getClient(tx, clientId);
  if (!client) throw notFound("Client");
  return client;
}

async function assertAdvisor(tx: Tx, advisorId: string): Promise<void> {
  const { rowCount } = await tx.query(
    "SELECT 1 FROM users WHERE id = $1 AND deactivated_at IS NULL",
    [advisorId],
  );
  if (rowCount !== 1) {
    throw new AppError(422, "INVALID_ADVISOR", "The advisor must be an active member of your firm");
  }
}

/** UPDATE ... SET for the provided fields only. Column names come from a fixed allow-list. */
function setClause(fields: Record<string, unknown>, columns: Record<string, string>) {
  const entries = Object.entries(fields).filter(
    ([key, value]) => value !== undefined && key in columns,
  );
  return {
    sql: entries.map(([key], index) => `${columns[key] ?? key} = $${index + 2}`).join(", "),
    values: entries.map(([, value]) => value),
  };
}

export function clientsRouter({ pool }: Deps): Router {
  const router = Router();
  const tenant = <T>(req: Request, fn: (tx: Tx) => Promise<T>) =>
    withTenant(pool, scopeOf(req), fn);

  router.get("/", async (req, res) => {
    const query = clientListQuerySchema.parse(req.query);
    const clients = await tenant(req, (tx) =>
      listClients(tx, {
        search: query.search,
        advisorId: query.advisorId,
        archived: query.archived === "true",
      }),
    );
    res.json(clients);
  });

  router.post("/", canWrite, async (req, res) => {
    const input = clientCreateSchema.parse(req.body);
    const client = await tenant(req, async (tx) => {
      if (input.advisorId) await assertAdvisor(tx, input.advisorId);
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO clients (tenant_id, name, email, risk_profile, advisor_id)
         VALUES (app_current_tenant(), $1, $2, $3, $4) RETURNING id`,
        [input.name, input.email ?? null, input.riskProfile, input.advisorId ?? null],
      );
      const id = firstRow(rows).id;
      await recordAudit(tx, authOf(req).userId, "client.created", "client", id, {
        name: input.name,
      });
      return clientOr404(tx, id);
    });
    res.status(201).location(`/api/clients/${client.id}`).json(client);
  });

  router.get("/:clientId", async (req, res) => {
    const clientId = paramId(req, "clientId", "Client");
    res.json(await tenant(req, (tx) => clientOr404(tx, clientId)));
  });

  router.patch("/:clientId", canWrite, async (req, res) => {
    const clientId = paramId(req, "clientId", "Client");
    const input = clientUpdateSchema.parse(req.body);
    const client = await tenant(req, async (tx) => {
      if (input.advisorId) await assertAdvisor(tx, input.advisorId);
      const { sql, values } = setClause(input, {
        name: "name",
        email: "email",
        riskProfile: "risk_profile",
        advisorId: "advisor_id",
      });
      if (sql) {
        const { rowCount } = await tx.query(`UPDATE clients SET ${sql} WHERE id = $1`, [
          clientId,
          ...values,
        ]);
        if (rowCount !== 1) throw notFound("Client");
        await recordAudit(tx, authOf(req).userId, "client.updated", "client", clientId, {
          fields: Object.keys(input),
        });
      }
      return clientOr404(tx, clientId);
    });
    res.json(client);
  });

  for (const [path, archived, action] of [
    ["archive", true, "client.archived"],
    ["restore", false, "client.restored"],
  ] as const) {
    router.post(`/:clientId/${path}`, canWrite, async (req, res) => {
      const clientId = paramId(req, "clientId", "Client");
      const client = await tenant(req, async (tx) => {
        const { rowCount } = await tx.query(
          `UPDATE clients SET archived_at = CASE WHEN $2 THEN now() ELSE NULL END WHERE id = $1`,
          [clientId, archived],
        );
        if (rowCount !== 1) throw notFound("Client");
        await recordAudit(tx, authOf(req).userId, action, "client", clientId);
        return clientOr404(tx, clientId);
      });
      res.json(client);
    });
  }

  router.post("/:clientId/accounts", canWrite, async (req, res) => {
    const clientId = paramId(req, "clientId", "Client");
    const input = accountCreateSchema.parse(req.body);
    const account = await tenant(req, async (tx) => {
      // RLS hides other firms' clients, so this is also the cross-tenant check.
      if (!(await clientExists(tx, clientId))) throw notFound("Client");
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO accounts (tenant_id, client_id, name, type, cash_pence)
         VALUES (app_current_tenant(), $1, $2, $3, $4) RETURNING id`,
        [clientId, input.name, input.type, input.cash ?? 0],
      );
      const id = firstRow(rows).id;
      await recordAudit(tx, authOf(req).userId, "account.opened", "account", id, {
        clientId,
        type: input.type,
      });
      return getAccount(tx, id);
    });
    res.status(201).json(account);
  });

  return router;
}

export function accountsRouter({ pool }: Deps): Router {
  const router = Router();
  const tenant = <T>(req: Request, fn: (tx: Tx) => Promise<T>) =>
    withTenant(pool, scopeOf(req), fn);

  router.patch("/:accountId", canWrite, async (req, res) => {
    const accountId = paramId(req, "accountId", "Account");
    const input = accountUpdateSchema.parse(req.body);
    const account = await tenant(req, async (tx) => {
      const { sql, values } = setClause(input, { name: "name", cash: "cash_pence" });
      if (sql) {
        const { rowCount } = await tx.query(`UPDATE accounts SET ${sql} WHERE id = $1`, [
          accountId,
          ...values,
        ]);
        if (rowCount !== 1) throw notFound("Account");
        await recordAudit(tx, authOf(req).userId, "account.updated", "account", accountId, {
          fields: Object.keys(input),
        });
      }
      const found = await getAccount(tx, accountId);
      if (!found) throw notFound("Account");
      return found;
    });
    res.json(account);
  });

  router.delete("/:accountId", canWrite, async (req, res) => {
    const accountId = paramId(req, "accountId", "Account");
    await tenant(req, async (tx) => {
      const { rowCount } = await tx.query("DELETE FROM accounts WHERE id = $1", [accountId]);
      if (rowCount !== 1) throw notFound("Account");
      await recordAudit(tx, authOf(req).userId, "account.closed", "account", accountId);
    });
    res.status(204).end();
  });

  router.post("/:accountId/holdings", canWrite, async (req, res) => {
    const accountId = paramId(req, "accountId", "Account");
    const input = holdingCreateSchema.parse(req.body);
    const account = await tenant(req, async (tx) => {
      if (!(await getAccount(tx, accountId))) throw notFound("Account");
      const security = await tx.query("SELECT 1 FROM securities WHERE symbol = $1", [input.symbol]);
      if (security.rowCount !== 1) {
        throw new AppError(422, "UNKNOWN_SECURITY", `${input.symbol} is not a supported security`);
      }
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO holdings (tenant_id, account_id, symbol, quantity, book_cost_pence)
         VALUES (app_current_tenant(), $1, $2, $3, $4) RETURNING id`,
        [accountId, input.symbol, input.quantity, input.bookCost],
      );
      await recordAudit(tx, authOf(req).userId, "holding.added", "holding", firstRow(rows).id, {
        accountId,
        symbol: input.symbol,
        quantity: input.quantity,
      });
      return getAccount(tx, accountId);
    });
    res.status(201).json(account);
  });

  return router;
}

export function holdingsRouter({ pool }: Deps): Router {
  const router = Router();
  const tenant = <T>(req: Request, fn: (tx: Tx) => Promise<T>) =>
    withTenant(pool, scopeOf(req), fn);

  router.patch("/:holdingId", canWrite, async (req, res) => {
    const holdingId = paramId(req, "holdingId", "Holding");
    const input = holdingUpdateSchema.parse(req.body);
    const account = await tenant(req, async (tx) => {
      const { sql, values } = setClause(input, {
        quantity: "quantity",
        bookCost: "book_cost_pence",
      });
      const { rows } = await tx.query<{ account_id: string }>(
        sql
          ? `UPDATE holdings SET ${sql} WHERE id = $1 RETURNING account_id`
          : "SELECT account_id FROM holdings WHERE id = $1",
        [holdingId, ...values],
      );
      const row = rows[0];
      if (!row) throw notFound("Holding");
      if (sql) {
        await recordAudit(tx, authOf(req).userId, "holding.updated", "holding", holdingId, {
          quantity: input.quantity,
          bookCost: input.bookCost,
        });
      }
      return getAccount(tx, row.account_id);
    });
    res.json(account);
  });

  router.delete("/:holdingId", canWrite, async (req, res) => {
    const holdingId = paramId(req, "holdingId", "Holding");
    await tenant(req, async (tx) => {
      const { rows } = await tx.query<{ symbol: string }>(
        "DELETE FROM holdings WHERE id = $1 RETURNING symbol",
        [holdingId],
      );
      const row = rows[0];
      if (!row) throw notFound("Holding");
      await recordAudit(tx, authOf(req).userId, "holding.removed", "holding", holdingId, {
        symbol: row.symbol,
      });
    });
    res.status(204).end();
  });

  return router;
}
