import { formatBps, formatMoney, type AllocationLine } from "@wealthpilot/shared";

import { ASSET_CLASS_LABELS } from "../format";

const RADIUS = 52;
const STROKE = 18;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** Donut of allocation by asset class, with a legend that carries the actual numbers. */
export function AllocationChart({ lines }: { lines: AllocationLine[] }) {
  const total = lines.reduce((sum, line) => sum + line.valuePence, 0);
  if (total === 0) {
    return <div className="empty">No assets yet</div>;
  }
  const visible = lines.filter((line) => line.weightBps > 0);
  const lengths = visible.map((line) => (line.weightBps / 10_000) * CIRCUMFERENCE);
  const arcs = visible.map((line, index) => {
    const length = lengths[index] ?? 0;
    const offset = lengths.slice(0, index).reduce((sum, value) => sum + value, 0);
    return (
      <circle
        key={line.assetClass}
        data-testid={`arc-${line.assetClass}`}
        r={RADIUS}
        cx="70"
        cy="70"
        fill="none"
        stroke={`var(--${line.assetClass})`}
        strokeWidth={STROKE}
        strokeDasharray={`${length} ${CIRCUMFERENCE - length}`}
        strokeDashoffset={-offset}
        transform="rotate(-90 70 70)"
      />
    );
  });

  return (
    <div className="allocation">
      <svg width="140" height="140" viewBox="0 0 140 140" role="img" aria-label="Asset allocation">
        <circle
          r={RADIUS}
          cx="70"
          cy="70"
          fill="none"
          stroke="var(--border)"
          strokeWidth={STROKE}
        />
        {arcs}
      </svg>
      <ul className="legend">
        {lines.map((line) => (
          <li key={line.assetClass}>
            <span className="swatch" style={{ background: `var(--${line.assetClass})` }} />
            <span>{ASSET_CLASS_LABELS[line.assetClass]}</span>
            <span className="num muted">{formatBps(line.weightBps)}</span>
            <span className="num">{formatMoney(line.valuePence)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Actual weight per asset class against the risk profile's target (the vertical marker). */
export function DriftBars({ lines }: { lines: AllocationLine[] }) {
  return (
    <div>
      {lines.map((line) => {
        const drift = line.driftBps;
        const label = `${drift > 0 ? "+" : ""}${formatBps(drift)}`;
        return (
          <div className="drift-row" key={line.assetClass}>
            <span>{ASSET_CLASS_LABELS[line.assetClass]}</span>
            <div
              className="drift-track"
              role="img"
              aria-label={`${ASSET_CLASS_LABELS[line.assetClass]}: ${formatBps(line.weightBps)} held, target ${formatBps(line.targetBps)}`}
            >
              <div
                className="drift-fill"
                style={{
                  width: `${line.weightBps / 100}%`,
                  background: `var(--${line.assetClass})`,
                }}
              />
              <div className="drift-target" style={{ left: `${line.targetBps / 100}%` }} />
            </div>
            <span className={`num ${Math.abs(drift) >= 500 ? "negative" : "muted"}`}>{label}</span>
          </div>
        );
      })}
    </div>
  );
}
