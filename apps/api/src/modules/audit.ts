import type { AuditEvent } from "@wealthpilot/shared";
import { Router } from "express";
import { z } from "zod";

import { withTenant, type Tx } from "../db.js";
import type { Deps } from "../deps.js";
import { scopeOf } from "../http/middleware.js";

/**
 * Append-only audit trail. Events are written in the same transaction as the change they
 * describe, and the tenant comes from the transaction's scope rather than a parameter.
 */
export async function recordAudit(
  tx: Tx,
  actorId: string | null,
  action: string,
  entityType: string,
  entityId: string | null,
  details: Record<string, unknown> = {},
): Promise<void> {
  await tx.query(
    `INSERT INTO audit_events (tenant_id, actor_id, action, entity_type, entity_id, details)
     VALUES (app_current_tenant(), $1, $2, $3, $4, $5)`,
    [actorId, action, entityType, entityId, JSON.stringify(details)],
  );
}

interface AuditRow {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: Record<string, unknown>;
  created_at: Date;
  actor_id: string | null;
  actor_name: string | null;
}

export async function recentAudit(tx: Tx, limit: number): Promise<AuditEvent[]> {
  const { rows } = await tx.query<AuditRow>(
    `SELECT e.id::text AS id, e.action, e.entity_type, e.entity_id, e.details, e.created_at,
            u.id AS actor_id, u.name AS actor_name
       FROM audit_events e
       LEFT JOIN users u ON u.tenant_id = e.tenant_id AND u.id = e.actor_id
      ORDER BY e.id DESC
      LIMIT $1`,
    [limit],
  );
  return rows.map((row) => ({
    id: row.id,
    actor: row.actor_id && row.actor_name ? { id: row.actor_id, name: row.actor_name } : null,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    details: row.details,
    createdAt: row.created_at.toISOString(),
  }));
}

const QuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export function auditRouter({ pool }: Deps): Router {
  const router = Router();
  router.get("/", async (req, res) => {
    const { limit } = QuerySchema.parse(req.query);
    res.json(await withTenant(pool, scopeOf(req), (tx) => recentAudit(tx, limit)));
  });
  return router;
}
