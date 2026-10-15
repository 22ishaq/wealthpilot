import { DRIFT_ALERT_BPS, formatBps, formatMoney, type RiskProfile } from "@wealthpilot/shared";
import type { ReactNode } from "react";

import { ApiError } from "../api";
import { RISK_LABELS } from "../format";

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite">
      <div className="spinner" />
      <span className="visually-hidden">{label}</span>
    </div>
  );
}

export function ErrorAlert({ error }: { error: unknown }) {
  if (!error) return null;
  const message =
    error instanceof ApiError
      ? error.message
      : error instanceof Error
        ? error.message
        : "Something went wrong";
  return (
    <div className="alert error" role="alert">
      {message}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {actions ? <div className="row">{actions}</div> : null}
    </header>
  );
}

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

export function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label>
        {label}
        {children}
      </label>
      {error ? <span className="error">{error}</span> : null}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function RiskBadge({ profile }: { profile: RiskProfile }) {
  return <span className="badge info">{RISK_LABELS[profile]}</span>;
}

export function DriftBadge({ bps, hasAssets }: { bps: number; hasAssets: boolean }) {
  if (!hasAssets) return <span className="badge">No assets</span>;
  return (
    <span className={bps >= DRIFT_ALERT_BPS ? "badge warn" : "badge ok"}>
      {bps >= DRIFT_ALERT_BPS ? `Drift ${formatBps(bps)}` : "On target"}
    </span>
  );
}

export function Money({ pence, signed = false }: { pence: number; signed?: boolean }) {
  const className = signed ? (pence > 0 ? "positive" : pence < 0 ? "negative" : "") : "";
  const text = signed && pence > 0 ? `+${formatMoney(pence)}` : formatMoney(pence);
  return <span className={className}>{text}</span>;
}
