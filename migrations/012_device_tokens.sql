-- Native push device tokens (iOS APNs; room for fcm later).
-- Run on VPS: psql $DATABASE_URL -f migrations/012_device_tokens.sql
--
-- One row per device, bound to the wallet address that opted in. Ownership is
-- proved by the same EIP-191 signature over the push-subscribe message used by
-- /api/push/subscribe, so a device token can only be bound to a wallet whose key
-- the caller controls. Many devices may map to one address.

CREATE TABLE IF NOT EXISTS device_tokens (
  token        TEXT PRIMARY KEY,
  address      TEXT NOT NULL,
  platform     TEXT NOT NULL DEFAULT 'ios',
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_device_tokens_address ON device_tokens (address) WHERE is_active;
