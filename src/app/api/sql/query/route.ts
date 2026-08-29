import { NextResponse } from 'next/server';
import { hasNuthatch, nuthatchSqlFull } from '@/lib/nuthatch';
import { findDataset } from '@/lib/sql-datasets';
import { isReadOnlySql } from '@/lib/sql-guard';
import { log } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * Below the nest's own timeout, so a slow query fails here with a clear message rather than there.
 *
 * Six seconds rather than something generous, because this is the harder of the two limits on what
 * a stranger can spend of the Helsinki box's CPU: the per-IP rate limit is per edge instance and so
 * is a soft ceiling, while this bounds every single call. A query that cannot answer in six seconds
 * against a nest holding four tables is a query that wants a WHERE clause, and one against the
 * 56-table DIPS nest is better asked of your own nest.
 */
const QUERY_TIMEOUT_MS = 6_000;

/**
 * Run one read-only query against one of the datasets in `SQL_DATASETS`.
 *
 * **Where the security actually is, and it is not here.** The nest opens DuckDB with
 * `enable_external_access=false`, an `allowed_directories` restriction and `lock_configuration=true`
 * so a query cannot widen its own access mid-flight; it applies a function allowlist as well as a
 * denylist, strips comments before matching, and refuses unknown table references. It was built to
 * face the public (nuthatch RFC-0013/0034) and it carries tests named for the evasions.
 * `isReadOnlySql` here is a cheap first pass so obvious nonsense never crosses the network. It is
 * not the boundary, and where the two disagree the nest wins.
 *
 * Rate limiting is in `middleware.ts`, where every other route's is.
 */
export async function POST(req: Request) {
  if (!hasNuthatch()) {
    return NextResponse.json({ error: 'SQL surface is not configured.' }, { status: 503 });
  }

  let body: { dataset?: unknown; q?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const datasetId = typeof body.dataset === 'string' ? body.dataset : '';
  const dataset = findDataset(datasetId);
  if (!dataset) {
    return NextResponse.json(
      { error: `Unknown dataset: ${datasetId || '(none given)'}.` },
      { status: 400 }
    );
  }

  const q = typeof body.q === 'string' ? body.q : '';
  const verdict = isReadOnlySql(q);
  if (!verdict.ok) {
    return NextResponse.json({ error: verdict.reason }, { status: 400 });
  }

  try {
    const result = await nuthatchSqlFull(q, dataset.basePath, QUERY_TIMEOUT_MS);
    if (!result.ok) {
      // The nest sanitises its own SQL errors before returning them, so relaying the text is safe
      // and is the difference between "query failed" and "no such column: tokns".
      return NextResponse.json(
        { error: result.error },
        { status: result.status === 400 ? 400 : 502 }
      );
    }
    return NextResponse.json({
      dataset: dataset.id,
      count: result.data.count,
      rows: result.data.rows,
      truncated: Boolean(result.data.truncated),
      degraded: Boolean(result.data.degraded),
      degradedTables: result.data.degraded_tables ?? [],
      tipUnavailable: Boolean(result.data.tip_unavailable),
      provenance: result.data.provenance ?? null,
    });
  } catch (e) {
    const timedOut = e instanceof Error && e.name === 'TimeoutError';
    log.api.warn({ dataset: dataset.id, err: e }, 'sql query failed');
    return NextResponse.json(
      {
        error: timedOut
          ? 'Query took too long. Narrow it with a WHERE clause or a smaller LIMIT.'
          : 'The dataset is not answering right now.',
      },
      { status: timedOut ? 504 : 502 }
    );
  }
}
