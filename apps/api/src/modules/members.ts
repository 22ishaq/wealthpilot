import {
  inviteSchema,
  memberUpdateSchema,
  type CreatedInvitation,
  type Invitation,
  type Member,
  type Role,
} from "@wealthpilot/shared";
import { Router, type Request } from "express";

import { hashToken, newToken } from "../auth/crypto.js";
import { withTenant, type Tx } from "../db.js";
import { firstRow, type Deps } from "../deps.js";
import { AppError, notFound } from "../errors.js";
import { authOf, paramId, requirePermission, scopeOf } from "../http/middleware.js";
import { recordAudit } from "./audit.js";

const INVITATION_TTL_DAYS = 7;
const canManage = requirePermission("members:manage");

interface MemberRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  created_at: Date;
  deactivated_at: Date | null;
}

function toMember(row: MemberRow): Member {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    active: row.deactivated_at === null,
    createdAt: row.created_at.toISOString(),
  };
}

interface InvitationRow {
  id: string;
  email: string;
  role: Role;
  created_at: Date;
  expires_at: Date;
}

function toInvitation(row: InvitationRow): Invitation {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
  };
}

/** Load a member who may be changed by the current user: not themselves, never the owner. */
async function changeableMember(tx: Tx, req: Request, userId: string): Promise<MemberRow> {
  const { rows } = await tx.query<MemberRow>(
    "SELECT id, email, name, role, created_at, deactivated_at FROM users WHERE id = $1",
    [userId],
  );
  const member = rows[0];
  if (!member) throw notFound("Member");
  if (member.id === authOf(req).userId) {
    throw new AppError(422, "CANNOT_CHANGE_SELF", "You cannot change your own membership");
  }
  if (member.role === "owner") {
    throw new AppError(403, "OWNER_PROTECTED", "The firm owner cannot be changed");
  }
  return member;
}

export function membersRouter({ pool, config }: Deps): Router {
  const router = Router();
  const tenant = <T>(req: Request, fn: (tx: Tx) => Promise<T>) =>
    withTenant(pool, scopeOf(req), fn);

  router.get("/", async (req, res) => {
    const { rows } = await tenant(req, (tx) =>
      tx.query<MemberRow>(
        `SELECT id, email, name, role, created_at, deactivated_at FROM users
          ORDER BY deactivated_at IS NOT NULL, created_at, id`,
      ),
    );
    res.json(rows.map(toMember));
  });

  router.get("/invitations", canManage, async (req, res) => {
    const { rows } = await tenant(req, (tx) =>
      tx.query<InvitationRow>(
        `SELECT id, email, role, created_at, expires_at FROM invitations
          WHERE accepted_at IS NULL AND expires_at > now()
          ORDER BY created_at DESC`,
      ),
    );
    res.json(rows.map(toInvitation));
  });

  router.post("/invitations", canManage, async (req, res) => {
    const input = inviteSchema.parse(req.body);
    const token = newToken();
    const invitation = await tenant(req, async (tx) => {
      const existing = await tx.query("SELECT 1 FROM users WHERE email = $1", [input.email]);
      if (existing.rowCount) {
        throw new AppError(409, "ALREADY_MEMBER", "That person is already a member of your firm");
      }
      // A new invitation replaces any earlier pending one for the same address.
      await tx.query("DELETE FROM invitations WHERE email = $1 AND accepted_at IS NULL", [
        input.email,
      ]);
      const { rows } = await tx.query<InvitationRow>(
        `INSERT INTO invitations (tenant_id, token_hash, email, role, invited_by, expires_at)
         VALUES (app_current_tenant(), $1, $2, $3, $4, now() + make_interval(days => $5))
         RETURNING id, email, role, created_at, expires_at`,
        [hashToken(token), input.email, input.role, authOf(req).userId, INVITATION_TTL_DAYS],
      );
      const row = firstRow(rows);
      await recordAudit(tx, authOf(req).userId, "member.invited", "invitation", row.id, {
        email: input.email,
        role: input.role,
      });
      return toInvitation(row);
    });
    const created: CreatedInvitation = {
      ...invitation,
      inviteUrl: `${config.appOrigin}/invite/${token}`,
    };
    res.status(201).json(created);
  });

  router.delete("/invitations/:invitationId", canManage, async (req, res) => {
    const invitationId = paramId(req, "invitationId", "Invitation");
    await tenant(req, async (tx) => {
      const { rowCount } = await tx.query(
        "DELETE FROM invitations WHERE id = $1 AND accepted_at IS NULL",
        [invitationId],
      );
      if (rowCount !== 1) throw notFound("Invitation");
      await recordAudit(tx, authOf(req).userId, "invitation.revoked", "invitation", invitationId);
    });
    res.status(204).end();
  });

  router.patch("/:userId", canManage, async (req, res) => {
    const userId = paramId(req, "userId", "Member");
    const input = memberUpdateSchema.parse(req.body);
    const member = await tenant(req, async (tx) => {
      const current = await changeableMember(tx, req, userId);
      const { rows } = await tx.query<MemberRow>(
        `UPDATE users SET role = $2 WHERE id = $1
         RETURNING id, email, name, role, created_at, deactivated_at`,
        [userId, input.role],
      );
      await recordAudit(tx, authOf(req).userId, "member.role_changed", "user", userId, {
        from: current.role,
        to: input.role,
      });
      return toMember(firstRow(rows));
    });
    res.json(member);
  });

  router.delete("/:userId", canManage, async (req, res) => {
    const userId = paramId(req, "userId", "Member");
    await tenant(req, async (tx) => {
      await changeableMember(tx, req, userId);
      await tx.query(
        "UPDATE users SET deactivated_at = coalesce(deactivated_at, now()) WHERE id = $1",
        [userId],
      );
      await tx.query("SELECT auth_revoke_user_sessions($1)", [userId]);
      await recordAudit(tx, authOf(req).userId, "member.deactivated", "user", userId);
    });
    res.status(204).end();
  });

  return router;
}
