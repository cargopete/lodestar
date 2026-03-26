-- Add delegation exchange rate to snapshots and indexers
-- for the new exchange-rate-based APY calculation.

ALTER TABLE indexer_snapshots
  ADD COLUMN delegation_exchange_rate numeric;

ALTER TABLE indexers
  ADD COLUMN delegation_exchange_rate numeric;
