import { Writable } from "node:stream";

import express from "express";
import { pino } from "pino";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
import { AppError, errorHandler, toErrorResponse } from "../src/errors.js";
import { PASSWORD, app, expectError, signUp, uniqueEmail } from "./helpers.js";

describe("health", () => {
  it("reports liveness and database readiness", async () => {
    await request(app).get("/api/health").expect(200, { status: "ok" });
    await request(app).get("/api/ready").expect(200, { status: "ready" });
  });
});

describe("request hardening", () => {
  it("answers unknown API routes with a JSON 404", async () => {
    const res = await request(app).get("/api/does-not-exist").expect(404);
    expectError(res.body, "NOT_FOUND");
  });

  it("rejects malformed JSON", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .set("Content-Type", "application/json")
      .send('{"email": ')
      .expect(400);
    expectError(res.body, "MALFORMED_JSON");
  });

  it("rejects oversized bodies", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "a@b.test", password: "x".repeat(200_000) })
      .expect(413);
    expectError(res.body, "PAYLOAD_TOO_LARGE");
  });

  it("only accepts JSON bodies on state-changing requests", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .set("Content-Type", "application/x-www-form-urlencoded")
      .send("email=a%40b.test&password=x")
      .expect(415);
    expectError(res.body, "UNSUPPORTED_MEDIA_TYPE");
  });

  it("rejects state-changing requests from another origin", async () => {
    const { agent } = await signUp();
    const res = await agent
      .post("/api/clients")
      .set("Origin", "https://evil.example")
      .send({ name: "CSRF", riskProfile: "growth" })
      .expect(403);
    expectError(res.body, "CSRF_REJECTED");
    await agent
      .post("/api/clients")
      .set("Origin", "http://localhost:5173")
      .send({ name: "Fine", riskProfile: "growth" })
      .expect(201);
  });

  it("sets security headers and a request id", async () => {
    const res = await request(app).get("/api/health").expect(200);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(res.headers["x-powered-by"]).toBeUndefined();
    expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("error mapping", () => {
  const pg = (code: string, constraint?: string) => ({ code, constraint, severity: "ERROR" });

  it.each([
    [pg("23505", "users_email_key"), 409, "EMAIL_TAKEN"],
    [pg("23505", "something_else"), 409, "CONFLICT"],
    [pg("23503"), 422, "INVALID_REFERENCE"],
    [pg("23514"), 422, "VALIDATION_FAILED"],
    [pg("42501"), 404, "NOT_FOUND"],
    [pg("40001"), 500, "INTERNAL_ERROR"],
    [new AppError(418, "TEAPOT", "short and stout", { spout: true }), 418, "TEAPOT"],
    [new Error("database password is hunter2"), 500, "INTERNAL_ERROR"],
  ])("maps %o to %i %s", (error, status, code) => {
    const response = toErrorResponse(error);
    expect(response.status).toBe(status);
    expect(response.body.error.code).toBe(code);
    expect(JSON.stringify(response.body)).not.toContain("hunter2");
  });

  it("logs unexpected errors without sending details to the client", async () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    const logger = pino({ level: "error" }, sink);
    const broken = express()
      .get("/boom", () => {
        throw new Error("secret internal detail");
      })
      .use(errorHandler(logger));
    const res = await request(broken).get("/boom").expect(500);
    expect(res.body).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Something went wrong" },
    });
    expect(lines.join("")).toContain("secret internal detail");
  });
});

describe("configuration", () => {
  it("fails fast on invalid settings", () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ DATABASE_URL: "postgres://x", SCRYPT_COST: "1000" })).toThrow(
      /power of two/,
    );
  });

  it("uses secure cookies in production and normalises the origin", () => {
    const config = loadConfig({
      DATABASE_URL: "postgres://x",
      NODE_ENV: "production",
      APP_ORIGIN: "https://app.example.com/",
    });
    expect(config.cookieSecure).toBe(true);
    expect(config.appOrigin).toBe("https://app.example.com");
    expect(config.migrationDatabaseUrl).toBe("postgres://x");
  });
});

describe("cookies in production mode", () => {
  it("marks the session cookie Secure", async () => {
    const { makeApp } = await import("./helpers.js");
    const secure = makeApp({ cookieSecure: true });
    const res = await request(secure)
      .post("/api/auth/signup")
      .send({ firmName: "S", name: "N", email: uniqueEmail(), password: PASSWORD })
      .expect(201);
    expect(String(res.headers["set-cookie"])).toMatch(/Secure/);
  });
});
