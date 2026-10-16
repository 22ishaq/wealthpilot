# WealthPilot

**A multi-tenant wealth management platform.** Advisory firms manage client households, accounts
and holdings, see portfolio value and allocation drift against each client's risk profile, and run
their team. Every firm's data is isolated from every other firm's, and that isolation is enforced by
PostgreSQL itself, not just by the application.

[![CI](https://github.com/22ishaq/wealthpilot/actions/workflows/ci.yml/badge.svg)](https://github.com/22ishaq/wealthpilot/actions/workflows/ci.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)
![Node 24](https://img.shields.io/badge/node-24-339933)
![PostgreSQL 17](https://img.shields.io/badge/PostgreSQL-17-336791)
![License: MIT](https://img.shields.io/badge/license-MIT-green)

```
React (Vite)  ──/api──▶  nginx  ──▶  Express API  ──(as wealthpilot_app)──▶  PostgreSQL
   shared zod schemas & types         session → tenant      SET LOCAL app.tenant_id
                                                            row-level security on every table
```

## Try it

```bash
docker compose up --build
```

Open http://localhost:8080 and sign in as `demo@northwind.test` / `wealthpilot-demo`. The demo firm
has four team members and twelve households with about £7m under management. The password is for
local demo data only.

## What makes it interesting

**Tenant isolation, three layers deep**

1. **Application:** the tenant comes from the server-side session, never from the request body,
   query or URL. Strict request schemas reject unknown fields such as `tenantId`.
2. **Row-level security:** each request runs in a transaction that sets `app.tenant_id`, and every
   tenant-owned table has a policy on it. The API connects as `wealthpilot_app`, a role that owns no
   tables and has no `BYPASSRLS`, so a query that forgets a `WHERE tenant_id = …` still cannot see
   another firm's rows. Without a tenant in scope it sees nothing at all.
3. **Composite foreign keys:** child rows reference `(tenant_id, id)`, so an account can never point
   at another firm's client, even for a connection that bypasses RLS.

Tests attack all three. Firm B tries every route with firm A's ids (each answers 404 and changes
nothing), and further tests talk to PostgreSQL directly as the application role.

**Authentication done carefully**

- **Sessions:** opaque 256-bit tokens in `HttpOnly`, `SameSite=Lax` cookies (`Secure` in
  production). Only their SHA-256 is stored, and they can be revoked server-side.
- **Passwords:** scrypt with per-password salts and parameters stored alongside the hash. The
  application role cannot even `SELECT` the hash column (column-level grants).
- **Login without a tenant:** login has to find a user before any tenant is known. It does so through
  narrow `SECURITY DEFINER` functions, which are also the only way to touch the sessions table.
- **No account enumeration:** unknown emails and wrong passwords get the same answer in the same time.
- **Throttling and CSRF:** credential endpoints are rate-limited. State-changing requests must be
  JSON and same-origin.
- **Team access:** invitations are one-time links that expire. There are four roles (owner, admin,
  advisor, viewer), and deactivating a member ends their sessions immediately.

**Money without floats**

- Amounts are integer pence, sent as decimal strings and parsed strictly. A JSON number such as
  `10.5` is rejected.
- Holdings are valued as `quantity × price` in PostgreSQL `NUMERIC` and rounded to the penny there.
- Allocation weights and drift are integer basis points, computed with BigInt where needed.
- The same code runs in the browser and on the server (`packages/shared`), so they always agree.

**Product**

- **Dashboard:** assets under management, firm-wide allocation, largest clients, rebalancing alerts
  (more than 5 points off target) and recent activity.
- **Clients:** search, advisor assignment, archiving, and accounts (ISA, SIPP, general, cash) with
  their holdings.
- **Client detail:** allocation compared with the risk profile's target, plus book cost and
  gain or loss.
- **Activity:** an append-only audit trail. The database role can insert into it but never update or
  delete.

## Quality gate

CI runs on every push and PR:

- **Lint:** ESLint (strict type-checked rules, React hooks) and Prettier.
- **Types:** `tsc` in strict mode.
- **Tests:** 211 in total with coverage thresholds:
  - 121 API tests against a real PostgreSQL 17 service container,
  - 52 tests for the shared domain logic,
  - 38 React component and workflow tests.
- **Build:** the production build of every package.
- **Docker:** both images are built and the full Compose stack is smoke-tested through nginx.

## Local development

```bash
npm install
npm run build -w @wealthpilot/shared
cp apps/api/.env.example apps/api/.env   # point at your PostgreSQL
npm run db:migrate && npm run db:seed
npm run dev:api                          # :3000
npm run dev:web                          # :5173, proxies /api
```

Run the tests with a database whose name contains `test`. The suite resets its schema, so it
refuses any other database. `TEST_ADMIN_DATABASE_URL` is the schema owner; `TEST_DATABASE_URL` is
the app role, which the setup creates.

```bash
npm run lint && npm run typecheck && npm test
```

## Layout

```
packages/shared   money, allocation maths, roles, zod schemas, API types
apps/api          Express 5 API, SQL migrations (RLS, grants, auth functions), tests
apps/web          React 19 + React Router + TanStack Query, Vite
docker/           PostgreSQL role bootstrap for Compose
scripts/smoke.sh  end-to-end check of the running stack
```

> Security prices in the seed data are illustrative, not market data.

## Licence

MIT
