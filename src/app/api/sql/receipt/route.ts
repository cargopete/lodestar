import { NextResponse } from 'next/server';
import { hasNuthatch, nuthatchSqlFull } from '@/lib/nuthatch';
import { findDataset } from '@/lib/sql-datasets';
import { NAMED_QUERIES, findNamedQuery, renderNamedQuery } from '@/lib/named-queries';
import { log } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const QUERY_TIMEOUT_MS = 6_000;

/**
 * Run a declared query and hand back a **signed receipt** for the answer.
 *
 * The counterpart to `/verify`, which checks one. A reader can now take an answer away in a form
 * somebody else can check without trusting either of us, without installing anything.
 *
 * ## Signing happens here, and the crypto is the same compiled Rust the CLI uses
 *
 * Not a TypeScript reimplementation. Issuing and verifying a receipt must share one canonical
 * encoding or neither is worth anything: two implementations are two sets of decisions about key
 * ordering, integer formatting and length prefixes, and the day they disagree a verifier reports a
 * forgery that never happened. `public/tattler` is that one implementation, compiled to WebAssembly,
 * and this route calls into it.
 *
 * ## What a receipt from us is worth, said plainly
 *
 * It is signed by Lodestar, so it is worth exactly what Lodestar is worth — which is not nothing and
 * is not much. The thing that makes a receipt evidence is **replay**: anyone with a nest of the same
 * data can re-run the named question and compare hashes, and agreement between parties who did not
 * coordinate is the only part a signature cannot fake. So the response says so, and `/sql` also
 * prints the `tattler attest-named` command for a reader who would rather sign it themselves.
 *
 * ## Named queries only
 *
 * A receipt over arbitrary SQL attests to an answer nobody can agree on the question for. A declared
 * query is pinned to a block and means the same thing to both parties next year, which is the whole
 * reason the named tier exists.
 */

interface WasmSigner {
  issue_receipt: (bodyJson: string, rowsJson: string, keyHex: string) => string;
}

let wasm: WasmSigner | null = null;

/**
 * Loaded through a constructed `require` so the bundler leaves it alone.
 *
 * `public/tattler/` is a build output of a Rust crate, not a module of this project, and Turbopack
 * tries to resolve and bundle it if it can see the path - which fails, because the glue reads its
 * `.wasm` sibling off disk at runtime. Bundling it would also mean a second copy that can drift
 * from the one `/verify` serves, and one implementation is the entire argument for compiling this
 * rather than rewriting it.
 */
async function signer(): Promise<WasmSigner> {
  if (!wasm) {
    // Two separate evasions, and both are needed. `createRequire` supplies a real CJS `require` in
    // an ESM server bundle, which has none - a bare `new Function('return require(p)')` throws
    // `require is not defined`. And the call is made through a constructed function so the bundler
    // never sees a `require(<path>)` to resolve, which it otherwise tries and fails at build time.
    const { createRequire } = await import('node:module');
    const req = createRequire(import.meta.url);
    const load = new Function('req', 'p', 'return req(p)') as (r: unknown, p: string) => WasmSigner;
    wasm = load(req, `${process.cwd()}/public/tattler/tattler_wasm_node.cjs`);
  }
  return wasm;
}

export async function POST(req: Request) {
  const keyHex = process.env.TATTLER_ISSUER_KEY;
  if (!keyHex) {
    return NextResponse.json(
      { error: 'This deployment does not issue receipts. Use `tattler attest-named` with your own key.' },
      { status: 503 }
    );
  }
  if (!hasNuthatch()) {
    return NextResponse.json({ error: 'SQL surface is not configured.' }, { status: 503 });
  }

  let body: { name?: unknown; args?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const query = findNamedQuery(typeof body.name === 'string' ? body.name : '');
  if (!query) {
    return NextResponse.json(
      { error: 'Receipts are issued for declared queries only.', allowed: NAMED_QUERIES.map((q) => q.name) },
      { status: 400 }
    );
  }

  const args =
    body.args && typeof body.args === 'object' && !Array.isArray(body.args)
      ? (body.args as Record<string, unknown>)
      : {};
  const rendered = renderNamedQuery(query, args);
  if (!rendered.ok) {
    return NextResponse.json({ error: rendered.error, params: query.params }, { status: 400 });
  }

  const dataset = findDataset(query.dataset);
  if (!dataset) {
    log.api.error({ query: query.name }, 'named query targets an unknown dataset');
    return NextResponse.json({ error: 'This query is misconfigured.' }, { status: 500 });
  }

  try {
    const result = await nuthatchSqlFull(rendered.sql, dataset.basePath, QUERY_TIMEOUT_MS);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status === 400 ? 400 : 502 });
    }
    // A truncated or degraded answer is not the answer. Signing one would put our name on a partial
    // result presented as complete, which is the single thing a receipt must never do.
    if (result.data.truncated || result.data.degraded) {
      return NextResponse.json(
        { error: 'The answer was truncated or incomplete, so it will not be signed. Narrow the query.' },
        { status: 409 }
      );
    }

    const sealed = result.data.provenance?.sealed_through;
    if (sealed == null) {
      return NextResponse.json(
        { error: 'The dataset reported no sealed_through, so reproducibility cannot be established.' },
        { status: 502 }
      );
    }

    const asOf = Number(args.before_block);
    if (!Number.isFinite(asOf)) {
      return NextResponse.json({ error: 'This query has no `before_block` to pin the answer to.' }, { status: 400 });
    }

    const rows = result.data.rows;
    const w = await signer();
    const hashOut = JSON.parse(
      (w as unknown as { result_hash: (s: string) => string }).result_hash(JSON.stringify(rows))
    ) as { ok: boolean; detail?: string };
    if (!hashOut.ok || !hashOut.detail) {
      return NextResponse.json({ error: hashOut.detail ?? 'could not hash the answer' }, { status: 500 });
    }

    const receiptBody = {
      nid: result.data.provenance?.nid ?? null,
      dataset: dataset.id,
      query: rendered.sql,
      as_of_block: asOf,
      sealed_through: sealed,
      registry_hash: result.data.provenance?.registry_hash ?? null,
      result_hash: hashOut.detail,
      row_count: rows.length,
      issued_at: new Date().toISOString(),
      query_name: query.name,
      query_args: Object.fromEntries(
        Object.entries(args)
          .map(([k, v]) => [k, String(v)])
          .sort(([a], [b]) => a.localeCompare(b))
      ),
    };

    const signed = w.issue_receipt(JSON.stringify(receiptBody), JSON.stringify(rows), keyHex);
    const parsed = JSON.parse(signed);
    if (parsed.ok === false) {
      log.api.error({ query: query.name, detail: parsed.detail }, 'receipt refused');
      return NextResponse.json({ error: parsed.detail ?? 'the receipt was refused' }, { status: 500 });
    }

    return NextResponse.json(parsed);
  } catch (e) {
    log.api.warn({ query: query.name, err: e }, 'receipt issue failed');
    return NextResponse.json({ error: 'Could not issue a receipt right now.' }, { status: 502 });
  }
}
