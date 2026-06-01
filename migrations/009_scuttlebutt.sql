-- Scuttlebutt — anonymous chat (messages + bans)
-- Run on VPS: psql $DATABASE_URL -f migrations/009_scuttlebutt.sql
--
-- Privacy: raw IPs are NEVER stored. ip_hash is an HMAC(ip, SCUTTLEBUTT_IP_PEPPER)
-- — enough to ban a poster without retaining PII.

CREATE TABLE IF NOT EXISTS scuttlebutt_messages (
  id            BIGSERIAL PRIMARY KEY,
  room          TEXT        NOT NULL DEFAULT 'main',
  name          TEXT,                       -- display name sans tripcode (NULL -> "Anonymous")
  tripcode      TEXT,                       -- e.g. "!a8Df2xQ" (NULL when no #secret given)
  body          TEXT        NOT NULL,
  ip_hash       TEXT        NOT NULL,       -- HMAC(ip, pepper); never the raw IP
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted       BOOLEAN     NOT NULL DEFAULT false,
  deleted_at    TIMESTAMPTZ,
  delete_reason TEXT
);

-- History reads are "newest-first within a room", with keyset pagination on id.
CREATE INDEX IF NOT EXISTS idx_sb_msg_room_id ON scuttlebutt_messages (room, id DESC);

CREATE TABLE IF NOT EXISTS scuttlebutt_bans (
  id         BIGSERIAL PRIMARY KEY,
  ip_hash    TEXT,                          -- ban by ip_hash...
  tripcode   TEXT,                          -- ...and/or tripcode
  reason     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,                   -- NULL = permanent
  CONSTRAINT sb_ban_target CHECK (ip_hash IS NOT NULL OR tripcode IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_sb_ban_iphash   ON scuttlebutt_bans (ip_hash);
CREATE INDEX IF NOT EXISTS idx_sb_ban_tripcode ON scuttlebutt_bans (tripcode);
