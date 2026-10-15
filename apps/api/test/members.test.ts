import type {
  CreatedInvitation,
  Invitation,
  InvitationPreview,
  Me,
  Member,
} from "@wealthpilot/shared";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

import {
  PASSWORD,
  type Firm,
  addMember,
  adminPool,
  app,
  expectError,
  signUp,
  uniqueEmail,
} from "./helpers.js";

let firm: Firm;

beforeEach(async () => {
  firm = await signUp("Members Ltd");
});

async function invite(email = uniqueEmail("invitee"), role = "advisor") {
  const res = await firm.agent.post("/api/members/invitations").send({ email, role }).expect(201);
  const created = res.body as CreatedInvitation;
  return { created, token: created.inviteUrl.split("/").pop() ?? "", email };
}

function accept(token: string, name = "New Person") {
  return request(app)
    .post("/api/auth/invitations/accept")
    .send({ token, name, password: PASSWORD });
}

describe("invitations", () => {
  it("creates a one-time link that previews the firm and role", async () => {
    const { created, token, email } = await invite();
    expect(created.inviteUrl).toBe(`http://localhost:5173/invite/${token}`);
    expect(token).toHaveLength(43);
    const preview = await request(app).get(`/api/auth/invitations/${token}`).expect(200);
    expect(preview.body as InvitationPreview).toEqual({
      firmName: "Members Ltd",
      email,
      role: "advisor",
    });
  });

  it("lists pending invitations without exposing their tokens", async () => {
    const { token } = await invite();
    const res = await firm.agent.get("/api/members/invitations").expect(200);
    const pending = res.body as Invitation[];
    expect(pending).toHaveLength(1);
    expect(JSON.stringify(pending)).not.toContain(token);
  });

  it("accepting joins the firm with the invited role and signs the person in", async () => {
    const { token, email } = await invite(uniqueEmail(), "viewer");
    const res = await accept(token).expect(201);
    expect(res.body).toMatchObject({
      user: { email, role: "viewer" },
      tenant: { id: firm.me.tenant.id },
    });
    const members = (await firm.agent.get("/api/members").expect(200)).body as Member[];
    expect(members.map((member) => member.email)).toContain(email);
  });

  it("can be used only once", async () => {
    const { token } = await invite();
    await accept(token).expect(201);
    const again = await accept(token, "Someone Else").expect(410);
    expectError(again.body, "INVITATION_INVALID");
  });

  it("expires", async () => {
    const { token, email } = await invite();
    await adminPool.query(
      "UPDATE invitations SET expires_at = now() - interval '1 minute' WHERE email = $1",
      [email],
    );
    await request(app).get(`/api/auth/invitations/${token}`).expect(404);
    await accept(token).expect(410);
  });

  it("is replaced by a newer invitation to the same address", async () => {
    const email = uniqueEmail();
    const first = await invite(email);
    const second = await invite(email);
    await accept(first.token).expect(410);
    await accept(second.token).expect(201);
  });

  it("can be revoked", async () => {
    const { created, token } = await invite();
    await firm.agent.delete(`/api/members/invitations/${created.id}`).expect(204);
    await accept(token).expect(410);
    await firm.agent.delete(`/api/members/invitations/${created.id}`).expect(404);
  });

  it("refuses to invite an existing member", async () => {
    const res = await firm.agent
      .post("/api/members/invitations")
      .send({ email: firm.email, role: "viewer" })
      .expect(409);
    expectError(res.body, "ALREADY_MEMBER");
  });

  it("cannot be accepted by an address that already has an account elsewhere", async () => {
    const elsewhere = await signUp("Other Firm");
    const { token } = await invite(elsewhere.email);
    const res = await accept(token).expect(409);
    expectError(res.body, "EMAIL_TAKEN");
  });

  it("only offers roles below owner", async () => {
    const res = await firm.agent
      .post("/api/members/invitations")
      .send({ email: uniqueEmail(), role: "owner" })
      .expect(422);
    expectError(res.body, "VALIDATION_FAILED");
  });
});

describe("managing members", () => {
  it("changes a member's role", async () => {
    const advisor = await addMember(firm, "advisor");
    const res = await firm.agent
      .patch(`/api/members/${advisor.me.user.id}`)
      .send({ role: "viewer" })
      .expect(200);
    expect((res.body as Member).role).toBe("viewer");
    const me = await advisor.agent.get("/api/auth/me").expect(200);
    expect((me.body as Me).user.role).toBe("viewer");
  });

  it("does not let anyone change their own membership", async () => {
    const admin = await addMember(firm, "admin");
    const res = await admin.agent
      .patch(`/api/members/${admin.me.user.id}`)
      .send({ role: "advisor" })
      .expect(422);
    expectError(res.body, "CANNOT_CHANGE_SELF");
  });

  it("protects the firm owner", async () => {
    const admin = await addMember(firm, "admin");
    const demote = await admin.agent
      .patch(`/api/members/${firm.me.user.id}`)
      .send({ role: "viewer" })
      .expect(403);
    expectError(demote.body, "OWNER_PROTECTED");
    await admin.agent.delete(`/api/members/${firm.me.user.id}`).expect(403);
  });

  it("deactivating a member ends their sessions and blocks sign-in", async () => {
    const advisor = await addMember(firm, "advisor");
    await advisor.agent.get("/api/auth/me").expect(200);
    await firm.agent.delete(`/api/members/${advisor.me.user.id}`).expect(204);
    await advisor.agent.get("/api/auth/me").expect(401);
    await request(app)
      .post("/api/auth/login")
      .send({ email: advisor.email, password: PASSWORD })
      .expect(401);
    const members = (await firm.agent.get("/api/members").expect(200)).body as Member[];
    expect(members.find((member) => member.id === advisor.me.user.id)?.active).toBe(false);
  });

  it("records membership changes in the audit trail", async () => {
    const advisor = await addMember(firm, "advisor");
    await firm.agent
      .patch(`/api/members/${advisor.me.user.id}`)
      .send({ role: "admin" })
      .expect(200);
    const audit = (await firm.agent.get("/api/audit").expect(200)).body as {
      action: string;
      details: Record<string, unknown>;
    }[];
    expect(audit.map((event) => event.action)).toEqual(
      expect.arrayContaining(["member.invited", "member.joined", "member.role_changed"]),
    );
    expect(audit.find((event) => event.action === "member.role_changed")?.details).toEqual({
      from: "advisor",
      to: "admin",
    });
  });
});
