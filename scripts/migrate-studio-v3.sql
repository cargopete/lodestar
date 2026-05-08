-- Studio v3: track the last published version label
ALTER TABLE studio_subgraphs ADD COLUMN IF NOT EXISTS version_label TEXT;
