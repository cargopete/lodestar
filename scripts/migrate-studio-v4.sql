-- Studio v4: track which deployment was last published on-chain
ALTER TABLE studio_subgraphs ADD COLUMN IF NOT EXISTS last_published_deployment_id TEXT;
