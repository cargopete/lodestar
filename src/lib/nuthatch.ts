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
 * Whether a nest behind its own staging flag is live. The panels migrated in 4.26.0 no longer
 * consult this — they need a configured Nuthatch origin and fail visibly without one, with no
 * alternate Graph source. It remains for nests still being staged in, currently only the
 * dips-nest behind `NUTHATCH_DIPS`.
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

/**
 * The full `/sql` envelope, not just the rows.
 *
 * `nuthatchSql` above throws away everything except `rows`, which is right for a panel that wants
 * numbers. The public SQL surface wants the rest: `truncated` says the answer was cut off, and
 * `provenance` says as of which block it was true and which registry decoded it. An answer a caller
 * cannot date is an answer they cannot cite, and citation is most of what this surface is for.
 */
export interface NuthatchSqlResult<T = Record<string, unknown>> {
  count: number;
  rows: T[];
  truncated?: boolean;
  degraded?: boolean;
  degraded_tables?: string[];
  tip_unavailable?: boolean;
  provenance?: {
    as_of?: number | null;
    sealed_through?: number | null;
    source?: string;
    registry_hash?: string | null;
    nid?: string | null;
  };
}

function nuthatchHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (NUTHATCH_USER && NUTHATCH_PASSWORD) {
    const basic = Buffer.from(`${NUTHATCH_USER}:${NUTHATCH_PASSWORD}`).toString('base64');
    headers.Authorization = `Basic ${basic}`;
  }
  return headers;
}

/**
 * Run one query and return the whole envelope, with the nest's own error text passed through.
 *
 * The nest sanitises its SQL errors before returning them (segment paths and content addresses
 * never appear), so relaying the message is safe and is the difference between "query failed" and
 * "no such column: tokns".
 */
export async function nuthatchSqlFull<T = Record<string, unknown>>(
  sql: string,
  basePath = '',
  timeoutMs = 15_000
): Promise<{ ok: true; data: NuthatchSqlResult<T> } | { ok: false; status: number; error: string }> {
  if (!NUTHATCH_URL) throw new Error('NUTHATCH_URL not configured');

  const res = await fetch(`${NUTHATCH_URL}${basePath}/sql?q=${encodeURIComponent(sql)}`, {
    headers: nuthatchHeaders(),
    signal: AbortSignal.timeout(timeoutMs),
    next: { revalidate: 0 },
  });

  const json = (await res.json().catch(() => null)) as
    | (NuthatchSqlResult<T> & { error?: string })
    | null;

  if (!res.ok || json?.error) {
    return { ok: false, status: res.status, error: json?.error ?? `nest returned ${res.status}` };
  }
  if (!json) return { ok: false, status: 502, error: 'nest returned an unreadable response' };
  return { ok: true, data: json };
}

/** One table the nest exposes, as `GET /tables` reports it. */
export interface NuthatchTable {
  alias: string;
  table: string;
  event: string;
  topic0?: string;
  columns: { name: string; sol_type: string; storage: string; indexed: boolean }[];
}

/** Every table a nest exposes. The schema half of the public SQL surface. */
export async function nuthatchTables(
  basePath = '',
  timeoutMs = 15_000
): Promise<NuthatchTable[]> {
  if (!NUTHATCH_URL) throw new Error('NUTHATCH_URL not configured');
  const res = await fetch(`${NUTHATCH_URL}${basePath}/tables`, {
    headers: nuthatchHeaders(),
    signal: AbortSignal.timeout(timeoutMs),
    next: { revalidate: 0 },
  });
  if (!res.ok) throw new Error(`nuthatch /tables failed: ${res.status}`);
  const json = (await res.json()) as { tables?: NuthatchTable[] };
  return json.tables ?? [];
}
