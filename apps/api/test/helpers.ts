import type {
  Account,
  ClientDetail,
  CreatedInvitation,
  Me,
  RiskProfile,
  Role,
} from "@wealthpilot/shared";
import pg from "pg";
import { pino } from "pino";
import request from "supertest";
import type TestAgent from "supertest/lib/agent.js";
import { expect } from "vitest";

import { createApp } from "../src/app.js";
import { loadConfig, type Config } from "../src/config.js";
import { createPool } from "../src/db.js";

export const config: Config = loadConfig({
  NODE_ENV: "test",
  DATABASE_URL: process.env["TEST_DATABASE_URL"],
  APP_ORIGIN: "http://localhost:5173",
  SCRYPT_COST: "1024",
  LOGIN_RATE_LIMIT: "1000",
  LOG_LEVEL: "silent",
});

/** The application's own connection: the restricted wealthpilot_app role. */
export const pool = createPool(config.databaseUrl, 10);

/** The schema owner, for assertions that must see past row-level security. */
export const adminPool = new pg.Pool({
  connectionString: process.env["TEST_ADMIN_DATABASE_URL"],
  max: 2,
});

export function makeApp(overrides: Partial<Config> = {}) {
  return createApp({
    pool,
    config: { ...config, ...overrides },
    logger: pino({ level: "silent" }),
  });
}

export const app = makeApp();

export type Agent = TestAgent;

let counter = 0;
export function uniqueEmail(label = "user"): string {
  counter += 1;
  return `${label}.${Date.now().toString(36)}.${counter}@example.test`;
}

export const PASSWORD = "correct horse battery staple";

export interface Firm {
  agent: Agent;
  me: Me;
  email: string;
}

export async function signUp(firmName = "Acme Wealth"): Promise<Firm> {
  const agent = request.agent(app);
  const email = uniqueEmail("owner");
  const res = await agent
    .post("/api/auth/signup")
    .send({ firmName, name: "Olivia Owner", email, password: PASSWORD })
    .expect(201);
  return { agent, me: res.body as Me, email };
}

/** Invite someone into `firm` with `role` and accept as them; returns their signed-in agent. */
export async function addMember(firm: Firm, role: Exclude<Role, "owner">): Promise<Firm> {
  const email = uniqueEmail(role);
  const invite = await firm.agent
    .post("/api/members/invitations")
    .send({ email, role })
    .expect(201);
  const token = (invite.body as CreatedInvitation).inviteUrl.split("/").pop() ?? "";
  const agent = request.agent(app);
  const res = await agent
    .post("/api/auth/invitations/accept")
    .send({ token, name: `${role} member`, password: PASSWORD })
    .expect(201);
  return { agent, me: res.body as Me, email };
}

export async function createClient(
  agent: Agent,
  overrides: { name?: string; riskProfile?: RiskProfile; advisorId?: string | null } = {},
): Promise<ClientDetail> {
  const res = await agent
    .post("/api/clients")
    .send({ name: "Jane Client", riskProfile: "balanced", ...overrides })
    .expect(201);
  return res.body as ClientDetail;
}

export async function openAccount(agent: Agent, clientId: string, cash = "0.00"): Promise<Account> {
  const res = await agent
    .post(`/api/clients/${clientId}/accounts`)
    .send({ name: "ISA", type: "isa", cash })
    .expect(201);
  return res.body as Account;
}

export async function addHolding(
  agent: Agent,
  accountId: string,
  symbol: string,
  quantity: string,
  bookCost: string,
): Promise<Account> {
  const res = await agent
    .post(`/api/accounts/${accountId}/holdings`)
    .send({ symbol, quantity, bookCost })
    .expect(201);
  return res.body as Account;
}

export function expectError(body: unknown, code: string): void {
  expect(body).toMatchObject({ error: { code } });
}
