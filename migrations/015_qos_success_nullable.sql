-- qos_daily.success_count: allow NULL, meaning "the oracle published no success figure for
-- this (indexer, deployment, day)".
--
-- It was NOT NULL DEFAULT 0, and the ingest computed `Number(proportion) * query_count`, where
-- `Number(null)` is 0. An absent figure and a genuine "every query failed" therefore landed in
-- the column as the same value, and the scorer read both as total failure. The live feed does
-- publish a real 0 for indexers serving no 200s, which must keep scoring as a zero; this change
-- only lets the ABSENT case say so.
--
-- Run on VPS: psql $DATABASE_URL -f migrations/015_qos_success_nullable.sql

ALTER TABLE qos_daily ALTER COLUMN success_count DROP DEFAULT;
ALTER TABLE qos_daily ALTER COLUMN success_count DROP NOT NULL;
