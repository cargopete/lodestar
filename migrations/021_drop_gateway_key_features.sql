-- The features that queried the gateway with Lodestar's own Graph API key are gone
-- (nightswatchhq/nuthatch#1160): the metered query gateway and the Studio API keys it authenticated,
-- and the subgraph health alerts whose cron resolved deployments through the gateway.
--
-- Deliberately not run automatically. Run on the VPS once this is deployed:
--   psql $DATABASE_URL -f migrations/021_drop_gateway_key_features.sql

DROP TABLE IF EXISTS api_key_usage;
DROP TABLE IF EXISTS studio_api_keys;
DROP TABLE IF EXISTS subgraph_alert_log;
DROP TABLE IF EXISTS subgraph_alerts;
