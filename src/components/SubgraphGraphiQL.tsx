'use client';

import { useMemo } from 'react';
import { GraphiQL } from 'graphiql';
import { createGraphiQLFetcher, type Fetcher } from '@graphiql/toolkit';
import 'graphiql/style.css';

const DEFAULT_QUERY = `{
  _meta {
    block { number hash }
    deployment
  }
}`;

/**
 * Full GraphiQL IDE for a subgraph deployment — schema browser, autocomplete,
 * syntax highlighting, query history. Queries are proxied server-side through
 * /api/subgraph-playground/[hash] so GRAPH_API_KEY is never exposed.
 *
 * Pass `fetcher` to route queries somewhere else — see SubgraphPlaygroundPanel,
 * which substitutes a keyless pay-per-query fetcher.
 *
 * Client-only (relies on browser APIs + localStorage); import via next/dynamic
 * with ssr:false.
 */
export default function SubgraphGraphiQL({
  hash,
  fetcher: override,
}: {
  hash: string;
  fetcher?: Fetcher;
}) {
  const fallback = useMemo(
    () => createGraphiQLFetcher({ url: `/api/subgraph-playground/${hash}` }),
    [hash],
  );
  const fetcher = override ?? fallback;

  return (
    <div className="h-[640px] rounded-[var(--radius-card)] overflow-hidden border border-[var(--border)]">
      <GraphiQL fetcher={fetcher} defaultQuery={DEFAULT_QUERY} />
    </div>
  );
}
