import { randomUUID } from "node:crypto";

import cookieParser from "cookie-parser";
import express, { type Express } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";

import { authRouter } from "./auth/routes.js";
import type { Deps } from "./deps.js";
import { errorHandler, notFound } from "./errors.js";
import { authenticate, csrfGuard, requireAuth, requirePermission } from "./http/middleware.js";
import { auditRouter } from "./modules/audit.js";
import { accountsRouter, clientsRouter, holdingsRouter } from "./modules/clients.js";
import { dashboardRouter, securitiesRouter } from "./modules/dashboard.js";
import { membersRouter } from "./modules/members.js";

export function createApp(deps: Deps): Express {
  const { pool, config, logger } = deps;
  const app = express();
  app.disable("x-powered-by");
  if (config.trustProxy) app.set("trust proxy", 1);

  app.use(helmet());
  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const id = randomUUID();
        res.setHeader("X-Request-Id", id);
        return id;
      },
      redact: ["req.headers.cookie", 'res.headers["set-cookie"]'],
    }),
  );
  app.use("/api", csrfGuard(config.appOrigin));
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  app.get("/api/ready", async (_req, res) => {
    await pool.query("SELECT 1");
    res.json({ status: "ready" });
  });

  app.use("/api", authenticate(pool));
  app.use("/api/auth", authRouter(deps));
  app.use("/api/members", requireAuth, membersRouter(deps));
  app.use("/api/clients", requireAuth, clientsRouter(deps));
  app.use("/api/accounts", requireAuth, accountsRouter(deps));
  app.use("/api/holdings", requireAuth, holdingsRouter(deps));
  app.use("/api/securities", requireAuth, securitiesRouter(deps));
  app.use("/api/dashboard", requireAuth, dashboardRouter(deps));
  app.use("/api/audit", requireAuth, requirePermission("audit:read"), auditRouter(deps));
  app.use("/api", (_req, _res, next) => {
    next(notFound("Route"));
  });

  app.use(errorHandler(logger));
  return app;
}
