-- Persist the thawing split on indexer snapshots so the historical
-- active-vs-thawing breakdown (and APR provenance over time) can be drawn,
-- rather than only the current on-chain/subgraph value.
ALTER TABLE indexer_snapshots
  ADD COLUMN IF NOT EXISTS delegated_thawing_grt NUMERIC;
