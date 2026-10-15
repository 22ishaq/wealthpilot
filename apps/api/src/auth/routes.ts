import { randomUUID } from "node:crypto";

import {
  acceptInviteSchema,
  loginSchema,
  signupSchema,
  type InvitationPreview,
  type Me,
  type Role,
} from "@wealthpilot/shared";
import { Router, type CookieOptions, type Response } from "express";

import type { Config } from "../config.js";
import { transaction, withTenant, type Tx } from "../db.js";
import { firstRow, type Deps } from "../deps.js";
import { AppError, notFound } from "../errors.js";
import {
  SESSION_COOKIE,
  authOf,
  credentialRateLimit,
  requireAuth,
  sessionToken,
  type AuthContext,
} from "../http/middleware.js";
import { recordAudit } from "../modules/audit.js";
import { hashPassword, hashToken, newToken, verifyPassword } from "./crypto.js";

function cookieOptions(config: Config): CookieOptions {
  return { httpOnly: true, secure: config.cookieSecure, sameSite: "lax", path: "/" };
}

export function meOf(
  auth: Pick<AuthContext, "userId" | "email" | "name" | "role" | "tenantId" | "tenantName">,
): Me {
  return {
    user: { id: auth.userId, email: auth.email, name: auth.name, role: auth.role },
    tenant: { id: auth.tenantId, name: auth.tenantName },
  };
}

interface SessionRow {
  user_id: string;
  tenant_id: string;
  tenant_name: string;
  email: string;
  name: string;
  role: Role;
}

/** Create a session for `userId` inside `tx`, set the cookie, and describe who signed in. */
async function startSession(tx: Tx, res: Response, userId: string, config: Config): Promise<Me> {
  const token = newToken();
  const tokenHash = hashToken(token);
  await tx.query("SELECT auth_create_session($1, $2, make_interval(hours => $3))", [
    tokenHash,
    userId,
    config.sessionTtlHours,
  ]);
  const { rows } = await tx.query<SessionRow>(
    "SELECT user_id, tenant_id, tenant_name, email, name, role FROM auth_resolve_session($1)",
    [tokenHash],
  );
  const row = firstRow(rows);
  res.cookie(SESSION_COOKIE, token, {
    ...cookieOptions(config),
    maxAge: config.sessionTtlHours * 3_600_000,
  });
  return meOf({
    userId: row.user_id,
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    email: row.email,
    name: row.name,
    role: row.role,
  });
}

interface InvitationRow {
  invitation_id: string;
  tenant_id: string;
  tenant_name: string;
  email: string;
  role: Role;
}

export function authRouter({ pool, config }: Deps): Router {
  const router = Router();
  const throttle = credentialRateLimit(config.loginRateLimit);
  // Verifying against this when the email is unknown keeps the response time the same,
  // so timing does not reveal which addresses have accounts.
  const decoyHash = hashPassword(newToken(), config.scryptCost);

  router.post("/signup", throttle, async (req, res) => {
    const input = signupSchema.parse(req.body);
    const passwordHash = await hashPassword(input.password, config.scryptCost);
    const tenantId = randomUUID();
    const me = await withTenant(pool, { tenantId, userId: null }, async (tx) => {
      await tx.query("INSERT INTO tenants (id, name) VALUES ($1, $2)", [tenantId, input.firmName]);
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO users (tenant_id, email, name, role, password_hash)
         VALUES (app_current_tenant(), $1, $2, 'owner', $3) RETURNING id`,
        [input.email, input.name, passwordHash],
      );
      const userId = firstRow(rows).id;
      await recordAudit(tx, userId, "firm.created", "tenant", tenantId, { name: input.firmName });
      return startSession(tx, res, userId, config);
    });
    res.status(201).json(me);
  });

  router.post("/login", throttle, async (req, res) => {
    const input = loginSchema.parse(req.body);
    const { rows } = await pool.query<{ user_id: string; password_hash: string }>(
      "SELECT user_id, password_hash FROM auth_login_lookup($1)",
      [input.email],
    );
    const user = rows[0];
    const valid = await verifyPassword(input.password, user?.password_hash ?? (await decoyHash));
    if (!user || !valid) {
      throw new AppError(401, "INVALID_CREDENTIALS", "Email or password is incorrect");
    }
    res.json(await transaction(pool, (tx) => startSession(tx, res, user.user_id, config)));
  });

  router.post("/logout", async (req, res) => {
    const token = sessionToken(req);
    if (token) await pool.query("SELECT auth_revoke_session($1)", [hashToken(token)]);
    res.clearCookie(SESSION_COOKIE, cookieOptions(config));
    res.status(204).end();
  });

  router.get("/me", requireAuth, (req, res) => {
    res.json(meOf(authOf(req)));
  });

  async function findInvitation(token: string): Promise<InvitationRow | undefined> {
    const { rows } = await pool.query<InvitationRow>(
      "SELECT invitation_id, tenant_id, tenant_name, email, role FROM auth_invitation_lookup($1)",
      [hashToken(token)],
    );
    return rows[0];
  }

  router.get("/invitations/:token", async (req, res) => {
    const invitation = await findInvitation(req.params.token);
    if (!invitation) throw notFound("Invitation");
    const preview: InvitationPreview = {
      firmName: invitation.tenant_name,
      email: invitation.email,
      role: invitation.role,
    };
    res.json(preview);
  });

  router.post("/invitations/accept", throttle, async (req, res) => {
    const input = acceptInviteSchema.parse(req.body);
    const invalid = new AppError(
      410,
      "INVITATION_INVALID",
      "This invitation is invalid, used or expired",
    );
    const invitation = await findInvitation(input.token);
    if (!invitation) throw invalid;
    const passwordHash = await hashPassword(input.password, config.scryptCost);
    const scope = { tenantId: invitation.tenant_id, userId: null };
    const me = await withTenant(pool, scope, async (tx) => {
      // Claim the invitation first: of two concurrent accepts, exactly one gets a row.
      const claimed = await tx.query(
        `UPDATE invitations SET accepted_at = now()
          WHERE id = $1 AND accepted_at IS NULL AND expires_at > now()`,
        [invitation.invitation_id],
      );
      if (claimed.rowCount !== 1) throw invalid;
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO users (tenant_id, email, name, role, password_hash)
         VALUES (app_current_tenant(), $1, $2, $3, $4) RETURNING id`,
        [invitation.email, input.name, invitation.role, passwordHash],
      );
      const userId = firstRow(rows).id;
      await recordAudit(tx, userId, "member.joined", "user", userId, { role: invitation.role });
      return startSession(tx, res, userId, config);
    });
    res.status(201).json(me);
  });

  return router;
}
