-- WealthPilot schema.
--
-- Tenant isolation is enforced three times, so a bug in one layer is not a data leak:
--   1. The API derives tenant_id from the session, never from the request.
--   2. Row-level security: tenant-owned tables only show and accept rows whose tenant_id
--      matches the transaction's app.tenant_id. The API connects as wealthpilot_app, which
--      does not own the tables and therefore cannot bypass the policies.
--   3. Composite foreign keys carry tenant_id, so a row can never reference another
--      tenant's row, even for a connection that bypasses RLS.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wealthpilot_app') THEN
    CREATE ROLE wealthpilot_app NOLOGIN;
  END IF;
END
$$;

CREATE FUNCTION app_current_tenant() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE TABLE tenants (
  id          uuid PRIMARY KEY,
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id              uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  email           text NOT NULL CHECK (email = lower(email) AND email LIKE '%_@_%'),
  name            text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  role            text NOT NULL CHECK (role IN ('owner', 'admin', 'advisor', 'viewer')),
  password_hash   text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  deactivated_at  timestamptz,
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX users_email_key ON users (email);
CREATE UNIQUE INDEX users_one_owner_per_tenant ON users (tenant_id) WHERE role = 'owner';

CREATE TABLE sessions (
  token_hash  text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  tenant_id   uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE invitations (
  id           uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  email        text NOT NULL CHECK (email = lower(email)),
  role         text NOT NULL CHECK (role IN ('admin', 'advisor', 'viewer')),
  invited_by   uuid NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  accepted_at  timestamptz,
  FOREIGN KEY (tenant_id, invited_by) REFERENCES users (tenant_id, id)
);

-- Reference data shared by every tenant: read-only to the application.
CREATE TABLE securities (
  symbol       text PRIMARY KEY CHECK (symbol ~ '^[A-Z0-9.]{1,12}$'),
  name         text NOT NULL,
  asset_class  text NOT NULL CHECK (asset_class IN ('equity', 'bond', 'property', 'commodity', 'cash')),
  price_pence  bigint NOT NULL CHECK (price_pence > 0),
  price_date   date NOT NULL
);

CREATE TABLE clients (
  id            uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  email         text CHECK (email = lower(email)),
  risk_profile  text NOT NULL CHECK (risk_profile IN ('conservative', 'balanced', 'growth', 'adventurous')),
  advisor_id    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  archived_at   timestamptz,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, advisor_id) REFERENCES users (tenant_id, id)
);
CREATE INDEX clients_tenant_name_idx ON clients (tenant_id, name);

CREATE TABLE accounts (
  id          uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id   uuid NOT NULL,
  client_id   uuid NOT NULL,
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  type        text NOT NULL CHECK (type IN ('isa', 'sipp', 'gia', 'cash')),
  cash_pence  bigint NOT NULL DEFAULT 0 CHECK (cash_pence >= 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, client_id) REFERENCES clients (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX accounts_client_idx ON accounts (tenant_id, client_id);

CREATE TABLE holdings (
  id               uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id        uuid NOT NULL,
  account_id       uuid NOT NULL,
  symbol           text NOT NULL REFERENCES securities (symbol),
  quantity         numeric(20, 6) NOT NULL CHECK (quantity > 0),
  book_cost_pence  bigint NOT NULL CHECK (book_cost_pence >= 0),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CONSTRAINT holdings_account_symbol_key UNIQUE (account_id, symbol),
  FOREIGN KEY (tenant_id, account_id) REFERENCES accounts (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE audit_events (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  actor_id     uuid,
  action       text NOT NULL,
  entity_type  text NOT NULL,
  entity_id    uuid,
  details      jsonb NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_tenant_idx ON audit_events (tenant_id, id DESC);

-- Row-level security ---------------------------------------------------------------------

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenants
  USING (id = app_current_tenant()) WITH CHECK (id = app_current_tenant());

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['users', 'invitations', 'clients', 'accounts', 'holdings', 'audit_events']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant())'
      ' WITH CHECK (tenant_id = app_current_tenant())', t);
  END LOOP;
END
$$;

-- No policy at all: the application role sees no sessions. Only the functions below do.
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

-- Privileges -----------------------------------------------------------------------------

GRANT USAGE ON SCHEMA public TO wealthpilot_app;
GRANT SELECT, INSERT ON tenants TO wealthpilot_app;
-- Column grants: the application can create users but can never read a password hash.
GRANT SELECT (id, tenant_id, email, name, role, created_at, deactivated_at) ON users TO wealthpilot_app;
GRANT INSERT (tenant_id, email, name, role, password_hash) ON users TO wealthpilot_app;
GRANT UPDATE (role, deactivated_at) ON users TO wealthpilot_app;
GRANT SELECT, INSERT, DELETE ON invitations TO wealthpilot_app;
GRANT UPDATE (accepted_at) ON invitations TO wealthpilot_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON clients, accounts, holdings TO wealthpilot_app;
GRANT SELECT, INSERT ON audit_events TO wealthpilot_app;  -- append-only
GRANT SELECT ON securities TO wealthpilot_app;

-- Authentication functions ---------------------------------------------------------------
-- These run as the schema owner, which row-level security does not restrict, so a login
-- can find its user before any tenant is known. Each one does a single narrow job and is
-- the only path to the sessions table.

CREATE FUNCTION auth_login_lookup(p_email text)
  RETURNS TABLE (user_id uuid, password_hash text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT id, password_hash FROM users WHERE email = lower(p_email) AND deactivated_at IS NULL
  $$;

CREATE FUNCTION auth_create_session(p_token_hash text, p_user_id uuid, p_ttl interval)
  RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
  BEGIN
    DELETE FROM sessions WHERE user_id = p_user_id AND expires_at < now();
    INSERT INTO sessions (token_hash, user_id, tenant_id, expires_at)
      SELECT p_token_hash, id, tenant_id, now() + p_ttl
        FROM users WHERE id = p_user_id AND deactivated_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'no active user %', p_user_id USING ERRCODE = 'no_data_found';
    END IF;
  END
  $$;

CREATE FUNCTION auth_resolve_session(p_token_hash text)
  RETURNS TABLE (user_id uuid, tenant_id uuid, tenant_name text, email text, name text, role text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT u.id, u.tenant_id, t.name, u.email, u.name, u.role
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      JOIN tenants t ON t.id = u.tenant_id
     WHERE s.token_hash = p_token_hash AND s.expires_at > now() AND u.deactivated_at IS NULL
  $$;

CREATE FUNCTION auth_revoke_session(p_token_hash text)
  RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$ DELETE FROM sessions WHERE token_hash = p_token_hash $$;

-- Ends another member's sessions, but only inside the caller's own tenant.
CREATE FUNCTION auth_revoke_user_sessions(p_user_id uuid)
  RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$ DELETE FROM sessions WHERE user_id = p_user_id AND tenant_id = app_current_tenant() $$;

CREATE FUNCTION auth_invitation_lookup(p_token_hash text)
  RETURNS TABLE (invitation_id uuid, tenant_id uuid, tenant_name text, email text, role text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
  AS $$
    SELECT i.id, i.tenant_id, t.name, i.email, i.role
      FROM invitations i
      JOIN tenants t ON t.id = i.tenant_id
     WHERE i.token_hash = p_token_hash AND i.accepted_at IS NULL AND i.expires_at > now()
  $$;

REVOKE ALL ON FUNCTION
  auth_login_lookup(text),
  auth_create_session(text, uuid, interval),
  auth_resolve_session(text),
  auth_revoke_session(text),
  auth_revoke_user_sessions(uuid),
  auth_invitation_lookup(text)
  FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  auth_login_lookup(text),
  auth_create_session(text, uuid, interval),
  auth_resolve_session(text),
  auth_revoke_session(text),
  auth_revoke_user_sessions(uuid),
  auth_invitation_lookup(text)
  TO wealthpilot_app;
