import type { Dashboard, Member } from "@wealthpilot/shared";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { loadMigrations, migrate } from "../src/migrate.js";
import { DEMO_OWNER_EMAIL, seedDemo } from "../src/seed.js";
import { app, config, pool } from "./helpers.js";

const adminUrl = process.env["TEST_ADMIN_DATABASE_URL"] ?? "";

describe("migrations", () => {
  it("are idempotent", async () => {
    expect(await migrate(adminUrl)).toEqual([]);
  });

  it("refuse to run if an applied file was edited", async () => {
    const edited = (await loadMigrations()).map((migration) => ({
      ...migration,
      sql: `${migration.sql}\n-- edited`,
    }));
    await expect(migrate(adminUrl, edited)).rejects.toThrow(/was edited after it was applied/);
  });
});

describe("demo seed", () => {
  it("builds a working demo firm once", async () => {
    expect(await seedDemo(pool, "demo-password-123", config.scryptCost)).toBe(true);
    expect(await seedDemo(pool, "demo-password-123", config.scryptCost)).toBe(false);

    const agent = request.agent(app);
    await agent
      .post("/api/auth/login")
      .send({ email: DEMO_OWNER_EMAIL, password: "demo-password-123" })
      .expect(200);
    const dashboard = (await agent.get("/api/dashboard").expect(200)).body as Dashboard;
    expect(dashboard.clientCount).toBe(12);
    expect(dashboard.accountCount).toBe(36);
    expect(dashboard.aumPence).toBeGreaterThan(500_000_000);
    expect(dashboard.driftAlerts.length).toBeGreaterThan(0);
    const members = (await agent.get("/api/members").expect(200)).body as Member[];
    expect(members.map((member) => member.role).sort()).toEqual([
      "advisor",
      "advisor",
      "owner",
      "viewer",
    ]);
  });
});
