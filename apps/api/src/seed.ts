/**
 * Demo data: one firm, four team members and a dozen households with realistic portfolios.
 * Writes through the restricted application role and tenant scope, exactly like the API.
 * Idempotent: does nothing if the demo owner already exists.
 */

import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

import {
  ASSET_CLASSES,
  TARGET_ALLOCATIONS,
  type AccountType,
  type AssetClass,
  type RiskProfile,
  type Role,
} from "@wealthpilot/shared";

import { hashPassword } from "./auth/crypto.js";
import { loadConfig } from "./config.js";
import { createPool, withTenant, type Pool, type Tx } from "./db.js";
import { firstRow } from "./deps.js";
import { recordAudit } from "./modules/audit.js";

export const DEMO_OWNER_EMAIL = "demo@northwind.test";

const TEAM: { name: string; email: string; role: Role }[] = [
  { name: "Amelia Hart", email: DEMO_OWNER_EMAIL, role: "owner" },
  { name: "Daniel Okafor", email: "daniel@northwind.test", role: "advisor" },
  { name: "Priya Shah", email: "priya@northwind.test", role: "advisor" },
  { name: "Tom Bennett", email: "tom@northwind.test", role: "viewer" },
];

const HOUSEHOLDS: { name: string; risk: RiskProfile; wealthPounds: number }[] = [
  { name: "Ahmed Family Trust", risk: "growth", wealthPounds: 1_240_000 },
  { name: "Beatrice & Colin Walsh", risk: "conservative", wealthPounds: 615_000 },
  { name: "Chen Household", risk: "balanced", wealthPounds: 342_000 },
  { name: "Dr. Imogen Fraser", risk: "adventurous", wealthPounds: 188_000 },
  { name: "Evans Retirement Fund", risk: "conservative", wealthPounds: 905_000 },
  { name: "Fatima Rahman", risk: "growth", wealthPounds: 96_500 },
  { name: "Gareth & Lowri Jones", risk: "balanced", wealthPounds: 457_000 },
  { name: "Hiroshi Tanaka", risk: "adventurous", wealthPounds: 723_000 },
  { name: "Isla MacLeod", risk: "balanced", wealthPounds: 64_000 },
  { name: "Kowalski Family", risk: "growth", wealthPounds: 271_000 },
  { name: "Lucy Adeyemi", risk: "conservative", wealthPounds: 132_000 },
  { name: "Morgan Holdings Ltd", risk: "balanced", wealthPounds: 2_050_000 },
];

const ACCOUNT_PLAN: { type: AccountType; name: string; share: number }[] = [
  { type: "isa", name: "Stocks & Shares ISA", share: 30 },
  { type: "sipp", name: "SIPP", share: 50 },
  { type: "gia", name: "General Investment Account", share: 20 },
];

/** Small deterministic PRNG (mulberry32) so every seed run builds the same demo. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

interface SecurityRow {
  symbol: string;
  asset_class: AssetClass;
  price_pence: number;
}

async function addPortfolio(
  tx: Tx,
  clientId: string,
  risk: RiskProfile,
  wealthPence: number,
  securities: SecurityRow[],
  next: () => number,
): Promise<void> {
  for (const plan of ACCOUNT_PLAN) {
    const accountValue = Math.floor((wealthPence * plan.share) / 100);
    const cash = Math.floor(accountValue * 0.02);
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO accounts (tenant_id, client_id, name, type, cash_pence)
       VALUES (app_current_tenant(), $1, $2, $3, $4) RETURNING id`,
      [clientId, plan.name, plan.type, cash],
    );
    const accountId = firstRow(rows).id;
    for (const assetClass of ASSET_CLASSES) {
      // Deliberate noise around the target, so some clients drift far enough to need rebalancing.
      const tilt = 0.6 + next() * 0.8;
      const target = (TARGET_ALLOCATIONS[risk][assetClass] / 10_000) * tilt;
      const candidates = securities.filter((security) => security.asset_class === assetClass);
      const security = candidates[Math.floor(next() * candidates.length)];
      if (!security || target === 0) continue;
      const units = Math.floor(((accountValue - cash) * target) / security.price_pence);
      if (units < 1) continue;
      const bookCost = Math.round(units * security.price_pence * (0.78 + next() * 0.3));
      await tx.query(
        `INSERT INTO holdings (tenant_id, account_id, symbol, quantity, book_cost_pence)
         VALUES (app_current_tenant(), $1, $2, $3, $4)`,
        [accountId, security.symbol, String(units), bookCost],
      );
    }
  }
}

export async function seedDemo(pool: Pool, password: string, scryptCost: number): Promise<boolean> {
  const existing = await pool.query("SELECT 1 FROM auth_login_lookup($1)", [DEMO_OWNER_EMAIL]);
  if (existing.rowCount) return false;

  const tenantId = randomUUID();
  const passwordHash = await hashPassword(password, scryptCost);
  await withTenant(pool, { tenantId, userId: null }, async (tx) => {
    await tx.query("INSERT INTO tenants (id, name) VALUES ($1, $2)", [
      tenantId,
      "Northwind Wealth Partners",
    ]);
    const team: string[] = [];
    for (const member of TEAM) {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO users (tenant_id, email, name, role, password_hash)
         VALUES (app_current_tenant(), $1, $2, $3, $4) RETURNING id`,
        [member.email, member.name, member.role, passwordHash],
      );
      team.push(firstRow(rows).id);
    }
    const [ownerId, ...others] = team;
    const advisors = others.slice(0, 2);
    await recordAudit(tx, ownerId ?? null, "firm.created", "tenant", tenantId, {
      name: "Northwind Wealth Partners",
    });

    const { rows: securities } = await tx.query<SecurityRow>(
      "SELECT symbol, asset_class, price_pence FROM securities",
    );
    const next = random(20261015);
    for (const [index, household] of HOUSEHOLDS.entries()) {
      const advisorId = advisors[index % advisors.length] ?? null;
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO clients (tenant_id, name, email, risk_profile, advisor_id)
         VALUES (app_current_tenant(), $1, $2, $3, $4) RETURNING id`,
        [
          household.name,
          `${household.name
            .toLowerCase()
            .replace(/[^a-z]+/g, ".")
            .replace(/^\.|\.$/g, "")}@example.com`,
          household.risk,
          advisorId,
        ],
      );
      const clientId = firstRow(rows).id;
      await addPortfolio(
        tx,
        clientId,
        household.risk,
        household.wealthPounds * 100,
        securities,
        next,
      );
      await recordAudit(tx, advisorId, "client.created", "client", clientId, {
        name: household.name,
      });
    }
  });
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = loadConfig();
  const password = process.env["DEMO_PASSWORD"] ?? "wealthpilot-demo";
  const pool = createPool(config.databaseUrl, 2);
  seedDemo(pool, password, config.scryptCost)
    .then((created) => {
      console.log(
        created
          ? `Seeded demo firm. Sign in as ${DEMO_OWNER_EMAIL} / ${password}`
          : "Demo firm already exists; nothing to do.",
      );
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => void pool.end());
}
