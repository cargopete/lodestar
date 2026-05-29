/**
 * Lodestar-issued API key helpers (RFC-004).
 *
 * Self-contained crypto (no auth.ts / next imports) so the standalone VPS proxy
 * can verify keys without pulling in the Next runtime. We issue these keys, so we
 * store only a one-way SHA-256 hash — never the plaintext.
 *
 * Format: `lod_live_` + 48 lowercase hex chars (24 random bytes).
 */
import { createHash, randomBytes } from 'crypto';

const KEY_PREFIX = 'lod_live_';
const RANDOM_BYTES = 24; // → 48 hex chars
const DISPLAY_PREFIX_LEN = KEY_PREFIX.length + 4; // e.g. "lod_live_ab12"

export const API_KEY_RE = /^lod_live_[0-9a-f]{48}$/;

export function hashApiKey(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

export function isValidApiKeyFormat(key: string): boolean {
  return API_KEY_RE.test(key);
}

/** Mint a new key. Plaintext is shown to the user ONCE; only the hash is stored. */
export function generateApiKey(): { plaintext: string; hash: string; prefix: string } {
  const plaintext = KEY_PREFIX + randomBytes(RANDOM_BYTES).toString('hex');
  return {
    plaintext,
    hash: hashApiKey(plaintext),
    prefix: plaintext.slice(0, DISPLAY_PREFIX_LEN),
  };
}
