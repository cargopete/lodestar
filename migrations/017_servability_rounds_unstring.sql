-- servability_rounds: repair rows whose verdict_json is a JSON string inside the jsonb rather
-- than an object (lodestar#62, #64). recordRound handed postgres.js a pre-stringified value with a
-- ::jsonb cast and postgres.js serialised it again, so every row written between #61 and #64
-- reads null for verdict_json->'probes'. The fix is in the code; this is the data.
--
-- Idempotent: a second run finds nothing to do. Prints the count before and after.
--
-- Run on the primary:
--   sudo -u postgres psql lodestar -f migrations/017_servability_rounds_unstring.sql
-- or from a laptop, without copying the file over:
--   ssh -i ~/.ssh/hetzner_drpc root@167.235.29.213 'LC_ALL=C sudo -u postgres psql lodestar' \
--     < migrations/017_servability_rounds_unstring.sql

\echo 'rows holding a string before:'
SELECT count(*) FROM servability_rounds WHERE jsonb_typeof(verdict_json) = 'string';

UPDATE servability_rounds
SET verdict_json = (verdict_json #>> '{}')::jsonb
WHERE jsonb_typeof(verdict_json) = 'string';

\echo 'rows holding a string after (expect 0):'
SELECT count(*) FROM servability_rounds WHERE jsonb_typeof(verdict_json) = 'string';

\echo 'verdict_json types now present:'
SELECT jsonb_typeof(verdict_json) AS type, count(*) FROM servability_rounds GROUP BY 1;
