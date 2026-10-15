import { createHash } from "node:crypto";

import type { ApiErrorBody, Me } from "@wealthpilot/shared";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { PASSWORD, adminPool, app, expectError, makeApp, signUp, uniqueEmail } from "./helpers.js";

function sessionCookie(setCookie: string[] | string | undefined): string {
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie ?? ""];
  const cookie = cookies.find((value) => value.startsWith("wp_session="));
  if (!cookie) throw new Error("no session cookie");
  return cookie;
}

describe("signup", () => {
  it("creates a firm, makes the founder its owner and signs them in", async () => {
    const { agent, me, email } = await signUp("Harbour Capital");
    expect(me.user).toMatchObject({ email, name: "Olivia Owner", role: "owner" });
    expect(me.tenant.name).toBe("Harbour Capital");
    const current = await agent.get("/api/auth/me").expect(200);
    expect(current.body).toEqual(me);
  });

  it("sets an HttpOnly, SameSite=Lax session cookie", async () => {
    const res = await request(app)
      .post("/api/auth/signup")
      .send({ firmName: "F", name: "N", email: uniqueEmail(), password: PASSWORD })
      .expect(201);
    const cookie = sessionCookie(res.headers["set-cookie"]);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\//);
  });

  it("stores only a hash of the session token and an scrypt hash of the password", async () => {
    const email = uniqueEmail();
    const res = await request(app)
      .post("/api/auth/signup")
      .send({ firmName: "F", name: "N", email, password: PASSWORD })
      .expect(201);
    const token = sessionCookie(res.headers["set-cookie"]).split(";")[0]?.split("=")[1] ?? "";
    const { rows } = await adminPool.query<{ token_hash: string; password_hash: string }>(
      `SELECT s.token_hash, u.password_hash FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE u.email = $1`,
      [email],
    );
    expect(rows[0]?.token_hash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(rows[0]?.token_hash).not.toContain(token);
    expect(rows[0]?.password_hash).toMatch(/^scrypt\$1024\$8\$1\$/);
    expect(rows[0]?.password_hash).not.toContain(PASSWORD);
  });

  it("rejects an email that already has an account", async () => {
    const { email } = await signUp();
    const res = await request(app)
      .post("/api/auth/signup")
      .send({ firmName: "Other", name: "N", email: email.toUpperCase(), password: PASSWORD })
      .expect(409);
    expectError(res.body, "EMAIL_TAKEN");
  });

  it.each([
    [{ password: "short" }, "password"],
    [{ email: "not-an-email" }, "email"],
    [{ firmName: "  " }, "firmName"],
  ])("validates the request (%o)", async (override, path) => {
    const res = await request(app)
      .post("/api/auth/signup")
      .send({ firmName: "F", name: "N", email: uniqueEmail(), password: PASSWORD, ...override })
      .expect(422);
    expectError(res.body, "VALIDATION_FAILED");
    expect((res.body as ApiErrorBody).error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ path })]),
    );
  });

  it("refuses extra fields such as a client-chosen role or tenant", async () => {
    const res = await request(app)
      .post("/api/auth/signup")
      .send({
        firmName: "F",
        name: "N",
        email: uniqueEmail(),
        password: PASSWORD,
        tenantId: "00000000-0000-0000-0000-000000000000",
      })
      .expect(422);
    expectError(res.body, "VALIDATION_FAILED");
  });
});

describe("login and logout", () => {
  it("signs in with the right password, case-insensitively by email", async () => {
    const { email, me } = await signUp();
    const agent = request.agent(app);
    const res = await agent
      .post("/api/auth/login")
      .send({ email: email.toUpperCase(), password: PASSWORD })
      .expect(200);
    expect((res.body as Me).user.id).toBe(me.user.id);
    await agent.get("/api/auth/me").expect(200);
  });

  it("gives the same answer for a wrong password and an unknown email", async () => {
    const { email } = await signUp();
    const wrong = await request(app)
      .post("/api/auth/login")
      .send({ email, password: "not the password" })
      .expect(401);
    const unknown = await request(app)
      .post("/api/auth/login")
      .send({ email: uniqueEmail("nobody"), password: PASSWORD })
      .expect(401);
    expect(wrong.body).toEqual(unknown.body);
    expectError(wrong.body, "INVALID_CREDENTIALS");
  });
});

describe("sessions", () => {
  it("requires a session for protected routes", async () => {
    const res = await request(app).get("/api/auth/me").expect(401);
    expectError(res.body, "UNAUTHENTICATED");
    await request(app).get("/api/clients").expect(401);
  });

  it("ignores forged or malformed cookies", async () => {
    await request(app).get("/api/auth/me").set("Cookie", "wp_session=forged-token").expect(401);
    await request(app)
      .get("/api/auth/me")
      .set("Cookie", `wp_session=${"x".repeat(500)}`)
      .expect(401);
  });

  it("stops accepting a session once it expires", async () => {
    const { agent, me } = await signUp();
    await adminPool.query(
      "UPDATE sessions SET expires_at = now() - interval '1 second' WHERE user_id = $1",
      [me.user.id],
    );
    await agent.get("/api/auth/me").expect(401);
  });

  it("logs out by revoking the server-side session and clearing the cookie", async () => {
    const email = uniqueEmail();
    const signup = await request(app)
      .post("/api/auth/signup")
      .send({ firmName: "F", name: "N", email, password: PASSWORD })
      .expect(201);
    const cookie = sessionCookie(signup.headers["set-cookie"]).split(";")[0] ?? "";
    await request(app).get("/api/auth/me").set("Cookie", cookie).expect(200);
    const logout = await request(app).post("/api/auth/logout").set("Cookie", cookie).expect(204);
    expect(sessionCookie(logout.headers["set-cookie"])).toMatch(/wp_session=;/);
    await request(app).get("/api/auth/me").set("Cookie", cookie).expect(401);
  });

  it("allows logout without a session", async () => {
    await request(app).post("/api/auth/logout").expect(204);
  });
});

describe("rate limiting", () => {
  it("throttles repeated attempts for one account", async () => {
    const limited = makeApp({ loginRateLimit: 3 });
    const { email } = await signUp();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await request(limited).post("/api/auth/login").send({ email, password: "wrong" }).expect(401);
    }
    const res = await request(limited)
      .post("/api/auth/login")
      .send({ email, password: PASSWORD })
      .expect(429);
    expectError(res.body, "RATE_LIMITED");
    expect(res.headers["ratelimit-policy"] ?? res.headers["ratelimit"]).toBeDefined();
  });
});
