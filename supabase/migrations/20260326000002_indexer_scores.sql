-- ============================================================
-- Indexer Leaderboard Scores (RFC-003)
-- Computed nightly, one row per indexer per period per date.
-- ============================================================

CREATE TABLE indexer_scores (
  id                          bigserial PRIMARY KEY,
  indexer_address             text NOT NULL,
  period_type                 text NOT NULL,    -- 'monthly' (weekly/alltime later)
  period_start                date NOT NULL,
  period_end                  date NOT NULL,
  computed_at                 timestamptz DEFAULT now(),

  -- Component 1: Network Contribution (max 35 pts)
  query_fee_score             numeric,          -- 0–20
  allocation_efficiency_score numeric,          -- 0–15

  -- Component 2: Economics (max 25 pts)
  delegator_apr_score         numeric,          -- 0–10
  effective_cut_score         numeric,          -- 0–10
  capacity_score              numeric,          -- 0–5

  -- Component 3: Trust & Stability (max 20 pts)
  cut_stability_score         numeric,          -- 0–12
  tenure_bonus                numeric,          -- 0–5
  retention_score             numeric,          -- 0–3

  -- Component 4: Protocol Health (max 10 pts)
  reo_score                   numeric,          -- 0–4
  poi_consensus_score         numeric,          -- 0–4
  allocation_breadth_score    numeric,          -- 0–2

  -- Component 5: Community Votes (max 10 pts — Phase 3)
  community_vote_score        numeric DEFAULT 0,-- 0–10

  -- Totals
  subtotal                    numeric,          -- 0–100 before penalties
  penalty_multiplier          numeric,          -- 0.5–1.0
  final_score                 numeric,          -- 0–100 (normalised)

  -- Rank
  rank                        integer,

  -- Metadata
  months_active               integer,
  is_eligible_for_badge       boolean DEFAULT false,

  UNIQUE(indexer_address, period_type, period_start)
);

CREATE INDEX idx_scores_leaderboard
  ON indexer_scores(period_type, period_start DESC, final_score DESC);

CREATE INDEX idx_scores_indexer
  ON indexer_scores(indexer_address, period_type, period_start DESC);
