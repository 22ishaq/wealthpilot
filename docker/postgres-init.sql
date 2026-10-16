-- Runs once when the database volume is created. The API logs in as this restricted role;
-- migrations run as the owner and grant it only what it needs. Local development only.
CREATE ROLE wealthpilot_app LOGIN PASSWORD 'wealthpilot_app' NOSUPERUSER NOBYPASSRLS;
