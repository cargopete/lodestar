// nuthatch data source (RFC-0011 pilot): serve event-derived data from our own indexer instead of
// The Graph gateway. A nuthatch nest exposes each contract event as a table `"<alias>__<event>"`
// queryable over a guarded `GET /sql?q=<SQL>` surface (row-capped + timed out server-side). This is
// the sibling of `subgraph.ts`: same "fetch → shape → return" contract, SQL instead of GraphQL.
//
// First consumer: the delegation-events feed (`/api/delegation-events`), backed by the
// `graph-staking-nest` on the Helsinki box (HorizonStaking delegation events). Everything is opt-in
// and falls back to the subgraph, so an unconfigured or unreachable nest changes nothing.

// Type-only, so it is erased at compile time and does not turn the deliberate dynamic
// `import('./nest-health')` below into a static cycle.
import type { NestHealth } from './nest-health';

const NUTHATCH_URL = process.env.NUTHATCH_URL?.replace(/\/$/, '');
const NUTHATCH_USER = process.env.NUTHATCH_USER;
const NUTHATCH_PASSWORD = process.env.NUTHATCH_PASSWORD;

/** Whether a nuthatch base URL is configured at all. */
export function hasNuthatch(): boolean {
  return Boolean(NUTHATCH_URL);
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
  // Built on `nuthatchSqlFull` rather than its own `fetch`, which is how it used to be. A second
  // copy of the request was a second way to reach the nest, and it went round the concurrency gate
  // and the request timeout that the copy below has. Two crons issuing two reads apiece at the top
  // of the same minute is exactly the collision that gate exists for.
  const result = await nuthatchSqlFull<T>(sql, basePath);
  if (!result.ok) {
    throw new Error(`nuthatch /sql error: ${result.error}`);
  }
  return result.data.rows ?? [];
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
 * A nest's `/sql` surface caps concurrent queries, and this is the gate that keeps us under it.
 *
 * The cap is real, and it is the node protecting itself (nuthatch RFC-0013), so the answer is
 * always to ask for less rather than to raise it.
 *
 * This lives here rather than at the call sites because the call sites cannot be trusted to
 * remember, and the evidence is that they did not. `/api/dips/agreements` fired nine reads in one
 * `Promise.all` and had therefore never once worked against a nest with rows - seven refusals, and
 * the route returned one of them. With the gate here, a `Promise.all` at a call site is correct
 * again and nobody has to know this.
 *
 * **Two slots, not one.** One was sized against a nest admitting **two** concurrent queries, measured
 * on 2026-09-02; the allocations nest that serves the dashboard has admitted **four** since
 * 2026-09-06, and one slot now costs more than it protects. `/api/indexer/[address]` composes six
 * statements in a `Promise.all` and had them run one after another: measured against the production
 * nest, the page is 7.1 s serialised and 4.6 s at two, and does not improve past that because one
 * statement dominates. Two leaves half the nest's budget for everything else that draws on it - the
 * public SQL playground, `check-nest-health`, and every other Vercel instance - so our own
 * composition still cannot be the sole cause of a refusal, and the retry below covers the case where
 * several instances arrive together.
 *
 * Raising this again is a decision about a *measured* nest cap, not a guess: check
 * `NUTHATCH_SQL_MAX_CONCURRENCY` on the nest first, and leave headroom for the other callers.
 */
export const SQL_SLOTS = 2;

interface SqlGate {
  active: number;
  waiting: (() => void)[];
}

const sqlGates = new Map<string, SqlGate>();

async function withSqlSlot<T>(basePath: string, run: () => Promise<T>): Promise<T> {
  let gate = sqlGates.get(basePath);
  if (!gate) {
    gate = { active: 0, waiting: [] };
    sqlGates.set(basePath, gate);
  }

  if (gate.active >= SQL_SLOTS) {
    await new Promise<void>((resolve) => gate!.waiting.push(resolve));
    // Woken means the slot was handed over, not that it is free to take: see the release below.
  } else {
    gate.active++;
  }

  try {
    return await run();
  } finally {
    // Hand the slot straight to the next waiter rather than releasing and letting it re-check.
    // Releasing first leaves a microtask window: a continuation queued before this `finally` ran
    // sees `active` back below the limit, takes the slot, and then the woken waiter takes it too —
    // two in flight against a gate that promised one.
    //
    // Correct by construction rather than by test, and knowingly so. Mutating this to the
    // release-then-recheck form leaves every test in `nuthatch-sql-slot.test.ts` passing, because
    // reaching that window needs an arrival at one exact microtask depth; a test pinned to that
    // depth would stop testing anything the moment this call path gained an `await`, silently.
    // Handing the slot over removes the window instead of policing it.
    const next = gate.waiting.shift();
    if (next) next();
    else gate.active--;
  }
}

/** How long to wait before each retry of a query the nest refused for being busy. */
const BUSY_BACKOFF_MS = [50, 150, 400];

/**
 * Whether a refusal is the nest telling us to slow down, as opposed to telling us something.
 *
 * Deliberately narrow. A 503 from `/sql` is *usually* not this — an unready or stalled nest is also
 * a 503, and retrying that would sit in a loop while a page waits for an answer that is not coming.
 * Only the concurrency guard's own wording is treated as backpressure.
 */
function isBusy(status: number, error: string): boolean {
  return status === 503 && /too many concurrent/i.test(error);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

  return withSqlSlot(basePath, async () => {
    let last: { ok: false; status: number; error: string } | null = null;

    // One attempt, plus up to three more if the nest says it is busy. Backing off is the correct
    // response to backpressure from a node that is protecting itself; the slot gate above stops us
    // being the cause, and this handles the case where somebody else is.
    for (let attempt = 0; attempt <= BUSY_BACKOFF_MS.length; attempt++) {
      if (attempt > 0) await sleep(BUSY_BACKOFF_MS[attempt - 1]);

      const result = await sqlOnce<T>(sql, basePath, timeoutMs);
      if (result.ok || !isBusy(result.status, result.error)) return result;
      last = result;
    }

    // Still busy after the backoff. Return the nest's own words: "server busy" tells an operator
    // something quite different from "nest is not ready", and flattening the two would cost the
    // next person the diagnosis.
    return last!;
  });
}

/** One `/sql` request, no gate and no retry. Everything above composes this. */
async function sqlOnce<T>(
  sql: string,
  basePath: string,
  timeoutMs: number
): Promise<{ ok: true; data: NuthatchSqlResult<T> } | { ok: false; status: number; error: string }> {
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

/**
 * `/ready` probes currently in flight, keyed by nest.
 *
 * A route that asks one nest two questions in a `Promise.all` (the DIPS panel wants both the
 * allocation and the timeline) would otherwise probe `/ready` twice to answer one request.
 *
 * This shares a probe that is *already running*; it does not cache the verdict. The entry is
 * dropped the moment the probe settles, so a nest that dies between two requests is still
 * caught by the next one. Caching the answer instead would reintroduce exactly the stale-but-
 * confident reads that #1080 was about, only one layer higher up.
 */
const inflightProbes = new Map<string, Promise<NestHealth>>();

function readinessProbe(basePath: string): Promise<NestHealth> {
  const existing = inflightProbes.get(basePath);
  if (existing) return existing;

  const probe = (async () => {
    try {
      const { probeNest } = await import('./nest-health');
      return await probeNest('serve', 'serve', basePath);
    } finally {
      inflightProbes.delete(basePath);
    }
  })();

  inflightProbes.set(basePath, probe);
  return probe;
}

/**
 * Query a nest only if it is ready to answer, and keep the provenance the rows came with.
 *
 * Serving routes must go through this rather than `nuthatchSql`. `nuthatchSql` throws the
 * envelope away and never asks `/ready`, which is how a stalled nest still returned 200 with
 * three-week-old rows (#1080). Alerting crons can keep using `nuthatchSql`; they are not the
 * page the user sees.
 *
 * `requireReady: false` is for archival datasets (`nuthatch serve` with no cursor). Those
 * report stalled forever and are right to; skipping the gate is the documented exception,
 * not a fallback to The Graph.
 */
export async function nuthatchSqlReady<T = Record<string, unknown>>(
  sql: string,
  basePath = '',
  opts: { timeoutMs?: number; requireReady?: boolean } = {},
): Promise<
  | { ok: true; data: NuthatchSqlResult<T> }
  | { ok: false; status: number; error: string; reason?: string }
> {
  const requireReady = opts.requireReady !== false;
  if (requireReady) {
    const health = await readinessProbe(basePath);
    if (!health.ready) {
      return {
        ok: false,
        status: 503,
        error: health.reason ? `nest is not ready: ${health.reason}` : 'nest is not ready',
        reason: health.reason,
      };
    }
  }
  return nuthatchSqlFull<T>(sql, basePath, opts.timeoutMs ?? 15_000);
}
