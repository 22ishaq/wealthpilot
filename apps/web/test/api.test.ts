import { describe, expect, it } from "vitest";

import { ApiError, api, request } from "../src/api";
import { blankToNull, fieldErrors } from "../src/forms";
import { mockApi } from "./harness";

describe("request", () => {
  it("sends JSON only when there is a body, and same-origin credentials", async () => {
    mockApi({ "POST /api/auth/login": [200, { ok: true }], "GET /api/auth/me": [200, {}] });
    await api.login({ email: "a@b.test", password: "x" });
    await api.me();
    const [loginCall, meCall] = (
      globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } }
    ).mock.calls;
    expect(loginCall?.[1].headers).toMatchObject({ "Content-Type": "application/json" });
    expect(loginCall?.[1].credentials).toBe("same-origin");
    expect(meCall?.[1].headers).not.toHaveProperty("Content-Type");
  });

  it("turns error bodies into typed ApiErrors", async () => {
    mockApi({
      "POST /api/clients": [
        422,
        {
          error: {
            code: "VALIDATION_FAILED",
            message: "The request is invalid",
            details: [{ path: "name", message: "is required" }],
          },
        },
      ],
    });
    const error = await api
      .createClient({ name: "", riskProfile: "growth" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("VALIDATION_FAILED");
    expect((error as ApiError).status).toBe(422);
    expect(fieldErrors(error)).toEqual({ name: "is required" });
  });

  it("copes with error responses that are not JSON", async () => {
    mockApi({ "GET /api/dashboard": [502] });
    const error = await request("GET", "/dashboard").catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 502, code: "HTTP_ERROR" });
  });

  it("returns nothing for 204 responses", async () => {
    mockApi({ "POST /api/auth/logout": [204] });
    await expect(api.logout()).resolves.toBeUndefined();
  });

  it("builds client list queries", async () => {
    const calls = mockApi({
      "GET /api/clients": [200, []],
      "GET /api/clients?search=ada&archived=true": [200, []],
    });
    await api.clients();
    await api.clients({ search: "ada", archived: true });
    expect(calls.map((call) => call.path)).toEqual([
      "/api/clients",
      "/api/clients?search=ada&archived=true",
    ]);
  });
});

describe("form helpers", () => {
  it("maps empty fields to null and ignores unknown errors", () => {
    expect(blankToNull("")).toBeNull();
    expect(blankToNull(undefined)).toBeNull();
    expect(blankToNull("x")).toBe("x");
    expect(fieldErrors(new Error("boom"))).toEqual({});
  });
});
