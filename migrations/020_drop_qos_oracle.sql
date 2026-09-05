-- The gateway QoS oracle is gone from Lodestar (nightswatchhq/nuthatch#1160): the ingest that filled
-- these tables read a third-party subgraph through GRAPH_API_KEY, and the key is being removed. What
-- Lodestar says about service quality now comes from Foghorn, its own oracle, which keeps no state here.
--
-- Deliberately not run automatically. Run on the VPS once nothing reads the tables:
--   psql $DATABASE_URL -f migrations/020_drop_qos_oracle.sql

DROP TABLE IF EXISTS indexer_qos_score;
DROP TABLE IF EXISTS deployment_daily;
DROP TABLE IF EXISTS qos_daily;
DELETE FROM ingestion_state WHERE key = 'qos';
