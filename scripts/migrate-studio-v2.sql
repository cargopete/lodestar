-- Studio v2: add metadata + publication tracking to studio_subgraphs

ALTER TABLE studio_subgraphs ADD COLUMN IF NOT EXISTS description TEXT;

-- The on-chain subgraph ID (uint256 from GNS.publishNewSubgraph) stored as text
ALTER TABLE studio_subgraphs ADD COLUMN IF NOT EXISTS published_subgraph_id TEXT;
