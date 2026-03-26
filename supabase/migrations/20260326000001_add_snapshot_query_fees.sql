-- Add query_fees_collected_grt to indexer_snapshots for future recent-volume scoring
ALTER TABLE indexer_snapshots
  ADD COLUMN IF NOT EXISTS query_fees_collected_grt numeric;
