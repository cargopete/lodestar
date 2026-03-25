-- ============================================================
-- Row Level Security — defence-in-depth
-- All data is public on-chain data, so read is open.
-- Writes are restricted to the service role (cron only).
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE epochs ENABLE ROW LEVEL SECURITY;
ALTER TABLE network_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE indexers ENABLE ROW LEVEL SECURITY;
ALTER TABLE indexer_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE parameter_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE delegation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE delegator_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subgraph_deployments ENABLE ROW LEVEL SECURITY;
ALTER TABLE curation_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingestion_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE blog_posts ENABLE ROW LEVEL SECURITY;

-- Public read access (all protocol data is public)
CREATE POLICY "Public read" ON epochs FOR SELECT USING (true);
CREATE POLICY "Public read" ON network_snapshots FOR SELECT USING (true);
CREATE POLICY "Public read" ON indexers FOR SELECT USING (true);
CREATE POLICY "Public read" ON indexer_snapshots FOR SELECT USING (true);
CREATE POLICY "Public read" ON parameter_changes FOR SELECT USING (true);
CREATE POLICY "Public read" ON allocations FOR SELECT USING (true);
CREATE POLICY "Public read" ON delegation_events FOR SELECT USING (true);
CREATE POLICY "Public read" ON delegator_positions FOR SELECT USING (true);
CREATE POLICY "Public read" ON subgraph_deployments FOR SELECT USING (true);
CREATE POLICY "Public read" ON curation_signals FOR SELECT USING (true);
CREATE POLICY "Public read" ON disputes FOR SELECT USING (true);
CREATE POLICY "Public read" ON blog_posts FOR SELECT TO anon USING (is_published = true);

-- No INSERT/UPDATE/DELETE policies for anon role.
-- All writes go through the service role key which bypasses RLS.
