'use client';

import { use, useEffect, useState, Suspense } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  useIndexingStatus,
  useManifestAnalysis,
  useNetworksRegistry,
  useSubgraphCuration,
  useSubgraphHistory,
  useSubgraphVersions,
  useENSName,
  useSubgraphSchema,
} from '@/hooks/useNetworkStats';
import { SubgraphHistoryChart } from '@/components/charts/SubgraphHistoryChart';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { StatCard, StatGrid } from '@/components/ui/StatCard';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { cn, formatNumber, formatGRT, weiToGRT, shortenAddress } from '@/lib/utils';
import { VersionsTable } from '@/components/subgraph/VersionsTable';
import { ActivitySection } from '@/components/subgraph/ActivitySection';
import type { IndexerStatusResult } from '@/lib/indexing-status';
import type { ComplexityCategory, DataSourceSignal, TemplateSignal } from '@/lib/manifest';
import type { NetworkInfo } from '@/app/api/networks/route';

// ---------------------------------------------------------------------------
// Tab configuration
// ---------------------------------------------------------------------------

type Tab = 'overview' | 'schema' | 'curators' | 'history' | 'versions' | 'activity' | 'manifest' | 'playground';
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'schema', label: 'Schema' },
  { id: 'curators', label: 'Curators' },
  { id: 'history', label: 'History' },
  { id: 'versions', label: 'Versions' },
  { id: 'activity', label: 'Activity' },
  { id: 'manifest', label: 'Manifest' },
  { id: 'playground', label: 'Playground' },
];

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

const STATUS_CONFIG = {
  synced: { label: 'Synced', variant: 'success' as const, dot: 'bg-[var(--green)]' },
  syncing: { label: 'Syncing', variant: 'warning' as const, dot: 'bg-[var(--amber)]' },
  failed: { label: 'Failed', variant: 'error' as const, dot: 'bg-[var(--red)]' },
  unreachable: { label: 'Unreachable', variant: 'default' as const, dot: 'bg-[var(--text-faint)]' },
};

const CATEGORY_VARIANT: Record<ComplexityCategory, 'success' | 'default' | 'warning' | 'error'> = {
  Light: 'success',
  Moderate: 'default',
  Heavy: 'warning',
  Extreme: 'error',
};

const SCORE_BAR_VARIANT: Record<string, 'accent' | 'teal' | 'orange'> = {
  low: 'teal',
  mid: 'accent',
  high: 'orange',
};

function scoreVariant(score: number, max: number): 'accent' | 'teal' | 'orange' {
  const pct = max > 0 ? score / max : 0;
  if (pct < 0.4) return SCORE_BAR_VARIANT.low;
  if (pct < 0.7) return SCORE_BAR_VARIANT.mid;
  return SCORE_BAR_VARIANT.high;
}

// ---------------------------------------------------------------------------
// Small helper components
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: IndexerStatusResult['status'] }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <Badge variant={cfg.variant}>
      <span className={cn('w-1.5 h-1.5 rounded-full inline-block mr-1', cfg.dot)} />
      {cfg.label}
    </Badge>
  );
}

function IndexerNameDisplay({ indexerId, indexerName }: { indexerId: string; indexerName: string | null }) {
  const { data } = useENSName(indexerName ? '' : indexerId);
  return <>{indexerName ?? data?.ensName ?? shortenAddress(indexerId)}</>;
}

function HandlerCounts({ source }: { source: DataSourceSignal | TemplateSignal }) {
  return (
    <div className="flex gap-2">
      {source.eventHandlers > 0 && (
        <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-[var(--bg-elevated)] text-[var(--text-muted)]">
          {source.eventHandlers} event
        </span>
      )}
      {source.callHandlers > 0 && (
        <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-[var(--amber-dim)] text-[var(--amber)]">
          {source.callHandlers} call
        </span>
      )}
      {source.blockHandlers > 0 && (
        <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-[var(--red-dim)] text-[var(--red)]">
          {source.blockHandlers} block
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Schema tab — GraphQL type explorer
// ---------------------------------------------------------------------------

interface ParsedField {
  name: string;
  type: string;
  directives: string;
}

interface ParsedType {
  kind: string;
  name: string;
  implements: string[];
  directives: string;
  fields: ParsedField[];
  enumValues: string[];
}

function parseGraphQLSchema(sdl: string): ParsedType[] {
  const types: ParsedType[] = [];

  // Strip descriptions and comments for parsing
  const s = sdl
    .replace(/"""[\s\S]*?"""/g, '')
    .replace(/"[^"]*"/g, '')
    .replace(/#[^\n]*/g, '');

  const blockRe = /\b(type|interface|input|enum|scalar)\s+(\w+)((?:[^{])*)\{([^}]*)\}/g;
  let m: RegExpExecArray | null;

  while ((m = blockRe.exec(s)) !== null) {
    const [, kind, name, header, body] = m;

    const implMatch = header.match(/implements\s+([\w\s&]+)/);
    const implements_ = implMatch
      ? implMatch[1].split('&').map((x) => x.trim()).filter(Boolean)
      : [];

    const directivePart = header
      .replace(/implements[\w\s&]+/, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (kind === 'scalar') {
      types.push({ kind, name, implements: [], directives: directivePart, fields: [], enumValues: [] });
      continue;
    }

    if (kind === 'enum') {
      const values = body
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && /^\w/.test(l));
      types.push({ kind, name, implements: [], directives: directivePart, fields: [], enumValues: values });
      continue;
    }

    const fields: ParsedField[] = [];
    const fieldRe = /^\s*(\w+)\s*(?:\([^)]*\))?\s*:\s*([\w\[\]!]+)\s*(@[^\n]*)?/gm;
    let fm: RegExpExecArray | null;
    while ((fm = fieldRe.exec(body)) !== null) {
      fields.push({ name: fm[1], type: fm[2], directives: (fm[3] ?? '').trim() });
    }

    types.push({ kind, name, implements: implements_, directives: directivePart, fields, enumValues: [] });
  }

  return types;
}

// Scalar names that are built-in / Graph primitives — rendered in a muted colour
const PRIMITIVE_TYPES = new Set([
  'ID', 'String', 'Int', 'Float', 'Boolean',
  'BigInt', 'BigDecimal', 'Bytes', 'Int8', 'Timestamp',
]);

function FieldTypePill({ type, typeNames }: { type: string; typeNames: Set<string> }) {
  // Strip wrapping [] and !
  const base = type.replace(/[\[\]!]/g, '');
  const isPrimitive = PRIMITIVE_TYPES.has(base);
  const isEntity = typeNames.has(base) && !isPrimitive;
  const isArray = type.includes('[');
  const isRequired = type.endsWith('!');

  return (
    <span className="flex items-center gap-0.5">
      {isArray && <span className="text-[var(--text-faint)] text-[10px]">[</span>}
      <span className={cn(
        'font-mono text-xs',
        isPrimitive ? 'text-[var(--text-muted)]' : isEntity ? 'text-[var(--accent)]' : 'text-[var(--text)]',
      )}>
        {base}
      </span>
      {isArray && <span className="text-[var(--text-faint)] text-[10px]">]</span>}
      {isRequired && <span className="text-[var(--red)] text-[10px] font-bold">!</span>}
    </span>
  );
}

function DirectiveBadge({ directive }: { directive: string }) {
  const isDerivedFrom = directive.includes('derivedFrom');
  const isEntity = directive.includes('@entity');
  return (
    <span className={cn(
      'text-[10px] font-mono px-1.5 py-0.5 rounded',
      isDerivedFrom
        ? 'bg-[var(--accent)]/10 text-[var(--accent)]'
        : isEntity
          ? 'bg-[var(--green-dim)] text-[var(--green)]'
          : 'bg-[var(--bg-elevated)] text-[var(--text-faint)]',
    )}>
      {directive}
    </span>
  );
}

const KIND_BADGE: Record<string, string> = {
  type: 'bg-[var(--accent)]/15 text-[var(--accent)]',
  interface: 'bg-[var(--amber-dim)] text-[var(--amber)]',
  input: 'bg-[var(--bg-elevated)] text-[var(--text-muted)]',
  enum: 'bg-[var(--green-dim)] text-[var(--green)]',
  scalar: 'bg-[var(--red-dim)] text-[var(--red)]',
};

function SchemaTypeCard({ type, typeNames }: { type: ParsedType; typeNames: Set<string> }) {
  return (
    <div className="border border-[var(--border)] rounded-[var(--radius-card)] bg-[var(--bg-surface)] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 bg-[var(--bg-elevated)] border-b border-[var(--border)]">
        <span className={cn('text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded', KIND_BADGE[type.kind] ?? KIND_BADGE.type)}>
          {type.kind}
        </span>
        <span className="text-sm font-semibold text-[var(--text)] font-mono">{type.name}</span>
        {type.implements.length > 0 && (
          <span className="text-xs text-[var(--text-faint)]">
            implements {type.implements.join(', ')}
          </span>
        )}
        {type.directives && type.directives.split(/\s+(?=@)/).filter(Boolean).map((d, i) => (
          <DirectiveBadge key={i} directive={d} />
        ))}
        {type.fields.length > 0 && (
          <span className="ml-auto text-[10px] font-mono text-[var(--text-faint)]">
            {type.fields.length} field{type.fields.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Enum values */}
      {type.kind === 'enum' && type.enumValues.length > 0 && (
        <div className="px-4 py-2 flex flex-wrap gap-2">
          {type.enumValues.map((v) => (
            <span key={v} className="text-xs font-mono px-2 py-0.5 rounded bg-[var(--bg-elevated)] text-[var(--text-muted)]">
              {v}
            </span>
          ))}
        </div>
      )}

      {/* Scalar */}
      {type.kind === 'scalar' && (
        <div className="px-4 py-2">
          <span className="text-xs text-[var(--text-faint)]">Custom scalar type</span>
        </div>
      )}

      {/* Fields */}
      {type.fields.length > 0 && (
        <div className="divide-y divide-[var(--border)]/50">
          {type.fields.map((field) => (
            <div key={field.name} className="flex items-center gap-3 px-4 py-2 hover:bg-[var(--bg-elevated)] transition-colors">
              <span className="text-sm font-mono text-[var(--text)] min-w-[120px] shrink-0">{field.name}</span>
              <FieldTypePill type={field.type} typeNames={typeNames} />
              {field.directives && (
                <div className="ml-auto flex flex-wrap gap-1">
                  {field.directives.split(/\s+(?=@)/).filter(Boolean).map((d, i) => (
                    <DirectiveBadge key={i} directive={d} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SchemaTab({ hash }: { hash: string }) {
  const { data, isLoading, error } = useSubgraphSchema(hash);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
        <span className="ml-3 text-sm text-[var(--text-muted)]">Fetching schema from IPFS…</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardContent>
          <p className="text-sm text-[var(--text-muted)] py-8 text-center">
            Schema not available — the manifest may not include an IPFS-pinned schema reference.
          </p>
        </CardContent>
      </Card>
    );
  }

  const types = parseGraphQLSchema(data.schemaText);
  // Group: entities first, then interfaces, enums, inputs, scalars
  const order: ParsedType['kind'][] = ['type', 'interface', 'enum', 'input', 'scalar'];
  const sorted = [...types].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  const typeNames = new Set(types.map((t) => t.name));

  const entityCount = types.filter((t) => t.kind === 'type').length;
  const enumCount = types.filter((t) => t.kind === 'enum').length;
  const totalFields = types.reduce((s, t) => s + t.fields.length, 0);

  return (
    <div className="space-y-6">
      {/* Stats */}
      <StatGrid className="lg:grid-cols-4 xl:grid-cols-4">
        <StatCard label="Entity Types" value={String(entityCount)} />
        <StatCard label="Total Fields" value={String(totalFields)} />
        <StatCard label="Enums" value={String(enumCount)} />
        <StatCard
          label="Schema Hash"
          value={data.schemaHash.slice(0, 10) + '…'}
          subtitle={data.schemaHash}
        />
      </StatGrid>

      {/* Type cards */}
      <div className="space-y-3">
        {sorted.map((type) => (
          <SchemaTypeCard key={type.name} type={type} typeNames={typeNames} />
        ))}
        {types.length === 0 && (
          <p className="text-sm text-[var(--text-muted)] text-center py-8">
            No type definitions found in schema.
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Indexing Health Section (Overview tab)
// ---------------------------------------------------------------------------

function IndexingHealthSection({ hash }: { hash: string }) {
  const { data, isLoading, error } = useIndexingStatus(hash);
  const { data: curationData } = useSubgraphCuration(hash);
  const queryFeesGRT = weiToGRT(curationData?.queryFeesAmount ?? '0');

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Indexing Health</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
            <span className="ml-3 text-sm text-[var(--text-muted)]">Querying indexer status endpoints…</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Indexing Health</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="py-4 space-y-2">
            <p className="text-sm text-[var(--text-muted)]">
              {error instanceof Error && error.message.includes('404')
                ? 'No active allocations found for this deployment.'
                : 'Unable to fetch indexing status. The deployment may not have active allocations.'}
            </p>
            <p className="text-sm text-[var(--text-muted)]">
              Signal GRT to this subgraph to get Indexers to pick it up and start allocating to it.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const syncingCount = data.totalIndexers - data.syncedCount - data.failedCount - data.unreachableCount;

  const servability = data.servability;

  return (
    <>
      {servability?.effectivelyDead ? (
        <Card className="border-[var(--red-dim)]">
          <div className="flex items-start gap-2">
            <span aria-hidden>⛔</span>
            <div>
              <p className="text-sm font-semibold text-[var(--red)]">
                {servability.recovering ? 'Effectively dead — rescue in flight' : 'Effectively dead'}
              </p>
              <p className="text-[13px] text-[var(--text-muted)] mt-0.5">
                All allocated stake belongs to operators with no working serving path; queries will fail despite any
                reported sync.{servability.recovering ? ' A syncing indexer is catching up.' : ''}
              </p>
            </div>
          </div>
        </Card>
      ) : servability && servability.dominantOperatorShare >= 0.66 ? (
        <Card className="border-[var(--amber)]">
          <p className="text-[13px] text-[var(--amber)]">
            ⚠ Fragile redundancy — {Math.round(servability.dominantOperatorShare * 100)}% of allocated stake sits with a
            single operator. The gateway sees several indexers of headroom, but they share one fate.
          </p>
        </Card>
      ) : null}

      <StatGrid className="lg:grid-cols-5 xl:grid-cols-5">
        <StatCard label="Active Indexers" value={String(data.totalAllocations)} subtitle={`${data.totalIndexers} unique`} />
        <StatCard
          label="Synced"
          value={String(data.syncedCount)}
          delta={data.syncedCount > 0
            ? { value: `${Math.round((data.syncedCount / data.totalIndexers) * 100)}%`, positive: true }
            : undefined}
        />
        <StatCard label="Syncing" value={String(syncingCount)} delta={syncingCount > 0 ? { value: 'In progress', positive: true } : undefined} />
        <StatCard label="Failed" value={String(data.failedCount)} delta={data.failedCount > 0 ? { value: 'Needs attention', positive: false } : undefined} />
        <StatCard label="Unreachable" value={String(data.unreachableCount)} subtitle={data.unreachableCount > 0 ? 'No URL or timeout' : 'All responding'} />
      </StatGrid>

      <StatGrid className="lg:grid-cols-3 xl:grid-cols-3">
        <StatCard label="Signal" value={formatGRT(weiToGRT(data.signalledTokens))} subtitle="GRT signalled" />
        <StatCard label="Stake" value={formatGRT(weiToGRT(data.stakedTokens))} subtitle="GRT staked" />
        <StatCard label="Query Fees" value={queryFeesGRT > 0 ? `${formatGRT(queryFeesGRT)} GRT` : '—'} subtitle="Lifetime fees collected" />
      </StatGrid>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Indexer Status</CardTitle>
            <span className="text-xs text-[var(--text-faint)]">Refreshes every 30s</span>
          </div>
        </CardHeader>
        <CardContent>
          {data.indexers.length === 0 ? (
            <div className="py-4 space-y-2">
              <p className="text-sm text-[var(--text-muted)]">No indexers have active allocations on this deployment.</p>
              <p className="text-sm text-[var(--text-muted)]">
                Signal GRT to this subgraph to get Indexers to pick it up and start allocating to it.
              </p>
            </div>
          ) : (
            <>
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[var(--border)]">
                      <th className="px-4 py-2 text-left text-[11px] font-medium text-[var(--text-muted)]">Indexer</th>
                      <th className="px-4 py-2 text-left text-[11px] font-medium text-[var(--text-muted)]">Status</th>
                      <th className="px-4 py-2 text-left text-[11px] font-medium text-[var(--text-muted)]">Sync Progress</th>
                      <th className="px-4 py-2 text-right text-[11px] font-medium text-[var(--text-muted)]">Blocks Behind</th>
                      <th className="px-4 py-2 text-right text-[11px] font-medium text-[var(--text-muted)]">Entities</th>
                      <th className="px-4 py-2 text-right text-[11px] font-medium text-[var(--text-muted)]">Stake</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {data.indexers.map((indexer) => (
                      <tr key={indexer.indexerId} className="hover:bg-[var(--bg-elevated)] transition-colors">
                        <td className="px-4 py-3">
                          <Link href={`/indexers/${indexer.indexerId}`} className="hover:text-[var(--accent)] transition-colors">
                            <p className="font-medium text-[var(--text)] text-sm">
                              <IndexerNameDisplay indexerId={indexer.indexerId} indexerName={indexer.indexerName} />
                            </p>
                          </Link>
                          <p className="text-[10px] text-[var(--text-faint)] font-mono">{shortenAddress(indexer.indexerId, 6)}</p>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <StatusBadge status={indexer.status} />
                            {(indexer.nonFatalErrorCount ?? 0) > 0 && !indexer.fatalError && (
                              <span className="text-[10px] font-mono text-[var(--amber)]" title={`${indexer.nonFatalErrorCount} non-fatal errors`}>
                                {indexer.nonFatalErrorCount} err
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {indexer.syncProgress !== undefined ? (
                            <div className="min-w-[140px]">
                              <ProgressBar
                                value={indexer.syncProgress}
                                max={100}
                                size="sm"
                                variant={indexer.status === 'failed' ? 'orange' : indexer.syncProgress >= 99.9 ? 'teal' : 'accent'}
                              />
                              <div className="flex justify-between mt-1">
                                <span className="text-[10px] font-mono text-[var(--text-faint)]">{formatNumber(indexer.latestBlock ?? 0)}</span>
                                <span className="text-[10px] font-mono text-[var(--text-faint)]">{indexer.syncProgress.toFixed(2)}%</span>
                              </div>
                            </div>
                          ) : (
                            <span className="text-xs text-[var(--text-faint)]">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {indexer.blocksBehind !== undefined ? (
                            <span className={cn(
                              'text-sm font-mono',
                              indexer.blocksBehind === 0 ? 'text-[var(--green)]' : indexer.blocksBehind < 100 ? 'text-[var(--amber)]' : 'text-[var(--red)]',
                            )}>
                              {indexer.blocksBehind === 0 ? 'Caught up' : formatNumber(indexer.blocksBehind)}
                            </span>
                          ) : (
                            <span className="text-xs text-[var(--text-faint)]">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {indexer.entityCount ? (
                            <span className="text-sm font-mono text-[var(--text)]">{formatNumber(Number(indexer.entityCount))}</span>
                          ) : (
                            <span className="text-xs text-[var(--text-faint)]">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-sm font-mono text-[var(--text)]">{formatGRT(weiToGRT(indexer.allocatedTokens))}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Error log */}
              {data.indexers.some((i) => i.fatalError || (i.nonFatalErrors?.length ?? 0) > 0) && (
                <div className="mt-4 space-y-3">
                  <h4 className="text-[11px] font-medium text-[var(--text-muted)] tracking-wide">Errors &amp; Warnings</h4>
                  {data.indexers
                    .filter((i) => i.fatalError || (i.nonFatalErrors?.length ?? 0) > 0)
                    .map((indexer) => (
                      <div
                        key={`err-${indexer.indexerId}`}
                        className={cn(
                          'p-3 rounded-lg border',
                          indexer.fatalError
                            ? 'border-[var(--red)] border-opacity-20 bg-[var(--red-dim)]'
                            : 'border-[var(--amber)] border-opacity-20 bg-[var(--amber-dim)]',
                        )}
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <Link href={`/indexers/${indexer.indexerId}`} className="text-xs font-medium text-[var(--text)] hover:text-[var(--accent)] transition-colors">
                            <IndexerNameDisplay indexerId={indexer.indexerId} indexerName={indexer.indexerName} />
                          </Link>
                          <StatusBadge status={indexer.status} />
                        </div>
                        {indexer.fatalError && (
                          <p className="text-xs text-[var(--text-muted)] font-mono break-all leading-relaxed">{indexer.fatalError.message}</p>
                        )}
                        {indexer.nonFatalErrors && indexer.nonFatalErrors.map((msg, i) => (
                          <p key={i} className="text-xs text-[var(--text-muted)] font-mono break-all leading-relaxed pl-2 border-l-2 border-[var(--amber)] border-opacity-30">{msg}</p>
                        ))}
                      </div>
                    ))}
                </div>
              )}

              {/* Mobile cards */}
              <div className="md:hidden space-y-3">
                {data.indexers.map((indexer) => (
                  <div key={`m-${indexer.indexerId}`} className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)]">
                    <div className="flex items-start justify-between mb-3">
                      <Link href={`/indexers/${indexer.indexerId}`} className="hover:text-[var(--accent)] transition-colors">
                        <p className="font-medium text-sm text-[var(--text)]"><IndexerNameDisplay indexerId={indexer.indexerId} indexerName={indexer.indexerName} /></p>
                        <p className="text-[10px] text-[var(--text-faint)] font-mono">{shortenAddress(indexer.indexerId, 6)}</p>
                      </Link>
                      <StatusBadge status={indexer.status} />
                    </div>
                    {indexer.syncProgress !== undefined && (
                      <div className="mb-3">
                        <ProgressBar value={indexer.syncProgress} max={100} size="sm" variant={indexer.status === 'failed' ? 'orange' : indexer.syncProgress >= 99.9 ? 'teal' : 'accent'} />
                        <div className="flex justify-between mt-1">
                          <span className="text-[10px] font-mono text-[var(--text-faint)]">Block {formatNumber(indexer.latestBlock ?? 0)}</span>
                          <span className="text-[10px] font-mono text-[var(--text-faint)]">{indexer.syncProgress.toFixed(2)}%</span>
                        </div>
                      </div>
                    )}
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="p-1.5 rounded bg-[var(--bg-surface)]">
                        <p className="text-[10px] text-[var(--text-faint)]">Behind</p>
                        <p className={cn('text-xs font-mono', indexer.blocksBehind === 0 ? 'text-[var(--green)]' : (indexer.blocksBehind ?? 0) < 100 ? 'text-[var(--amber)]' : 'text-[var(--text)]')}>
                          {indexer.blocksBehind !== undefined ? formatNumber(indexer.blocksBehind) : '—'}
                        </p>
                      </div>
                      <div className="p-1.5 rounded bg-[var(--bg-surface)]">
                        <p className="text-[10px] text-[var(--text-faint)]">Entities</p>
                        <p className="text-xs font-mono text-[var(--text)]">{indexer.entityCount ? formatNumber(Number(indexer.entityCount)) : '—'}</p>
                      </div>
                      <div className="p-1.5 rounded bg-[var(--bg-surface)]">
                        <p className="text-[10px] text-[var(--text-faint)]">Stake</p>
                        <p className="text-xs font-mono text-[var(--text)]">{formatGRT(weiToGRT(indexer.allocatedTokens))}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Curators tab
// ---------------------------------------------------------------------------

function formatEpoch(epoch: number): string {
  return epoch > 0 ? `Epoch ${epoch}` : '—';
}

function CurationSection({ hash }: { hash: string }) {
  const { data, isLoading, error } = useSubgraphCuration(hash);

  if (isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle>Curation</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-center py-8">
            <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
            <span className="ml-3 text-sm text-[var(--text-muted)]">Loading curator data…</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardHeader><CardTitle>Curation</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-[var(--text-muted)] py-4">Unable to load curation data.</p>
        </CardContent>
      </Card>
    );
  }

  const { signals } = data;
  const activeCurators = signals.filter((s) => BigInt(s.signal) > 0n);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Curation</CardTitle>
          <span className="text-xs text-[var(--text-faint)]">{activeCurators.length} active curator{activeCurators.length !== 1 ? 's' : ''}</span>
        </div>
      </CardHeader>
      <CardContent>
        {signals.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)] py-4">No curator signals found for this deployment.</p>
        ) : (
          <>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th className="px-4 py-2 text-left text-[11px] font-medium text-[var(--text-muted)]">Curator</th>
                    <th className="px-4 py-2 text-right text-[11px] font-medium text-[var(--text-muted)]">Signalled</th>
                    <th className="px-4 py-2 text-right text-[11px] font-medium text-[var(--text-muted)]">Withdrawn</th>
                    <th className="px-4 py-2 text-right text-[11px] font-medium text-[var(--text-muted)]">Realized</th>
                    <th className="px-4 py-2 text-right text-[11px] font-medium text-[var(--text-muted)]">Last Changed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {signals.map((s) => (
                    <tr key={s.id} className="hover:bg-[var(--bg-elevated)] transition-colors">
                      <td className="px-4 py-3">
                        <Link href={`/curators/${s.curatorAddress}`} className="font-mono text-sm text-[var(--text)] hover:text-[var(--accent)] transition-colors">
                          {shortenAddress(s.curatorAddress, 6)}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm text-[var(--text)]">{formatGRT(weiToGRT(s.signalledTokens))}</td>
                      <td className="px-4 py-3 text-right font-mono text-sm">
                        {BigInt(s.unsignalledTokens) > 0n
                          ? <span className="text-[var(--amber)]">{formatGRT(weiToGRT(s.unsignalledTokens))}</span>
                          : <span className="text-[var(--text-faint)]">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm">
                        {BigInt(s.realizedRewards) > 0n
                          ? <span className="text-[var(--green)]">{formatGRT(weiToGRT(s.realizedRewards))}</span>
                          : <span className="text-[var(--text-faint)]">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-[var(--text-faint)]">{formatEpoch(s.lastSignalChange)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="md:hidden space-y-3">
              {signals.map((s) => (
                <div key={`m-${s.id}`} className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)]">
                  <div className="flex items-center justify-between mb-2">
                    <Link href={`/curators/${s.curatorAddress}`} className="font-mono text-sm text-[var(--text)] hover:text-[var(--accent)] transition-colors">
                      {shortenAddress(s.curatorAddress, 6)}
                    </Link>
                    <span className="text-[10px] text-[var(--text-faint)]">{formatEpoch(s.lastSignalChange)}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="p-1.5 rounded bg-[var(--bg-surface)]">
                      <p className="text-[10px] text-[var(--text-faint)]">Signalled</p>
                      <p className="text-xs font-mono text-[var(--text)]">{formatGRT(weiToGRT(s.signalledTokens))}</p>
                    </div>
                    <div className="p-1.5 rounded bg-[var(--bg-surface)]">
                      <p className="text-[10px] text-[var(--text-faint)]">Withdrawn</p>
                      <p className={cn('text-xs font-mono', BigInt(s.unsignalledTokens) > 0n ? 'text-[var(--amber)]' : 'text-[var(--text-faint)]')}>
                        {BigInt(s.unsignalledTokens) > 0n ? formatGRT(weiToGRT(s.unsignalledTokens)) : '—'}
                      </p>
                    </div>
                    <div className="p-1.5 rounded bg-[var(--bg-surface)]">
                      <p className="text-[10px] text-[var(--text-faint)]">Realized</p>
                      <p className={cn('text-xs font-mono', BigInt(s.realizedRewards) > 0n ? 'text-[var(--green)]' : 'text-[var(--text-faint)]')}>
                        {BigInt(s.realizedRewards) > 0n ? formatGRT(weiToGRT(s.realizedRewards)) : '—'}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// History tab
// ---------------------------------------------------------------------------

function HistorySection({ hash }: { hash: string }) {
  const { data, isLoading } = useSubgraphHistory(hash);
  return <SubgraphHistoryChart data={data?.history ?? []} isLoading={isLoading} />;
}

// ---------------------------------------------------------------------------
// Versions tab — deployment version history (semver labels + deployment IDs)
// ---------------------------------------------------------------------------

function VersionsSection({ hash }: { hash: string }) {
  const { data, isLoading, error } = useSubgraphVersions(hash);

  if (isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle>Version History</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
            <span className="ml-3 text-sm text-[var(--text-muted)]">Loading versions…</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const versions = data?.versions ?? [];

  if (error || versions.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle>Version History</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-[var(--text-muted)] py-4">No version history available for this subgraph.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Version History</CardTitle>
          <span className="text-[10px] text-[var(--text-faint)]">{versions.length} version{versions.length === 1 ? '' : 's'}</span>
        </div>
      </CardHeader>
      <CardContent>
        <VersionsTable versions={versions} />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Manifest tab
// ---------------------------------------------------------------------------

function ManifestSection({ hash }: { hash: string }) {
  const { data: analysis, isLoading, error } = useManifestAnalysis(hash);

  if (isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle>Manifest Analysis</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
            <span className="ml-3 text-sm text-[var(--text-muted)]">Analysing manifest…</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error || !analysis) {
    return (
      <Card>
        <CardHeader><CardTitle>Manifest Analysis</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-[var(--text-muted)] py-4">Could not fetch or parse the manifest for this deployment.</p>
        </CardContent>
      </Card>
    );
  }

  const totalEvents = [...analysis.dataSources, ...analysis.templates].reduce((s, d) => s + d.eventHandlers, 0);
  const totalCalls = [...analysis.dataSources, ...analysis.templates].reduce((s, d) => s + d.callHandlers, 0);
  const totalBlocks = [...analysis.dataSources, ...analysis.templates].reduce((s, d) => s + d.blockHandlers, 0);
  const lowestStart = analysis.dataSources.reduce((min, ds) => Math.min(min, ds.startBlock), Number.MAX_SAFE_INTEGER);
  const startBlock = lowestStart === Number.MAX_SAFE_INTEGER ? 0 : lowestStart;

  return (
    <>
      <StatGrid className="lg:grid-cols-4 xl:grid-cols-4">
        <StatCard label="Overall Score" value={`${analysis.score}/100`} delta={{ value: analysis.category, positive: analysis.score < 50 }} />
        <StatCard label="Handler Profile" value={`${totalEvents}E / ${totalCalls}C / ${totalBlocks}B`} subtitle={totalBlocks > 0 ? 'Block handlers present' : 'Events only'} />
        <StatCard label="Data Sources" value={`${analysis.dataSources.length} sources`} subtitle={analysis.templates.length > 0 ? `+ ${analysis.templates.length} templates` : 'No templates'} />
        <StatCard label="Block Range" value={formatNumber(startBlock)} subtitle={`Start block on ${analysis.network}`} />
      </StatGrid>

      <Card>
        <CardHeader><CardTitle>Score Breakdown</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-4">
            {analysis.breakdown.map((dim) => (
              <div key={dim.dimension}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm text-[var(--text)]">{dim.dimension}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-[var(--text-faint)] font-mono">{dim.rawValue}</span>
                    <span className="text-sm font-mono font-medium text-[var(--text)]">{dim.score}/{dim.maxScore}</span>
                  </div>
                </div>
                <ProgressBar value={dim.score} max={dim.maxScore} variant={scoreVariant(dim.score, dim.maxScore)} size="sm" />
              </div>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t border-[var(--border)] flex justify-between items-center">
            <span className="text-sm font-medium text-[var(--text)]">Total</span>
            <div className="flex items-center gap-3">
              <Badge variant={CATEGORY_VARIANT[analysis.category]}>{analysis.category}</Badge>
              <span className="text-lg font-mono font-semibold text-[var(--text)]">{analysis.score}/100</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Data Sources</CardTitle>
            <Badge variant="default">{analysis.dataSources.length}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {analysis.dataSources.map((ds, i) => (
              <div key={i} className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)]">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="font-medium text-[var(--text)]">{ds.name}</p>
                    <p className="text-xs text-[var(--text-faint)]">{ds.kind} · {ds.network}</p>
                  </div>
                  <HandlerCounts source={ds} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-[var(--text-faint)]">Contract Address</p>
                    {ds.address
                      ? <p className="text-sm font-mono text-[var(--text)] truncate" title={ds.address}>{ds.address}</p>
                      : <p className="text-sm font-mono text-[var(--red)] font-semibold">ALL CONTRACTS</p>}
                  </div>
                  <div>
                    <p className="text-xs text-[var(--text-faint)]">Start Block</p>
                    <p className="text-sm font-mono text-[var(--text)]">{formatNumber(ds.startBlock)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {analysis.templates.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Templates (Dynamic Sources)</CardTitle>
              <Badge variant="default">{analysis.templates.length}</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {analysis.templates.map((tpl, i) => (
                <div key={i} className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)]">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium text-[var(--text)]">{tpl.name}</p>
                      <p className="text-xs text-[var(--text-faint)]">{tpl.kind} · {tpl.network}</p>
                    </div>
                    <HandlerCounts source={tpl} />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Configuration</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex justify-between items-center py-2 border-b border-[var(--border)]">
              <span className="text-sm text-[var(--text-muted)]">Spec Version</span>
              <span className="font-mono text-[var(--text)]">{analysis.specVersion}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-[var(--border)]">
              <span className="text-sm text-[var(--text-muted)]">Network</span>
              <span className="font-mono text-[var(--text)]">{analysis.network}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-[var(--border)]">
              <span className="text-sm text-[var(--text-muted)]">Features</span>
              <div className="flex gap-1.5 flex-wrap justify-end">
                {analysis.features.length > 0
                  ? analysis.features.map((f) => <Badge key={f} variant="accent">{f}</Badge>)
                  : <span className="text-[var(--text-faint)]">None</span>}
              </div>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-[var(--border)]">
              <span className="text-sm text-[var(--text-muted)]">Pruning</span>
              <span className={cn('font-mono', analysis.pruning === 'auto' ? 'text-[var(--green)]' : 'text-[var(--amber)]')}>
                {analysis.pruning ?? 'Not configured'}
              </span>
            </div>
            <div className="flex justify-between items-center py-2">
              <span className="text-sm text-[var(--text-muted)]">Graft</span>
              {analysis.graft ? (
                <div className="text-right">
                  <p className="font-mono text-sm text-[var(--text)]">{analysis.graft.base.slice(0, 12)}…{analysis.graft.base.slice(-6)}</p>
                  <p className="text-xs text-[var(--text-faint)]">at block {formatNumber(analysis.graft.block)}</p>
                </div>
              ) : (
                <span className="text-[var(--text-faint)]">None</span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Playground tab — full GraphiQL IDE (schema browser, autocomplete, highlighting)
// ---------------------------------------------------------------------------

const GraphiQLIDE = dynamic(() => import('@/components/SubgraphGraphiQL'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-[640px] rounded-[var(--radius-card)] border border-[var(--border)]">
      <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      <span className="ml-3 text-sm text-[var(--text-muted)]">Loading playground…</span>
    </div>
  ),
});

function PlaygroundSection({ hash }: { hash: string }) {
  const endpointPath = `/api/subgraph-playground/${hash}`;
  // The real decentralised-network gateway endpoint for this deployment. Users
  // substitute their own Subgraph Studio API key for <api-key>.
  const gatewayUrl = `https://gateway.thegraph.com/api/<api-key>/deployments/id/${hash}`;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle>GraphQL Playground</CardTitle>
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs text-[var(--text-faint)] font-mono truncate hidden sm:block">{endpointPath}</span>
              <button
                onClick={() => navigator.clipboard.writeText(`${window.location.origin}${endpointPath}`)}
                className="text-[var(--accent)] hover:text-[var(--text)] transition-colors flex-shrink-0"
                title="Copy Lodestar proxy URL"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Real decentralised-network gateway endpoint (bring your own API key) */}
          <div className="mb-3 flex items-center gap-2 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2">
            <span className="text-[10px] uppercase tracking-wide text-[var(--text-faint)] shrink-0">Gateway URL</span>
            <code className="text-xs font-mono text-[var(--text-muted)] truncate flex-1">{gatewayUrl}</code>
            <button
              onClick={() => navigator.clipboard.writeText(gatewayUrl)}
              className="text-[var(--accent)] hover:text-[var(--text)] transition-colors flex-shrink-0"
              title="Copy gateway query URL"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </button>
          </div>
          <GraphiQLIDE hash={hash} />
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inner page (needs useSearchParams — wrapped in Suspense by outer component)
// ---------------------------------------------------------------------------

function DeploymentPageInner({ hash }: { hash: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawTab = searchParams.get('tab');
  const activeTab: Tab = TABS.some((t) => t.id === rawTab) ? (rawTab as Tab) : 'overview';

  const { data: statusData } = useIndexingStatus(hash);
  const { data: manifestData } = useManifestAnalysis(hash);
  const { data: registryData } = useNetworksRegistry();

  let networkInfo: NetworkInfo | null = null;
  if (manifestData?.network && registryData?.networks) {
    for (const n of registryData.networks) {
      if (n.id === manifestData.network || n.aliases.includes(manifestData.network)) {
        networkInfo = n;
        break;
      }
    }
  }

  const displayName = statusData?.displayName ?? null;
  const networkLabel = networkInfo?.fullName ?? manifestData?.network ?? null;
  const networkIcon = networkInfo?.iconUrl ?? null;

  useEffect(() => {
    const parts = [displayName, networkLabel].filter(Boolean);
    if (parts.length > 0) document.title = `${parts.join(' · ')} — Lodestar`;
  }, [displayName, networkLabel]);

  const setTab = (tab: Tab) => {
    const params = new URLSearchParams(searchParams.toString());
    if (tab === 'overview') {
      params.delete('tab');
    } else {
      params.set('tab', tab);
    }
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : `?`, { scroll: false });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="min-w-0">
          {displayName ? (
            <>
              <h1 className="text-xl sm:text-2xl font-semibold text-[var(--text)] mb-1">{displayName}</h1>
              <div className="flex items-center gap-2 mb-1">
                {networkLabel && (
                  <Badge variant="accent">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {networkIcon && <img src={networkIcon} alt="" className="w-3.5 h-3.5 inline-block mr-1 -mt-px" />}
                    {networkLabel}
                  </Badge>
                )}
              </div>
            </>
          ) : (
            <h1 className="text-xl sm:text-2xl font-semibold text-[var(--text)] mb-1">
              {networkLabel ? `Deployment · ${networkLabel}` : 'Deployment'}
            </h1>
          )}
          <div className="flex items-center gap-2">
            <p className="text-xs sm:text-sm text-[var(--text-faint)] font-mono truncate">{hash}</p>
            <button
              onClick={() => navigator.clipboard.writeText(hash)}
              className="text-[var(--accent)] hover:text-[var(--text)] transition-colors flex-shrink-0"
              title="Copy hash"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </button>
          </div>
        </div>
        <button
          onClick={() => router.back()}
          className={cn(
            'px-3 py-2 text-sm rounded-[var(--radius-button)]',
            'border border-[var(--border)] hover:border-[var(--accent-hover)]',
            'transition-colors flex-shrink-0',
          )}
        >
          Back to Subgraphs
        </button>
      </div>

      {/* Tab nav */}
      <div className="flex items-center gap-1 border-b border-[var(--border)] overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setTab(tab.id)}
            className={cn(
              'px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px',
              activeTab === tab.id
                ? 'border-[var(--accent)] text-[var(--accent)]'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="space-y-6">
        {activeTab === 'overview' && <IndexingHealthSection hash={hash} />}
        {activeTab === 'schema' && <SchemaTab hash={hash} />}
        {activeTab === 'curators' && <CurationSection hash={hash} />}
        {activeTab === 'history' && <HistorySection hash={hash} />}
        {activeTab === 'versions' && <VersionsSection hash={hash} />}
        {activeTab === 'activity' && <ActivitySection hash={hash} />}
        {activeTab === 'manifest' && <ManifestSection hash={hash} />}
        {activeTab === 'playground' && <PlaygroundSection hash={hash} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page export — wraps inner component in Suspense (required by useSearchParams)
// ---------------------------------------------------------------------------

export default function DeploymentPage({
  params,
}: {
  params: Promise<{ hash: string }>;
}) {
  const { hash } = use(params);
  return (
    <Suspense fallback={<div className="h-8 shimmer rounded" />}>
      <DeploymentPageInner hash={hash} />
    </Suspense>
  );
}
