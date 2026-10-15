import type { AssetClass, AuditEvent, RiskProfile, Role } from "@wealthpilot/shared";

export const ASSET_CLASS_LABELS: Readonly<Record<AssetClass, string>> = {
  equity: "Equities",
  bond: "Bonds",
  property: "Property",
  commodity: "Commodities",
  cash: "Cash",
};

export const RISK_LABELS: Readonly<Record<RiskProfile, string>> = {
  conservative: "Conservative",
  balanced: "Balanced",
  growth: "Growth",
  adventurous: "Adventurous",
};

export const ROLE_LABELS: Readonly<Record<Role, string>> = {
  owner: "Owner",
  admin: "Admin",
  advisor: "Advisor",
  viewer: "Viewer",
};

const ACTIONS: Readonly<Record<string, string>> = {
  "firm.created": "created the firm",
  "client.created": "added a client",
  "client.updated": "updated a client",
  "client.archived": "archived a client",
  "client.restored": "restored a client",
  "account.opened": "opened an account",
  "account.updated": "updated an account",
  "account.closed": "closed an account",
  "holding.added": "added a holding",
  "holding.updated": "updated a holding",
  "holding.removed": "removed a holding",
  "member.invited": "invited a team member",
  "member.joined": "joined the firm",
  "member.role_changed": "changed a member's role",
  "member.deactivated": "deactivated a member",
  "invitation.revoked": "revoked an invitation",
};

export function describeEvent(event: AuditEvent): string {
  const who = event.actor?.name ?? "Someone";
  const what = ACTIONS[event.action] ?? event.action;
  const subject =
    typeof event.details["name"] === "string"
      ? `: ${event.details["name"]}`
      : typeof event.details["symbol"] === "string"
        ? `: ${event.details["symbol"]}`
        : typeof event.details["email"] === "string"
          ? `: ${event.details["email"]}`
          : "";
  return `${who} ${what}${subject}`;
}

const dateTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });
const relative = new Intl.RelativeTimeFormat("en-GB", { numeric: "auto" });

export function formatDateTime(iso: string): string {
  return dateTime.format(new Date(iso));
}

export function timeAgo(iso: string, now: number = Date.now()): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return "just now";
}
