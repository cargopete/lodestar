/**
 * Deficiency log for the Token API prototype.
 *
 * Andrew is feeding findings back to Pinax / Graph core devs. Every gap, bug,
 * or surprise we hit during the build gets a structured entry here with
 * enough detail (what we tried, what came back, what we'd want instead) for
 * a core dev to act on.
 *
 * Runtime accumulator: in dev we log to stdout and append to a file at the
 * repo root. In prod we'd ship to a structured sink, but v0 doesn't need it.
 */

import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const LOG_PATH = resolve(process.cwd(), 'TOKEN_API_DEFICIENCIES.md');
const seen = new Set<string>();

interface Deficiency {
  code: string;
  detail: string;
  ts: string;
}

function ensureHeader() {
  if (existsSync(LOG_PATH)) return;
  const header = `# Token API deficiencies

Auto-appended by the /tokens prototype as it hits gaps in the Token API.
Owner: Andrew Clews. Audience: Pinax / Graph core devs.

| When | Code | Detail |
|---|---|---|
`;
  writeFileSync(LOG_PATH, header);
}

export function recordDeficiency(code: string, detail: string): void {
  const key = `${code}::${detail}`;
  if (seen.has(key)) return;
  seen.add(key);
  const entry: Deficiency = { code, detail, ts: new Date().toISOString() };
  console.warn(`[token-api-deficiency] ${code}: ${detail}`);
  try {
    ensureHeader();
    appendFileSync(LOG_PATH, `| ${entry.ts} | \`${code}\` | ${detail.replace(/\|/g, '\\|')} |\n`);
  } catch (e) {
    console.warn('[token-api-deficiency] failed to append log:', e);
  }
}

/** Test/inspection helper: dump the in-memory set. */
export function listDeficiencies(): string[] {
  return [...seen];
}
