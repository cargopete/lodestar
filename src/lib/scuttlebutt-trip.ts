import { createHmac } from 'crypto';

/**
 * Old-school tripcodes for Scuttlebutt.
 *
 * A poster may type their name as `Name#secret`. The part after the first `#`
 * is a secret only they know; we turn it into a short, deterministic tripcode
 * (`!a8Df2xQ1z`) via HMAC with a server-side salt. Same secret always yields the
 * same trip, so a poster can prove continuity of identity without any account —
 * but the secret itself can't be recovered from the trip.
 */

const MAX_NAME = 40;

function tripSalt(): string {
  // Salt is a server secret; without it tripcodes would be guessable. Empty is
  // tolerated (e.g. local dev) — determinism still holds, just not secrecy.
  return process.env.SCUTTLEBUTT_TRIP_SALT ?? '';
}

export interface ParsedName {
  /** Display name with the `#secret` stripped off; null means "Anonymous". */
  name: string | null;
  /** e.g. "!a8Df2xQ1z"; null when no secret was supplied. */
  tripcode: string | null;
}

export function makeTripcode(secret: string): string {
  const digest = createHmac('sha256', tripSalt()).update(secret).digest('base64');
  const code = digest.replace(/[^A-Za-z0-9]/g, '').slice(0, 10);
  return `!${code}`;
}

/**
 * Split a raw name field into a display name and (optional) tripcode.
 * `"Pete#hunter2"` -> { name: "Pete", tripcode: "!…" }
 * `"#hunter2"`     -> { name: null,  tripcode: "!…" }  (anonymous + trip)
 * `"Pete"`         -> { name: "Pete", tripcode: null }
 */
export function parseName(raw: string | null | undefined): ParsedName {
  if (!raw) return { name: null, tripcode: null };
  const trimmed = raw.trim();
  const hashIdx = trimmed.indexOf('#');
  if (hashIdx === -1) {
    const name = trimmed.slice(0, MAX_NAME).trim();
    return { name: name || null, tripcode: null };
  }
  const namePart = trimmed.slice(0, hashIdx).trim().slice(0, MAX_NAME);
  const secret = trimmed.slice(hashIdx + 1);
  return { name: namePart || null, tripcode: secret ? makeTripcode(secret) : null };
}
