import { NextResponse } from 'next/server';
import { hasNuthatch, nuthatchSqlFull } from '@/lib/nuthatch';
import { findDataset } from '@/lib/sql-datasets';
import { NAMED_QUERIES, findNamedQuery, renderNamedQuery } from '@/lib/named-queries';
import { log } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const QUERY_TIMEOUT_MS = 6_000;

/**
 * The named-query tier: `GET` lists what may be asked, `POST` asks it.
 *
 * The caller sends a **name and typed arguments, never SQL**. That is the difference between this
 * and `/api/sql/query`, and it is the whole point: free-form SQL is an exploring tool, and nuthatch's
 * own RFC-0034 says plainly that the node's guards are "self-protection, not a security boundary" —
 * they bound one query's cost and say nothing about which questions the surface answers at all.
 *
 * Every declared query is pinned to a block, so every answer here is reproducible, which is what
 * makes it worth handing to someone with a `tattler` receipt attached. Two parties can agree on what
 * `delegations_to_indexer(0x…, 497000000)` means; they cannot as easily agree on what somebody's
 * ad-hoc SELECT meant six months ago.
 */
export async function GET() {
  return NextResponse.json({
    queries: NAMED_QUERIES.map((q) => ({
      name: q.name,
      dataset: q.dataset,
      description: q.description,
      params: q.params,
      sql: q.sql,
    })),
  });
}

export async function POST(req: Request) {
  if (!hasNuthatch()) {
    return NextResponse.json({ error: 'SQL surface is not configured.' }, { status: 503 });
  }

  let body: { name?: unknown; args?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const name = typeof body.name === 'string' ? body.name : '';
  const query = findNamedQuery(name);
  if (!query) {
    // Errors-as-prompts, in nuthatch's own style: a refusal that only says "no" leaves an agent
    // guessing, and guessing at an endpoint is how you get a thousand probing requests.
    return NextResponse.json(
      {
        error: `No query named ${name ? `\`${name}\`` : '(none given)'}.`,
        allowed: NAMED_QUERIES.map((q) => q.name),
      },
      { status: 400 }
    );
  }

  const args =
    body.args && typeof body.args === 'object' && !Array.isArray(body.args)
      ? (body.args as Record<string, unknown>)
      : {};

  const rendered = renderNamedQuery(query, args);
  if (!rendered.ok) {
    return NextResponse.json(
      { error: rendered.error, params: query.params },
      { status: 400 }
    );
  }

  const dataset = findDataset(query.dataset);
  if (!dataset) {
    // A declared query naming a dataset nobody exposes is our bug, not the caller's.
    log.api.error({ query: query.name, dataset: query.dataset }, 'named query targets an unknown dataset');
    return NextResponse.json({ error: 'This query is misconfigured.' }, { status: 500 });
  }

  try {
    const result = await nuthatchSqlFull(rendered.sql, dataset.basePath, QUERY_TIMEOUT_MS);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status === 400 ? 400 : 502 }
      );
    }
    return NextResponse.json({
      query: query.name,
      dataset: dataset.id,
      // Returned so the caller can see exactly what was run, and so a receipt over this answer can
      // record the statement rather than only the name. A name is stable; the statement is what the
      // nest actually answered.
      sql: rendered.sql,
      count: result.data.count,
      rows: result.data.rows,
      truncated: Boolean(result.data.truncated),
      degraded: Boolean(result.data.degraded),
      degradedTables: result.data.degraded_tables ?? [],
      provenance: result.data.provenance ?? null,
    });
  } catch (e) {
    const timedOut = e instanceof Error && e.name === 'TimeoutError';
    log.api.warn({ query: query.name, err: e }, 'named query failed');
    return NextResponse.json(
      {
        error: timedOut
          ? 'That took too long. Try an earlier before_block.'
          : 'The dataset is not answering right now.',
      },
      { status: timedOut ? 504 : 502 }
    );
  }
}
