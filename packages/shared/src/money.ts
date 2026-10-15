/**
 * Money is an integer number of pence. Amounts cross the API as decimal strings ("1234.56")
 * and are parsed strictly: no floats, no exponents, no thousands separators, at most two
 * decimal places. The largest amount (£9,999,999,999,999.99) stays a safe integer in pence.
 */

const MONEY_PATTERN = /^(0|[1-9][0-9]{0,12})(?:\.([0-9]{1,2}))?$/;
const QUANTITY_PATTERN = /^(0|[1-9][0-9]{0,13})(?:\.([0-9]{1,6}))?$/;

export const MONEY_HINT = "an amount in pounds such as 1234.56";
export const QUANTITY_HINT = "a positive number with up to 6 decimal places";

/** Parse "1234.56" into 123456 pence. Returns null for anything that is not a plain amount. */
export function parseMoney(text: string): number | null {
  const match = MONEY_PATTERN.exec(text);
  if (!match) return null;
  const [, whole = "0", fraction = ""] = match;
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

/** Parse a holding quantity, keeping it a string so PostgreSQL NUMERIC stays exact. */
export function parseQuantity(text: string): string | null {
  const match = QUANTITY_PATTERN.exec(text);
  if (!match) return null;
  const [, whole = "0", fraction = ""] = match;
  const trimmed = fraction.replace(/0+$/, "");
  if (whole === "0" && trimmed === "") return null;
  return trimmed ? `${whole}.${trimmed}` : whole;
}

function split(pence: number): { sign: string; whole: number; pennies: string } {
  if (!Number.isSafeInteger(pence)) throw new RangeError("pence must be a safe integer");
  const abs = Math.abs(pence);
  const remainder = abs % 100;
  return {
    sign: pence < 0 ? "-" : "",
    whole: (abs - remainder) / 100,
    pennies: String(remainder).padStart(2, "0"),
  };
}

const grouping = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });

/** 123456 -> "£1,234.56", using integer arithmetic only. */
export function formatMoney(pence: number): string {
  const { sign, whole, pennies } = split(pence);
  return `${sign}£${grouping.format(whole)}.${pennies}`;
}

/** 123456 -> "1234.56": the form a user would type back in. */
export function toDecimalString(pence: number): string {
  const { sign, whole, pennies } = split(pence);
  return `${sign}${whole}.${pennies}`;
}

/** Basis points (1/100 of a percent) -> "12.34%". */
export function formatBps(bps: number): string {
  const { sign, whole, pennies } = split(bps);
  return `${sign}${whole}.${pennies}%`;
}
