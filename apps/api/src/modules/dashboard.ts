import { DRIFT_ALERT_BPS, allocate, type Dashboard, type Security } from "@wealthpilot/shared";
import { Router } from "express";

import { withTenant } from "../db.js";
import type { Deps } from "../deps.js";
import { scopeOf } from "../http/middleware.js";
import { recentAudit } from "./audit.js";
import { firmClassValues, listClients } from "./portfolio.js";

export function dashboardRouter({ pool }: Deps): Router {
  const router = Router();
  router.get("/", async (req, res) => {
    const dashboard = await withTenant(pool, scopeOf(req), async (tx): Promise<Dashboard> => {
      const clients = await listClients(tx, { archived: false });
      const totals = await firmClassValues(
        tx,
        clients.map((client) => client.id),
      );
      const firm = allocate(totals, null);
      const byValue = [...clients].sort((a, b) => b.valuePence - a.valuePence);
      return {
        aumPence: firm.totalPence,
        clientCount: clients.length,
        accountCount: clients.reduce((sum, client) => sum + client.accountCount, 0),
        allocation: firm.lines,
        topClients: byValue.slice(0, 5),
        driftAlerts: clients
          .filter((client) => client.valuePence > 0 && client.maxDriftBps >= DRIFT_ALERT_BPS)
          .sort((a, b) => b.maxDriftBps - a.maxDriftBps)
          .slice(0, 5),
        recentActivity: await recentAudit(tx, 8),
      };
    });
    res.json(dashboard);
  });
  return router;
}

interface SecurityRow {
  symbol: string;
  name: string;
  asset_class: Security["assetClass"];
  price_pence: number;
  price_date: string;
}

export function securitiesRouter({ pool }: Deps): Router {
  const router = Router();
  router.get("/", async (req, res) => {
    const { rows } = await withTenant(pool, scopeOf(req), (tx) =>
      tx.query<SecurityRow>(
        `SELECT symbol, name, asset_class, price_pence, to_char(price_date, 'YYYY-MM-DD') AS price_date
           FROM securities ORDER BY asset_class, name`,
      ),
    );
    const securities: Security[] = rows.map((row) => ({
      symbol: row.symbol,
      name: row.name,
      assetClass: row.asset_class,
      pricePence: row.price_pence,
      priceDate: row.price_date,
    }));
    res.json(securities);
  });
  return router;
}
