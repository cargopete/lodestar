-- Studio: subgraph developer platform

CREATE TABLE IF NOT EXISTS studio_subgraphs (
  id             SERIAL PRIMARY KEY,
  owner_address  TEXT NOT NULL,
  slug           TEXT NOT NULL UNIQUE,        -- "org/name" used as graph-node subgraph name
  display_name   TEXT,
  deployment_id  TEXT,                         -- latest Qm... IPFS hash from graph-node
  network        TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_studio_subgraphs_owner ON studio_subgraphs(owner_address);

-- One active deploy key per developer (upsert on conflict)
CREATE TABLE IF NOT EXISTS studio_deploy_keys (
  id             SERIAL PRIMARY KEY,
  owner_address  TEXT NOT NULL UNIQUE,
  key_hash       TEXT NOT NULL,               -- SHA-256 of the plaintext deploy key
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at   TIMESTAMPTZ
);

-- Sync bounties: developers offer GRT to any indexer that fully syncs their subgraph
CREATE TABLE IF NOT EXISTS sync_bounties (
  id                 SERIAL PRIMARY KEY,
  deployment_id      TEXT NOT NULL,
  subgraph_id        INTEGER REFERENCES studio_subgraphs(id) ON DELETE SET NULL,
  developer_address  TEXT NOT NULL,
  amount_grt         TEXT NOT NULL,            -- decimal string, e.g. "250"
  message            TEXT,
  status             TEXT NOT NULL DEFAULT 'open',  -- open | claimed | cancelled | expired
  claimed_by         TEXT,
  claimed_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sync_bounties_deployment ON sync_bounties(deployment_id);
CREATE INDEX IF NOT EXISTS idx_sync_bounties_status     ON sync_bounties(status);
