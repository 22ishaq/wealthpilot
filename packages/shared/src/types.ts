/** Response shapes of the WealthPilot API. Money is always integer pence. */

import type { AllocationLine, AssetClass, RiskProfile } from "./allocation.js";
import type { Role } from "./roles.js";
import type { AccountType } from "./schemas.js";

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface Tenant {
  id: string;
  name: string;
}

export interface Me {
  user: SessionUser;
  tenant: Tenant;
}

export interface Member {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  createdAt: string;
}

export interface Invitation {
  id: string;
  email: string;
  role: Role;
  createdAt: string;
  expiresAt: string;
}

export interface CreatedInvitation extends Invitation {
  /** The one-time link. Only returned when the invitation is created. */
  inviteUrl: string;
}

export interface InvitationPreview {
  firmName: string;
  email: string;
  role: Role;
}

export interface Security {
  symbol: string;
  name: string;
  assetClass: AssetClass;
  pricePence: number;
  priceDate: string;
}

export interface PersonRef {
  id: string;
  name: string;
}

export interface ClientSummary {
  id: string;
  name: string;
  email: string | null;
  riskProfile: RiskProfile;
  advisor: PersonRef | null;
  valuePence: number;
  accountCount: number;
  maxDriftBps: number;
  archived: boolean;
  createdAt: string;
}

export interface Holding {
  id: string;
  symbol: string;
  name: string;
  assetClass: AssetClass;
  quantity: string;
  pricePence: number;
  valuePence: number;
  bookCostPence: number;
  gainPence: number;
}

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  cashPence: number;
  valuePence: number;
  holdings: Holding[];
}

export interface ClientDetail extends ClientSummary {
  accounts: Account[];
  allocation: AllocationLine[];
  bookCostPence: number;
  gainPence: number;
}

export interface AuditEvent {
  id: string;
  actor: PersonRef | null;
  action: string;
  entityType: string;
  entityId: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface Dashboard {
  aumPence: number;
  clientCount: number;
  accountCount: number;
  allocation: AllocationLine[];
  topClients: ClientSummary[];
  driftAlerts: ClientSummary[];
  recentActivity: AuditEvent[];
}
