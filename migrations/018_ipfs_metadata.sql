-- ipfs_metadata: the JSON documents behind subgraph and version metadata hashes (nuthatch#1160,
-- group B). A CID is its content, so a row never goes stale; a row with `error` set and `json` null is
-- a fetch that failed and is retried an hour later by `src/lib/subgraph-metadata.ts`. This is what lets
-- Lodestar name a subgraph without the Graph gateway: the hash comes from graph-gns-nest, the document
-- from the IPFS API, and this table means IPFS is asked once per document, ever.
--
-- Run on VPS: psql $DATABASE_URL -f migrations/018_ipfs_metadata.sql

CREATE TABLE IF NOT EXISTS ipfs_metadata (
  cid        TEXT PRIMARY KEY,
  json       JSONB,
  error      TEXT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Name search over what has been fetched, for /api/subgraph-search.
CREATE INDEX IF NOT EXISTS idx_ipfs_metadata_display_name
  ON ipfs_metadata (LOWER(json->>'displayName'))
  WHERE json ? 'displayName';
