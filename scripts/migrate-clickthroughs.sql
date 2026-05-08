-- Referral & clickthrough analytics
-- Track trade clicks from token detail pages and protocol visits.
-- Conversion detection: background cron checks if a wallet that clicked
-- through actually swapped on-chain within 15 minutes.

CREATE TABLE IF NOT EXISTS clickthrough_events (
  id             BIGSERIAL PRIMARY KEY,
  event_type     TEXT NOT NULL CHECK (event_type IN ('trade_click', 'protocol_visit')),
  -- token context (trade clicks)
  token_address  TEXT,
  token_symbol   TEXT,
  -- protocol context (protocol visits)
  protocol_slug  TEXT,
  -- shared
  venue          TEXT NOT NULL,
  pool_address   TEXT,
  chain          TEXT NOT NULL DEFAULT 'mainnet',
  destination_url TEXT,
  -- identity
  wallet         TEXT,        -- null if user has no watched wallet
  session_id     TEXT NOT NULL,
  clicked_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- conversion tracking
  converted      BOOLEAN,     -- null=pending, true=swap detected, false=expired
  converted_at   TIMESTAMPTZ,
  converted_tx   TEXT,
  converted_usd  NUMERIC(20, 4)
);

CREATE INDEX IF NOT EXISTS idx_ct_wallet   ON clickthrough_events (wallet) WHERE wallet IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ct_pending  ON clickthrough_events (clicked_at) WHERE converted IS NULL AND wallet IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ct_venue    ON clickthrough_events (venue);
CREATE INDEX IF NOT EXISTS idx_ct_clicked  ON clickthrough_events (clicked_at DESC);
