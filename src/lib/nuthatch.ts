// nuthatch data source (RFC-0011 pilot): serve event-derived data from our own indexer instead of
// The Graph gateway. A nuthatch nest exposes each contract event as a table `"<alias>__<event>"`
// queryable over a guarded `GET /sql?q=<SQL>` surface (row-capped + timed out server-side). This is
// the sibling of `subgraph.ts`: same "fetch → shape → return" contract, SQL instead of GraphQL.
//
// First consumer: the delegation-events feed (`/api/delegation-events`), backed by the
// `graph-staking-nest` on the Helsinki box (HorizonStaking delegation events). Everything is opt-in
// and falls back to the subgraph, so an unconfigured or unreachable nest changes nothing.

const NUTHATCH_URL = process.env.NUTHATCH_URL?.replace(/\/$/, '');
const NUTHATCH_USER = process.env.NUTHATCH_USER;
const NUTHATCH_PASSWORD = process.env.NUTHATCH_PASSWORD;

/** Whether a nuthatch base URL is configured at all. */
export function hasNuthatch(): boolean {
  return Boolean(NUTHATCH_URL);
}

/**
 * Per-panel opt-in flag. A migrated route serves from nuthatch only when its flag is `"true"` AND a
 * nuthatch URL is configured — so flipping a panel back to The Graph is a one-line env change.
 */
export function nuthatchEnabled(flag: string): boolean {
  return hasNuthatch() && process.env[flag] === 'true';
}

/**
 * Run one SQL query against a nest's `/sql` surface and return its rows. `basePath` selects which nest
 * behind the shared host (empty = the default `graph-staking-nest` on `/sql`; `"/gns"` = the
 * `graph-gns-nest` reverse-proxied under `/gns/sql`). One URL + credential fronts both.
 */
export async function nuthatchSql<T = Record<string, unknown>>(
  sql: string,
  basePath = ''
): Promise<T[]> {
  if (!NUTHATCH_URL) throw new Error('NUTHATCH_URL not configured');
  const headers: Record<string, string> = {};
  if (NUTHATCH_USER && NUTHATCH_PASSWORD) {
    const basic = Buffer.from(`${NUTHATCH_USER}:${NUTHATCH_PASSWORD}`).toString('base64');
    headers.Authorization = `Basic ${basic}`;
  }

  const res = await fetch(`${NUTHATCH_URL}${basePath}/sql?q=${encodeURIComponent(sql)}`, {
    headers,
    // Server-side only; the nest is finality-gated, so a short cache is safe and cheap.
    next: { revalidate: 0 },
  });
  if (!res.ok) {
    throw new Error(`nuthatch /sql request failed: ${res.status}`);
  }
  const json = (await res.json()) as { rows?: T[]; error?: string };
  if (json.error) {
    throw new Error(`nuthatch /sql error: ${json.error}`);
  }
  return json.rows ?? [];
}
