import type { Dashboard } from "@wealthpilot/shared";
import { describe, expect, it } from "vitest";

import { addHolding, createClient, openAccount, signUp } from "./helpers.js";

describe("dashboard", () => {
  it("starts empty for a new firm", async () => {
    const { agent } = await signUp("Empty Firm");
    const dashboard = (await agent.get("/api/dashboard").expect(200)).body as Dashboard;
    expect(dashboard).toMatchObject({
      aumPence: 0,
      clientCount: 0,
      accountCount: 0,
      topClients: [],
      driftAlerts: [],
    });
    expect(dashboard.allocation.every((line) => line.valuePence === 0)).toBe(true);
    expect(dashboard.recentActivity.map((event) => event.action)).toEqual(["firm.created"]);
  });

  it("aggregates assets, ranks clients and flags drift", async () => {
    const { agent } = await signUp("Busy Firm");

    const steady = await createClient(agent, { name: "Steady", riskProfile: "adventurous" });
    const steadyAccount = await openAccount(agent, steady.id);
    await addHolding(agent, steadyAccount.id, "VWRL", "90", "1.00"); // equity only: drift 10pp
    const big = await createClient(agent, { name: "Big", riskProfile: "balanced" });
    const bigAccount = await openAccount(agent, big.id, "100.00");
    await addHolding(agent, bigAccount.id, "EQQQ", "100", "1.00"); // 4,315,000p, all equity
    const gone = await createClient(agent, { name: "Archived", riskProfile: "growth" });
    await openAccount(agent, gone.id, "999999.00");
    await agent.post(`/api/clients/${gone.id}/archive`).expect(200);

    const dashboard = (await agent.get("/api/dashboard").expect(200)).body as Dashboard;
    const steadyValue = 90 * 11842;
    const bigValue = 100 * 43150 + 10_000;
    expect(dashboard.aumPence).toBe(steadyValue + bigValue);
    expect(dashboard.clientCount).toBe(2);
    expect(dashboard.accountCount).toBe(2);
    expect(dashboard.topClients.map((client) => client.name)).toEqual(["Big", "Steady"]);
    expect(dashboard.driftAlerts.map((client) => client.name)).toEqual(["Big", "Steady"]);
    const equity = dashboard.allocation.find((line) => line.assetClass === "equity");
    expect(equity?.valuePence).toBe(steadyValue + 100 * 43150);
    expect(dashboard.recentActivity[0]?.action).toBe("client.archived");
  });
});
