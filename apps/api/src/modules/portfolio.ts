/**
 * Portfolio queries. Every function takes a tenant-scoped transaction: row-level security
 * already limits each table to the caller's firm, so no query here filters by tenant_id
 * itself. Valuation (quantity x price) happens in PostgreSQL NUMERIC and is rounded to whole
 * pence there, so JavaScript never multiplies money by a fractional quantity.
 */

import {
  allocate,
  type Account,
  type AccountType,
  type AssetClass,
  type ClientDetail,
  type ClientSummary,
  type Holding,
  type RiskProfile,
} from "@wealthpilot/shared";

import type { Tx } from "../db.js";

type ClassValues = Partial<Record<AssetClass, number>>;

interface ClientRow {
  id: string;
  name: string;
  email: string | null;
  risk_profile: RiskProfile;
  created_at: Date;
  archived_at: Date | null;
  advisor_id: string | null;
  advisor_name: string | null;
  account_count: number;
}

export interface ClientFilter {
  clientId?: string;
  search?: string | undefined;
  advisorId?: string | undefined;
  archived?: boolean;
}

function likePattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

async function classValues(tx: Tx, clientIds: string[]): Promise<Map<string, ClassValues>> {
  const values = new Map<string, ClassValues>();
  if (clientIds.length === 0) return values;
  const { rows } = await tx.query<{ client_id: string; asset_class: AssetClass; value: number }>(
    `SELECT a.client_id, s.asset_class, sum(round(h.quantity * s.price_pence))::bigint AS value
       FROM holdings h
       JOIN accounts a ON a.id = h.account_id
       JOIN securities s ON s.symbol = h.symbol
      WHERE a.client_id = ANY($1::uuid[])
      GROUP BY a.client_id, s.asset_class
     UNION ALL
     SELECT client_id, 'cash', sum(cash_pence)::bigint
       FROM accounts
      WHERE client_id = ANY($1::uuid[])
      GROUP BY client_id`,
    [clientIds],
  );
  for (const row of rows) {
    const byClass = values.get(row.client_id) ?? {};
    byClass[row.asset_class] = (byClass[row.asset_class] ?? 0) + row.value;
    values.set(row.client_id, byClass);
  }
  return values;
}

function summarise(row: ClientRow, values: ClassValues): ClientSummary {
  const allocation = allocate(values, row.risk_profile);
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    riskProfile: row.risk_profile,
    advisor:
      row.advisor_id && row.advisor_name ? { id: row.advisor_id, name: row.advisor_name } : null,
    valuePence: allocation.totalPence,
    accountCount: row.account_count,
    maxDriftBps: allocation.maxDriftBps,
    archived: row.archived_at !== null,
    createdAt: row.created_at.toISOString(),
  };
}

export async function listClients(tx: Tx, filter: ClientFilter): Promise<ClientSummary[]> {
  const { rows } = await tx.query<ClientRow>(
    `SELECT c.id, c.name, c.email, c.risk_profile, c.created_at, c.archived_at,
            u.id AS advisor_id, u.name AS advisor_name,
            (SELECT count(*) FROM accounts a WHERE a.client_id = c.id)::int AS account_count
       FROM clients c
       LEFT JOIN users u ON u.tenant_id = c.tenant_id AND u.id = c.advisor_id
      WHERE ($1::uuid IS NULL OR c.id = $1)
        AND ($2::text IS NULL OR c.name ILIKE $2 OR c.email ILIKE $2)
        AND ($3::uuid IS NULL OR c.advisor_id = $3)
        AND ($4::boolean IS NULL OR (c.archived_at IS NOT NULL) = $4)
      ORDER BY lower(c.name), c.id`,
    [
      filter.clientId ?? null,
      filter.search ? likePattern(filter.search) : null,
      filter.advisorId ?? null,
      filter.archived ?? null,
    ],
  );
  const values = await classValues(
    tx,
    rows.map((row) => row.id),
  );
  return rows.map((row) => summarise(row, values.get(row.id) ?? {}));
}

/** Total value per asset class across every client of the firm (for the dashboard). */
export async function firmClassValues(tx: Tx, clientIds: string[]): Promise<ClassValues> {
  const totals: ClassValues = {};
  for (const byClass of (await classValues(tx, clientIds)).values()) {
    for (const [assetClass, value] of Object.entries(byClass) as [AssetClass, number][]) {
      totals[assetClass] = (totals[assetClass] ?? 0) + value;
    }
  }
  return totals;
}

interface PositionRow {
  account_id: string;
  account_name: string;
  type: AccountType;
  cash_pence: number;
  holding_id: string | null;
  symbol: string | null;
  security_name: string | null;
  asset_class: AssetClass | null;
  quantity: string | null;
  price_pence: number | null;
  value_pence: number | null;
  book_cost_pence: number | null;
}

/** "12.500000" (NUMERIC(20,6) as text) -> "12.5" */
function displayQuantity(quantity: string): string {
  return quantity.includes(".") ? quantity.replace(/\.?0+$/, "") : quantity;
}

function toHolding(row: PositionRow): Holding | null {
  if (
    row.holding_id === null ||
    row.symbol === null ||
    row.security_name === null ||
    row.asset_class === null ||
    row.quantity === null ||
    row.price_pence === null ||
    row.value_pence === null ||
    row.book_cost_pence === null
  ) {
    return null;
  }
  return {
    id: row.holding_id,
    symbol: row.symbol,
    name: row.security_name,
    assetClass: row.asset_class,
    quantity: displayQuantity(row.quantity),
    pricePence: row.price_pence,
    valuePence: row.value_pence,
    bookCostPence: row.book_cost_pence,
    gainPence: row.value_pence - row.book_cost_pence,
  };
}

async function accountsWhere(tx: Tx, column: "client_id" | "id", id: string): Promise<Account[]> {
  const { rows } = await tx.query<PositionRow>(
    `SELECT a.id AS account_id, a.name AS account_name, a.type, a.cash_pence,
            h.id AS holding_id, h.symbol, s.name AS security_name, s.asset_class,
            h.quantity::text AS quantity, s.price_pence,
            round(h.quantity * s.price_pence)::bigint AS value_pence, h.book_cost_pence
       FROM accounts a
       LEFT JOIN holdings h ON h.account_id = a.id
       LEFT JOIN securities s ON s.symbol = h.symbol
      WHERE a.${column} = $1
      ORDER BY a.created_at, a.id, s.name`,
    [id],
  );
  const accounts = new Map<string, Account>();
  for (const row of rows) {
    let account = accounts.get(row.account_id);
    if (!account) {
      account = {
        id: row.account_id,
        name: row.account_name,
        type: row.type,
        cashPence: row.cash_pence,
        valuePence: row.cash_pence,
        holdings: [],
      };
      accounts.set(row.account_id, account);
    }
    const holding = toHolding(row);
    if (holding) {
      account.holdings.push(holding);
      account.valuePence += holding.valuePence;
    }
  }
  return [...accounts.values()];
}

export async function getAccount(tx: Tx, accountId: string): Promise<Account | null> {
  const [account] = await accountsWhere(tx, "id", accountId);
  return account ?? null;
}

export async function getClient(tx: Tx, clientId: string): Promise<ClientDetail | null> {
  const { rows } = await tx.query<ClientRow>(
    `SELECT c.id, c.name, c.email, c.risk_profile, c.created_at, c.archived_at,
            u.id AS advisor_id, u.name AS advisor_name,
            (SELECT count(*) FROM accounts a WHERE a.client_id = c.id)::int AS account_count
       FROM clients c
       LEFT JOIN users u ON u.tenant_id = c.tenant_id AND u.id = c.advisor_id
      WHERE c.id = $1`,
    [clientId],
  );
  const row = rows[0];
  if (!row) return null;

  const accounts = await accountsWhere(tx, "client_id", clientId);
  const values: ClassValues = {};
  let bookCostPence = 0;
  for (const account of accounts) {
    values.cash = (values.cash ?? 0) + account.cashPence;
    bookCostPence += account.cashPence;
    for (const holding of account.holdings) {
      values[holding.assetClass] = (values[holding.assetClass] ?? 0) + holding.valuePence;
      bookCostPence += holding.bookCostPence;
    }
  }
  const summary = summarise(row, values);
  const allocation = allocate(values, row.risk_profile);
  return {
    ...summary,
    accounts,
    allocation: allocation.lines,
    bookCostPence,
    gainPence: summary.valuePence - bookCostPence,
  };
}

export async function clientExists(tx: Tx, clientId: string): Promise<boolean> {
  const { rowCount } = await tx.query("SELECT 1 FROM clients WHERE id = $1", [clientId]);
  return rowCount === 1;
}
