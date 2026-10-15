import { beforeAll, describe, expect, it } from "vitest";

import { type Firm, addMember, createClient, expectError, signUp, uniqueEmail } from "./helpers.js";

let owner: Firm;
let admin: Firm;
let advisor: Firm;
let viewer: Firm;
let clientId: string;

beforeAll(async () => {
  owner = await signUp("Roles & Co");
  admin = await addMember(owner, "admin");
  advisor = await addMember(owner, "advisor");
  viewer = await addMember(owner, "viewer");
  clientId = (await createClient(owner.agent)).id;
});

describe("viewers", () => {
  it("can read clients and the dashboard", async () => {
    await viewer.agent.get("/api/clients").expect(200);
    await viewer.agent.get(`/api/clients/${clientId}`).expect(200);
    await viewer.agent.get("/api/dashboard").expect(200);
    await viewer.agent.get("/api/members").expect(200);
  });

  it.each([
    ["POST", "/api/clients", { name: "X", riskProfile: "growth" }],
    ["PATCH", "/api/clients/:id", { name: "Renamed" }],
    ["POST", "/api/clients/:id/accounts", { name: "ISA", type: "isa" }],
    ["POST", "/api/clients/:id/archive", undefined],
  ] as const)("cannot %s %s", async (method, path, body) => {
    const call = viewer.agent[method === "POST" ? "post" : "patch"](path.replace(":id", clientId));
    const res = await (body ? call.send(body) : call).expect(403);
    expectError(res.body, "FORBIDDEN");
  });
});

describe("advisors", () => {
  it("can manage clients", async () => {
    const client = await createClient(advisor.agent, {
      name: "Advisor's client",
      advisorId: advisor.me.user.id,
    });
    expect(client.advisor).toEqual({ id: advisor.me.user.id, name: "advisor member" });
  });

  it("cannot manage the team or read the audit trail", async () => {
    await advisor.agent
      .post("/api/members/invitations")
      .send({ email: uniqueEmail(), role: "viewer" })
      .expect(403);
    await advisor.agent.get("/api/members/invitations").expect(403);
    await advisor.agent.get("/api/audit").expect(403);
  });
});

describe("admins and owners", () => {
  it.each([
    ["admin", () => admin],
    ["owner", () => owner],
  ])("%s can invite members and read the audit trail", async (_role, who) => {
    await who()
      .agent.post("/api/members/invitations")
      .send({ email: uniqueEmail(), role: "viewer" })
      .expect(201);
    const audit = await who().agent.get("/api/audit?limit=5").expect(200);
    expect(audit.body).toHaveLength(5);
  });

  it("validates the audit query", async () => {
    await owner.agent.get("/api/audit?limit=0").expect(422);
    await owner.agent.get("/api/audit?unexpected=1").expect(422);
  });
});
