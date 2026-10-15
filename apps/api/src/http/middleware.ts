import { ROLES, can, idSchema, type Permission, type Role } from "@wealthpilot/shared";
import type { Request, RequestHandler } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";

import { hashToken } from "../auth/crypto.js";
import type { Pool, TenantScope } from "../db.js";
import { AppError, forbidden, notFound, unauthenticated } from "../errors.js";

export const SESSION_COOKIE = "wp_session";

export interface AuthContext {
  userId: string;
  tenantId: string;
  tenantName: string;
  email: string;
  name: string;
  role: Role;
  tokenHash: string;
}

declare module "express-serve-static-core" {
  interface Request {
    auth?: AuthContext;
  }
}

function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export function sessionToken(req: Request): string | null {
  const cookies: Record<string, unknown> = req.cookies as Record<string, unknown>;
  const token = cookies[SESSION_COOKIE];
  return typeof token === "string" && token.length > 0 && token.length <= 128 ? token : null;
}

interface SessionRow {
  user_id: string;
  tenant_id: string;
  tenant_name: string;
  email: string;
  name: string;
  role: string;
}

/** Resolves the session cookie, if any, into `req.auth`. Never trusts tenant ids from clients. */
export function authenticate(pool: Pool): RequestHandler {
  return async (req, _res, next) => {
    const token = sessionToken(req);
    if (token) {
      const tokenHash = hashToken(token);
      const { rows } = await pool.query<SessionRow>(
        "SELECT user_id, tenant_id, tenant_name, email, name, role FROM auth_resolve_session($1)",
        [tokenHash],
      );
      const row = rows[0];
      if (row && isRole(row.role)) {
        req.auth = {
          userId: row.user_id,
          tenantId: row.tenant_id,
          tenantName: row.tenant_name,
          email: row.email,
          name: row.name,
          role: row.role,
          tokenHash,
        };
      }
    }
    next();
  };
}

export function authOf(req: Request): AuthContext {
  if (!req.auth) throw unauthenticated();
  return req.auth;
}

export function scopeOf(req: Request): TenantScope {
  const { tenantId, userId } = authOf(req);
  return { tenantId, userId };
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  next(req.auth ? undefined : unauthenticated());
};

export function requirePermission(permission: Permission): RequestHandler {
  return (req, _res, next) => {
    next(can(authOf(req).role, permission) ? undefined : forbidden());
  };
}

/** A route parameter that must be a UUID. A malformed id is simply a missing resource. */
export function paramId(req: Request, name: string, what: string): string {
  const parsed = idSchema.safeParse(req.params[name]);
  if (!parsed.success) throw notFound(what);
  return parsed.data;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF defence for cookie sessions, on top of SameSite=Lax: state-changing requests must come
 * from our own origin (when the browser says where they come from) and must be JSON, which
 * a cross-site HTML form cannot send without a CORS preflight that we never approve.
 */
export function csrfGuard(allowedOrigin: string): RequestHandler {
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) {
      next();
      return;
    }
    const origin = req.get("origin");
    if (origin !== undefined && origin !== allowedOrigin) {
      next(new AppError(403, "CSRF_REJECTED", "Cross-site request rejected"));
      return;
    }
    // `Content-Length: 0` is what browsers send for a POST without a body; that is not a body.
    const length = req.get("content-length");
    const hasBody =
      req.get("transfer-encoding") !== undefined || (length !== undefined && length !== "0");
    if (hasBody && !req.is("application/json")) {
      next(new AppError(415, "UNSUPPORTED_MEDIA_TYPE", "Send the request body as JSON"));
      return;
    }
    next();
  };
}

function bodyEmail(body: unknown): string {
  if (typeof body === "object" && body !== null && "email" in body) {
    const email: unknown = body.email;
    if (typeof email === "string") return email.trim().toLowerCase();
  }
  return "";
}

/** Throttles credential guessing per client address and account. */
export function credentialRateLimit(limit: number): RequestHandler {
  return rateLimit({
    windowMs: 15 * 60_000,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? "unknown")}|${bodyEmail(req.body)}`,
    handler: (_req, res) => {
      res.status(429).json({
        error: { code: "RATE_LIMITED", message: "Too many attempts; try again later" },
      });
    },
  });
}
