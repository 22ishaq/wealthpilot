import type {
  Account,
  ApiErrorBody,
  ClientDetail,
  ClientSummary,
  Security,
} from "@wealthpilot/shared";
import { beforeEach, describe, expect, it } from "vitest";

import {
  type Firm,
  addHolding,
  addMember,
  createClient,
  expectError,
  openAccount,
  signUp,
} from "./helpers.js";

let firm: Firm;

beforeEach(async () => {
  firm = await signUp("Portfolio Partners");
});

async function detail(clientId: string): Promise<ClientDetail> {
  return (await firm.agent.get(`/api/clients/${clientId}`).expect(200)).body as ClientDetail;
}

describe("securities", () => {
  it("lists the reference securities with prices in pence", async () => {
    const securities = (await firm.agent.get("/api/securities").expect(200)).body as Security[];
    expect(securities).toHaveLength(16);
    expect(securities.find((s) => s.symbol === "VWRL")).toMatchObject({
      assetClass: "equity",
      pricePence: 11842,
      priceDate: "2026-10-01",
    });
  });
});

describe("clients", () => {
  it("creates a client and points to it", async () => {
    const res = await firm.agent
      .post("/api/clients")
      .send({ name: "Grace Hopper", email: "Grace@Example.COM", riskProfile: "growth" })
      .expect(201);
    const client = res.body as ClientDetail;
    expect(res.headers["location"]).toBe(`/api/clients/${client.id}`);
    expect(client).toMatchObject({
      name: "Grace Hopper",
      email: "grace@example.com",
      riskProfile: "growth",
      advisor: null,
      valuePence: 0,
      accountCount: 0,
      archived: false,
      accounts: [],
    });
  });

  it.each([
    [{ riskProfile: "reckless" }, "riskProfile"],
    [{ name: "" }, "name"],
    [{ email: "nope" }, "email"],
    [{ advisorId: "not-a-uuid" }, "advisorId"],
  ])("validates %o", async (override, path) => {
    const res = await firm.agent
      .post("/api/clients")
      .send({ name: "X", riskProfile: "growth", ...override })
      .expect(422);
    expect((res.body as ApiErrorBody).error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ path })]),
    );
  });

  it("searches by name or email, treating wildcards literally", async () => {
    await createClient(firm.agent, { name: "Ada Lovelace" });
    await createClient(firm.agent, { name: "Alan Turing" });
    await createClient(firm.agent, { name: "100% Club" });
    const search = async (term: string) =>
      (
        (await firm.agent.get("/api/clients").query({ search: term }).expect(200))
          .body as ClientSummary[]
      ).map((client) => client.name);
    expect(await search("al")).toEqual(["Alan Turing"]);
    expect(await search("LOVE")).toEqual(["Ada Lovelace"]);
    expect(await search("%")).toEqual(["100% Club"]);
    expect(await search("_")).toEqual([]);
  });

  it("filters by advisor and validates the filter", async () => {
    const advisor = await addMember(firm, "advisor");
    await createClient(firm.agent, { name: "Mine", advisorId: advisor.me.user.id });
    await createClient(firm.agent, { name: "Unassigned" });
    const res = await firm.agent
      .get("/api/clients")
      .query({ advisorId: advisor.me.user.id })
      .expect(200);
    expect((res.body as ClientSummary[]).map((c) => c.name)).toEqual(["Mine"]);
    await firm.agent.get("/api/clients").query({ advisorId: "x" }).expect(422);
  });

  it("updates only the fields provided", async () => {
    const client = await createClient(firm.agent, { name: "Before", riskProfile: "balanced" });
    const res = await firm.agent
      .patch(`/api/clients/${client.id}`)
      .send({ riskProfile: "adventurous" })
      .expect(200);
    expect(res.body as ClientDetail).toMatchObject({ name: "Before", riskProfile: "adventurous" });
    await firm.agent.patch(`/api/clients/${client.id}`).send({}).expect(200);
  });

  it("only assigns active members of the firm as advisors", async () => {
    const client = await createClient(firm.agent);
    const res = await firm.agent
      .patch(`/api/clients/${client.id}`)
      .send({ advisorId: "6f1c1b8e-2a8f-4d38-9a8e-5f2a6f3b9c11" })
      .expect(422);
    expectError(res.body, "INVALID_ADVISOR");
  });

  it("archives and restores", async () => {
    const client = await createClient(firm.agent, { name: "Leaving" });
    await firm.agent.post(`/api/clients/${client.id}/archive`).expect(200);
    const active = (await firm.agent.get("/api/clients").expect(200)).body as ClientSummary[];
    expect(active.map((c) => c.id)).not.toContain(client.id);
    const archived = (await firm.agent.get("/api/clients?archived=true").expect(200))
      .body as ClientSummary[];
    expect(archived.map((c) => c.id)).toEqual([client.id]);
    const restored = await firm.agent.post(`/api/clients/${client.id}/restore`).expect(200);
    expect((restored.body as ClientDetail).archived).toBe(false);
  });

  it("treats malformed and unknown ids as not found", async () => {
    await firm.agent.get("/api/clients/not-a-uuid").expect(404);
    await firm.agent.get("/api/clients/6f1c1b8e-2a8f-4d38-9a8e-5f2a6f3b9c11").expect(404);
    await firm.agent
      .patch("/api/clients/6f1c1b8e-2a8f-4d38-9a8e-5f2a6f3b9c11")
      .send({ name: "x" })
      .expect(404);
  });
});

describe("accounts", () => {
  it("opens, updates and closes an account", async () => {
    const client = await createClient(firm.agent);
    const account = await openAccount(firm.agent, client.id, "250.50");
    expect(account).toMatchObject({
      type: "isa",
      cashPence: 25_050,
      valuePence: 25_050,
      holdings: [],
    });

    const updated = await firm.agent
      .patch(`/api/accounts/${account.id}`)
      .send({ name: "Renamed ISA", cash: "1000" })
      .expect(200);
    expect(updated.body as Account).toMatchObject({ name: "Renamed ISA", cashPence: 100_000 });

    await firm.agent.delete(`/api/accounts/${account.id}`).expect(204);
    await firm.agent.delete(`/api/accounts/${account.id}`).expect(404);
    expect((await detail(client.id)).accounts).toEqual([]);
  });

  it.each(["-1.00", "1.234", "1e3", "1,000.00"])("rejects cash of %s", async (cash) => {
    const client = await createClient(firm.agent);
    await firm.agent
      .post(`/api/clients/${client.id}/accounts`)
      .send({ name: "A", type: "isa", cash })
      .expect(422);
  });

  it("rejects money sent as a JSON number", async () => {
    const client = await createClient(firm.agent);
    await firm.agent
      .post(`/api/clients/${client.id}/accounts`)
      .send({ name: "A", type: "isa", cash: 10.5 })
      .expect(422);
  });
});

describe("holdings and valuation", () => {
  it("values holdings as quantity x price, rounded to the penny in the database", async () => {
    const client = await createClient(firm.agent);
    const account = await openAccount(firm.agent, client.id);
    await addHolding(firm.agent, account.id, "VWRL", "10.5", "1100.00");
    const after = await addHolding(firm.agent, account.id, "IGLT", "0.333333", "3.50");
    const vwrl = after.holdings.find((h) => h.symbol === "VWRL");
    const iglt = after.holdings.find((h) => h.symbol === "IGLT");
    expect(vwrl).toMatchObject({
      quantity: "10.5",
      valuePence: 124_341,
      bookCostPence: 110_000,
      gainPence: 14_341,
    });
    // 0.333333 x 1052p = 350.666... -> 351p
    expect(iglt).toMatchObject({ quantity: "0.333333", valuePence: 351, gainPence: 1 });
    expect(after.valuePence).toBe(124_341 + 351);
  });

  it("computes allocation and drift against the client's risk profile", async () => {
    const client = await createClient(firm.agent, { riskProfile: "balanced" });
    const account = await openAccount(firm.agent, client.id);
    await addHolding(firm.agent, account.id, "VWRL", "100", "10000.00"); // 1,184,200p equity
    await addHolding(firm.agent, account.id, "IGLT", "1000", "10000.00"); // 1,052,000p bonds
    const result = await detail(client.id);
    expect(result.valuePence).toBe(2_236_200);
    expect(result.bookCostPence).toBe(2_000_000);
    expect(result.gainPence).toBe(236_200);
    const byClass = Object.fromEntries(result.allocation.map((line) => [line.assetClass, line]));
    expect(byClass["equity"]).toMatchObject({ weightBps: 5296, targetBps: 5000, driftBps: 296 });
    expect(byClass["bond"]).toMatchObject({ weightBps: 4704, targetBps: 3500, driftBps: 1204 });
    expect(byClass["cash"]).toMatchObject({ weightBps: 0, targetBps: 500, driftBps: -500 });
    expect(result.maxDriftBps).toBe(1204);
  });

  it("updates and removes a holding", async () => {
    const client = await createClient(firm.agent);
    const account = await openAccount(firm.agent, client.id);
    const added = await addHolding(firm.agent, account.id, "VWRL", "10", "1000.00");
    const holdingId = added.holdings[0]?.id ?? "";
    const updated = await firm.agent
      .patch(`/api/holdings/${holdingId}`)
      .send({ quantity: "20.000", bookCost: "2100.00" })
      .expect(200);
    expect((updated.body as Account).holdings[0]).toMatchObject({
      quantity: "20",
      valuePence: 236_840,
      bookCostPence: 210_000,
    });
    await firm.agent.patch(`/api/holdings/${holdingId}`).send({}).expect(200);
    await firm.agent.delete(`/api/holdings/${holdingId}`).expect(204);
    await firm.agent.patch(`/api/holdings/${holdingId}`).send({ quantity: "1" }).expect(404);
    await firm.agent.delete(`/api/holdings/${holdingId}`).expect(404);
  });

  it("refuses a second holding of the same security in one account", async () => {
    const client = await createClient(firm.agent);
    const account = await openAccount(firm.agent, client.id);
    await addHolding(firm.agent, account.id, "VWRL", "1", "100.00");
    const res = await firm.agent
      .post(`/api/accounts/${account.id}/holdings`)
      .send({ symbol: "VWRL", quantity: "1", bookCost: "100.00" })
      .expect(409);
    expectError(res.body, "HOLDING_EXISTS");
  });

  it("refuses unknown securities", async () => {
    const client = await createClient(firm.agent);
    const account = await openAccount(firm.agent, client.id);
    const res = await firm.agent
      .post(`/api/accounts/${account.id}/holdings`)
      .send({ symbol: "ZZZZ", quantity: "1", bookCost: "1.00" })
      .expect(422);
    expectError(res.body, "UNKNOWN_SECURITY");
  });

  it.each([
    { symbol: "vwrl", quantity: "1", bookCost: "1.00" },
    { symbol: "VWRL", quantity: "0", bookCost: "1.00" },
    { symbol: "VWRL", quantity: "1.1234567", bookCost: "1.00" },
    { symbol: "VWRL", quantity: 10, bookCost: "1.00" },
    { symbol: "VWRL", quantity: "1", bookCost: "1.001" },
  ])("validates %o", async (body) => {
    const client = await createClient(firm.agent);
    const account = await openAccount(firm.agent, client.id);
    await firm.agent.post(`/api/accounts/${account.id}/holdings`).send(body).expect(422);
  });

  it("records every change in the audit trail", async () => {
    const client = await createClient(firm.agent);
    const account = await openAccount(firm.agent, client.id);
    await addHolding(firm.agent, account.id, "VWRL", "1", "100.00");
    const audit = (await firm.agent.get("/api/audit").expect(200)).body as { action: string }[];
    expect(audit.slice(0, 3).map((event) => event.action)).toEqual([
      "holding.added",
      "account.opened",
      "client.created",
    ]);
  });
});
