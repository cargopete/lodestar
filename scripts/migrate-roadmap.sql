-- Community Roadmap Tracker
-- Stores community-submitted status assessments for roadmap items.
-- Items themselves are static data in src/lib/roadmap-data.ts

CREATE TABLE IF NOT EXISTS roadmap_community_updates (
  id            SERIAL PRIMARY KEY,
  item_id       TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('on_track', 'delayed', 'shipped', 'uncertain')),
  note          TEXT,
  submitted_by  TEXT,      -- optional display name or wallet address
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_roadmap_updates_item_id ON roadmap_community_updates (item_id, created_at DESC);
