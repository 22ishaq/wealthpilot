import { describe, expect, it } from "vitest";

import {
  ACCOUNT_TYPES,
  ACCOUNT_TYPE_LABELS,
  ASSET_CLASSES,
  RISK_PROFILES,
  ROLES,
  TARGET_ALLOCATIONS,
  allocate,
  can,
  clientCreateSchema,
  holdingCreateSchema,
  moneySchema,
  quantitySchema,
  signupSchema,
  weightBps,
} from "../src/index.js";

describe("weightBps", () => {
  it.each([
    [1, 3, 3333],
    [2, 3, 6667],
    [1, 2, 5000],
    [1, 16_000, 1], // 0.625 bps rounds half up
    [5, 0, 0],
  ])("%i of %i is %i bps", (part, total, bps) => {
    expect(weightBps(part, total)).toBe(bps);
  });

  it("stays exact where part x 10,000 would overflow a double", () => {
    expect(weightBps(2 ** 52, 2 ** 53 - 2)).toBe(5000);
  });
});

describe("allocate", () => {
  it("has targets that sum to 100% for every risk profile", () => {
    for (const profile of RISK_PROFILES) {
      const sum = ASSET_CLASSES.reduce((total, cls) => total + TARGET_ALLOCATIONS[profile][cls], 0);
      expect(sum).toBe(10_000);
    }
  });

  it("measures drift from the target in basis points", () => {
    const allocation = allocate({ equity: 1_184_200, bond: 1_052_000 }, "balanced");
    expect(allocation.totalPence).toBe(2_236_200);
    expect(
      allocation.lines.map((line) => [line.assetClass, line.weightBps, line.driftBps]),
    ).toEqual([
      ["equity", 5296, 296],
      ["bond", 4704, 1204],
      ["property", 0, -500],
      ["commodity", 0, -500],
      ["cash", 0, -500],
    ]);
    expect(allocation.maxDriftBps).toBe(1204);
  });

  it("reports no drift for an empty portfolio or without a profile", () => {
    expect(allocate({}, "growth").maxDriftBps).toBe(0);
    const firmWide = allocate({ cash: 100 }, null);
    expect(firmWide.lines.find((line) => line.assetClass === "cash")).toMatchObject({
      weightBps: 10_000,
      targetBps: 0,
      driftBps: 0,
    });
  });
});

describe("permissions", () => {
  it("grants each role exactly its permissions", () => {
    const matrix = Object.fromEntries(
      ROLES.map((role) => [
        role,
        (["clients:write", "members:manage", "audit:read"] as const).filter((p) => can(role, p)),
      ]),
    );
    expect(matrix).toEqual({
      owner: ["clients:write", "members:manage", "audit:read"],
      admin: ["clients:write", "members:manage", "audit:read"],
      advisor: ["clients:write"],
      viewer: [],
    });
  });
});

describe("schemas", () => {
  it("normalises emails and rejects unknown keys", () => {
    const input = {
      firmName: "F",
      name: "N",
      email: "  Ada@Example.COM ",
      password: "x".repeat(12),
    };
    expect(signupSchema.parse(input).email).toBe("ada@example.com");
    expect(signupSchema.safeParse({ ...input, role: "owner" }).success).toBe(false);
  });

  it("turns money strings into pence and explains bad input", () => {
    expect(moneySchema.parse("1234.56")).toBe(123_456);
    const result = moneySchema.safeParse("12.345");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/1234\.56/);
  });

  it("keeps quantities as exact strings", () => {
    expect(quantitySchema.parse("10.250")).toBe("10.25");
    expect(quantitySchema.safeParse("0").success).toBe(false);
  });

  it("validates clients and holdings", () => {
    expect(
      clientCreateSchema.safeParse({ name: "A", riskProfile: "growth", email: null }).success,
    ).toBe(true);
    expect(clientCreateSchema.safeParse({ name: "A", riskProfile: "yolo" }).success).toBe(false);
    expect(
      holdingCreateSchema.safeParse({ symbol: "VWRL", quantity: "1", bookCost: "1.00" }).success,
    ).toBe(true);
    expect(
      holdingCreateSchema.safeParse({ symbol: "vwrl", quantity: "1", bookCost: "1.00" }).success,
    ).toBe(false);
  });

  it("labels every account type", () => {
    expect(Object.keys(ACCOUNT_TYPE_LABELS).sort()).toEqual([...ACCOUNT_TYPES].sort());
  });
});
