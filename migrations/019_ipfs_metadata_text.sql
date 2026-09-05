-- ipfs_metadata gains a `text` column for documents that are not JSON: a deployment's manifest is
-- YAML at the deployment's own CID, and Lodestar reads it for the network, the substreams flag and
-- address search (nuthatch#1160, group B). Same rules as `json`: a CID is its content, fetched once.
--
-- Run on VPS: psql $DATABASE_URL -f migrations/019_ipfs_metadata_text.sql

ALTER TABLE ipfs_metadata ADD COLUMN IF NOT EXISTS text TEXT;
