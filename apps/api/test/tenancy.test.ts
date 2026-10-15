/**
 * Cross-tenant access through the API. Firm B knows the ids of firm A's records (as an
 * attacker who guessed or scraped them might) and tries every route. Each attempt must look
 * exactly like a request for something that does not exist, and must change nothing.
 */

import type { ClientDetail, ClientSummary, Dashboard, Member } from "@wealthpilot/shared";
import { beforeAll, describe, expect, it } from "vitest";

import {
  type Firm,
  addHolding,
  createClient,
  expectError,
  openAccount,
  signUp,
} from "./helpers.js";

let firmA: Firm;
let firmB: Firm;
let clientA: ClientDetail;
let accountId: string;
let holdingId: string;

beforeAll(async () => {
  firmA = await signUp("Firm A");
  firmB = await signUp("Firm B");
  clientA = await createClient(firmA.agent, { name: "Alice of Firm A" });
  const account = await openAccount(firmA.agent, clientA.id, "1000.00");
  accountId = account.id;
  const withHolding = await addHolding(firmA.agent, accountId, "VWRL", "10", "1000.00");
  holdingId = withHolding.holdings[0]?.id ?? "";
  await createClient(firmB.agent, { name: "Bob of Firm B" });
});

describe("firm B cannot reach firm A's data", () => {
  it("does not see firm A's clients in its list", async () => {
    const res = await firmB.agent.get("/api/clients").expect(200);
    expect((res.body as ClientSummary[]).map((client) => client.name)).toEqual(["Bob of Firm B"]);
  });

  it.each([
    ["GET", () => `/api/clients/${clientA.id}`, undefined],
    ["PATCH", () => `/api/clients/${clientA.id}`, { name: "Hijacked" }],
    ["POST", () => `/api/clients/${clientA.id}/archive`, undefined],
    ["POST", () => `/api/clients/${clientA.id}/accounts`, { name: "Mine now", type: "gia" }],
    ["PATCH", () => `/api/accounts/${accountId}`, { cash: "0.00" }],
    ["DELETE", () => `/api/accounts/${accountId}`, undefined],
    [
      "POST",
      () => `/api/accounts/${accountId}/holdings`,
      { symbol: "VUSA", quantity: "1", bookCost: "1.00" },
    ],
    ["PATCH", () => `/api/holdings/${holdingId}`, { quantity: "999" }],
    ["DELETE", () => `/api/holdings/${holdingId}`, undefined],
  ] as const)("%s %s answers 404", async (method, path, body) => {
    const req = firmB.agent[method.toLowerCase() as "get" | "patch" | "post" | "delete"](path());
    const res = await (body ? req.send(body) : req).expect(404);
    expectError(res.body, "NOT_FOUND");
  });

  it("cannot assign firm A's member as an advisor", async () => {
    const res = await firmB.agent
      .post("/api/clients")
      .send({ name: "X", riskProfile: "growth", advisorId: firmA.me.user.id })
      .expect(422);
    expectError(res.body, "INVALID_ADVISOR");
  });

  it("cannot change or deactivate firm A's members", async () => {
    await firmB.agent
      .patch(`/api/members/${firmA.me.user.id}`)
      .send({ role: "viewer" })
      .expect(404);
    await firmB.agent.delete(`/api/members/${firmA.me.user.id}`).expect(404);
  });

  it("sees only its own members, dashboard and audit trail", async () => {
    const members = (await firmB.agent.get("/api/members").expect(200)).body as Member[];
    expect(members.map((member) => member.id)).toEqual([firmB.me.user.id]);

    const dashboard = (await firmB.agent.get("/api/dashboard").expect(200)).body as Dashboard;
    expect(dashboard.clientCount).toBe(1);
    expect(dashboard.aumPence).toBe(0);

    const audit = (await firmB.agent.get("/api/audit").expect(200)).body as { entityId: string }[];
    expect(audit.map((event) => event.entityId)).not.toContain(clientA.id);
  });

  it("left firm A's data untouched", async () => {
    const res = await firmA.agent.get(`/api/clients/${clientA.id}`).expect(200);
    const client = res.body as ClientDetail;
    expect(client.name).toBe("Alice of Firm A");
    expect(client.archived).toBe(false);
    expect(client.accounts).toHaveLength(1);
    expect(client.accounts[0]?.cashPence).toBe(100_000);
    expect(client.accounts[0]?.holdings.map((h) => h.quantity)).toEqual(["10"]);
  });
});
