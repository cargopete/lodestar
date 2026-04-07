-- network_snapshots: add total_supply_grt column
-- Required by src/lib/ingest/network-snapshot.ts after the totalSupply field
-- was added to the GraphNetwork query. Without this column, every snapshot
-- cron run fails with: column "total_supply_grt" of relation "network_snapshots" does not exist.

ALTER TABLE network_snapshots ADD COLUMN IF NOT EXISTS total_supply_grt NUMERIC;
