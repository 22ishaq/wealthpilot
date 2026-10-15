/**
 * Asset allocation against a risk profile's target, in basis points (10,000 = 100%).
 * All arithmetic is integer (BigInt where products could exceed 2^53), so the same
 * portfolio always produces the same weights on the server and in the browser.
 */

export const ASSET_CLASSES = ["equity", "bond", "property", "commodity", "cash"] as const;
export type AssetClass = (typeof ASSET_CLASSES)[number];

export const RISK_PROFILES = ["conservative", "balanced", "growth", "adventurous"] as const;
export type RiskProfile = (typeof RISK_PROFILES)[number];

export const TARGET_ALLOCATIONS: Readonly<
  Record<RiskProfile, Readonly<Record<AssetClass, number>>>
> = {
  conservative: { equity: 2500, bond: 6000, property: 500, commodity: 500, cash: 500 },
  balanced: { equity: 5000, bond: 3500, property: 500, commodity: 500, cash: 500 },
  growth: { equity: 7000, bond: 2000, property: 500, commodity: 300, cash: 200 },
  adventurous: { equity: 9000, bond: 500, property: 300, commodity: 200, cash: 0 },
};

/** A client whose largest drift exceeds this (5 percentage points) needs rebalancing. */
export const DRIFT_ALERT_BPS = 500;

export interface AllocationLine {
  assetClass: AssetClass;
  valuePence: number;
  weightBps: number;
  targetBps: number;
  driftBps: number;
}

export interface Allocation {
  totalPence: number;
  lines: AllocationLine[];
  maxDriftBps: number;
}

/** part / total in basis points, rounded half up. */
export function weightBps(part: number, total: number): number {
  if (total <= 0) return 0;
  return Number((BigInt(part) * 20_000n + BigInt(total)) / (2n * BigInt(total)));
}

export function allocate(
  values: Partial<Record<AssetClass, number>>,
  profile: RiskProfile | null,
): Allocation {
  const totalPence = ASSET_CLASSES.reduce((sum, assetClass) => sum + (values[assetClass] ?? 0), 0);
  const lines = ASSET_CLASSES.map((assetClass) => {
    const valuePence = values[assetClass] ?? 0;
    const weight = weightBps(valuePence, totalPence);
    const target = profile ? TARGET_ALLOCATIONS[profile][assetClass] : 0;
    return {
      assetClass,
      valuePence,
      weightBps: weight,
      targetBps: target,
      driftBps: profile && totalPence > 0 ? weight - target : 0,
    };
  });
  const maxDriftBps = Math.max(0, ...lines.map((line) => Math.abs(line.driftBps)));
  return { totalPence, lines, maxDriftBps };
}
