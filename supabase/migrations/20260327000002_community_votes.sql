-- Community voting for monthly leaderboard
CREATE TABLE community_votes (
  id BIGSERIAL PRIMARY KEY,
  period TEXT NOT NULL,              -- '2026-03' format
  voter_address TEXT NOT NULL,
  indexer_address TEXT NOT NULL,
  is_delegator BOOLEAN NOT NULL DEFAULT false,
  vote_weight INTEGER NOT NULL DEFAULT 1,  -- 1 for regular, 5 for delegators
  signature TEXT NOT NULL,
  message JSONB NOT NULL,            -- the signed EIP-712 message for verification
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(period, voter_address)
);

CREATE INDEX idx_votes_period_indexer ON community_votes(period, indexer_address);
CREATE INDEX idx_votes_period ON community_votes(period);

ALTER TABLE community_votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access" ON community_votes
  FOR SELECT USING (true);
