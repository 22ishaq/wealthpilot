/**
 * Role-based access. The API enforces these permissions; the web app uses the same table to
 * decide what to show, so the two cannot disagree.
 */

export const ROLES = ["owner", "admin", "advisor", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const INVITABLE_ROLES = ["admin", "advisor", "viewer"] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export type Permission = "clients:write" | "members:manage" | "audit:read";

const GRANTS: Readonly<Record<Role, readonly Permission[]>> = {
  owner: ["clients:write", "members:manage", "audit:read"],
  admin: ["clients:write", "members:manage", "audit:read"],
  advisor: ["clients:write"],
  viewer: [],
};

export function can(role: Role, permission: Permission): boolean {
  return GRANTS[role].includes(permission);
}
