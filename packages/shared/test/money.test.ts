import { describe, expect, it } from "vitest";

import {
  formatBps,
  formatMoney,
  parseMoney,
  parseQuantity,
  toDecimalString,
} from "../src/money.js";

describe("parseMoney", () => {
  it.each([
    ["0", 0],
    ["12", 1200],
    ["12.3", 1230],
    ["12.34", 1234],
    ["0.01", 1],
    ["9999999999999.99", 999_999_999_999_999],
  ])("parses %s as %i pence", (text, pence) => {
    expect(parseMoney(text)).toBe(pence);
  });

  it.each([
    "",
    "01",
    "1.234",
    "-1",
    "1e3",
    "1,000",
    " 1",
    "1.",
    ".5",
    "NaN",
    "10000000000000",
    "١٢",
  ])("rejects %j", (text) => {
    expect(parseMoney(text)).toBeNull();
  });

  it("round-trips every amount it formats", () => {
    let seed = 42;
    for (let i = 0; i < 2000; i += 1) {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      const pence = seed * 1000 + (i % 1000);
      expect(parseMoney(toDecimalString(pence))).toBe(pence);
    }
  });
});

describe("parseQuantity", () => {
  it.each([
    ["10", "10"],
    ["10.500", "10.5"],
    ["0.000001", "0.000001"],
    ["123456.000000", "123456"],
  ])("normalises %s to %s", (text, expected) => {
    expect(parseQuantity(text)).toBe(expected);
  });

  it.each(["0", "0.000", "1.1234567", "-1", "01", "1e3", ""])("rejects %j", (text) => {
    expect(parseQuantity(text)).toBeNull();
  });
});

describe("formatting", () => {
  it.each([
    [123_456, "£1,234.56"],
    [5, "£0.05"],
    [-5, "-£0.05"],
    [0, "£0.00"],
    [999_999_999_999_999, "£9,999,999,999,999.99"],
  ])("formats %i pence as %s", (pence, text) => {
    expect(formatMoney(pence)).toBe(text);
  });

  it("refuses non-integer or unsafe amounts instead of rounding them", () => {
    expect(() => formatMoney(1.5)).toThrow(RangeError);
    expect(() => formatMoney(2 ** 53)).toThrow(RangeError);
  });

  it("writes amounts and basis points without floats", () => {
    expect(toDecimalString(123_456)).toBe("1234.56");
    expect(toDecimalString(-7)).toBe("-0.07");
    expect(formatBps(1204)).toBe("12.04%");
    expect(formatBps(-500)).toBe("-5.00%");
  });
});
