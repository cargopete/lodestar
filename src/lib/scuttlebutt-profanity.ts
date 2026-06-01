/**
 * Minimal profanity guard for Scuttlebutt.
 *
 * Deliberately small and conservative — masks a core set of slurs/obscenities
 * with asterisks rather than rejecting the whole message. Extra words can be
 * added at deploy time via SCUTTLEBUTT_EXTRA_BLOCKWORDS (comma-separated) so the
 * list can be tuned without a code change. This is a speed-bump, not a panacea:
 * admin delete/ban remains the backstop.
 */

const CORE_BLOCKLIST = [
  'fuck',
  'shit',
  'bitch',
  'cunt',
  'asshole',
  'bastard',
  'dick',
  'piss',
];

function blocklist(): string[] {
  const extra = (process.env.SCUTTLEBUTT_EXTRA_BLOCKWORDS ?? '')
    .split(',')
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);
  return [...CORE_BLOCKLIST, ...extra];
}

export interface CleanResult {
  /** false only when the message is empty after trimming. */
  ok: boolean;
  /** Body with blocked words masked. */
  filtered: string;
}

/** Mask any blocklisted words (whole-word, case-insensitive) with asterisks. */
export function clean(body: string): CleanResult {
  const trimmed = body.trim();
  if (!trimmed) return { ok: false, filtered: '' };

  let filtered = trimmed;
  for (const word of blocklist()) {
    if (!word) continue;
    const re = new RegExp(`\\b${escapeRegExp(word)}\\b`, 'gi');
    filtered = filtered.replace(re, (m) => '*'.repeat(m.length));
  }
  return { ok: true, filtered };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
