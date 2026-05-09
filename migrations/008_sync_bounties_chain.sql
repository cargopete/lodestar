-- Add on-chain tracking fields to sync_bounties
-- Run on VPS: psql $DATABASE_URL -f migrations/008_sync_bounties_chain.sql

ALTER TABLE sync_bounties
  ADD COLUMN IF NOT EXISTS chain_bounty_id TEXT,
  ADD COLUMN IF NOT EXISTS post_tx_hash    TEXT;
