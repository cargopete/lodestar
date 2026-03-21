'use client';

import { use } from 'react';
import Link from 'next/link';
import { useIndexingStatus, useManifestAnalysis } from '@/hooks/useNetworkStats';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { StatCard, StatGrid } from '@/components/ui/StatCard';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { cn, formatNumber, formatGRT, weiToGRT, shortenAddress } from '@/lib/utils';
import type { IndexerStatusResult } from '@/lib/indexing-status';
import type { ComplexityCategory, DataSourceSignal, TemplateSignal } from '@/lib/manifest';

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
// Indexing Health Section
// ---------------------------------------------------------------------------

function IndexingHealthSection({ hash }: { hash: string }) {
  const { data, isLoading, error } = useIndexingStatus(hash);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Indexing Health</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
            <span className="ml-3 text-sm text-[var(--text-muted)]">Querying indexer status endpoints...</span>
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
          <p className="text-sm text-[var(--text-muted)] py-4">
            {error instanceof Error && error.message.includes('404')
              ? 'No active allocations found for this deployment.'
              : 'Unable to fetch indexing status. The deployment may not have active allocations.'}
          </p>
        </CardContent>
      </Card>
    );
  }

  const syncingCount = data.totalIndexers - data.syncedCount - data.failedCount - data.unreachableCount;

  return (
    <>
      {/* Summary stats */}
      <StatGrid className="lg:grid-cols-5 xl:grid-cols-5">
        <StatCard
          label="Active Indexers"
          value={String(data.totalAllocations)}
          subtitle={`${data.totalIndexers} unique`}
        />
        <StatCard
          label="Synced"
          value={String(data.syncedCount)}
          delta={data.syncedCount > 0
            ? { value: `${Math.round((data.syncedCount / data.totalIndexers) * 100)}%`, positive: true }
            : undefined
          }
        />
        <StatCard
          label="Syncing"
          value={String(syncingCount)}
          delta={syncingCount > 0 ? { value: 'In progress', positive: true } : undefined}
        />
        <StatCard
          label="Failed"
          value={String(data.failedCount)}
          delta={data.failedCount > 0 ? { value: 'Needs attention', positive: false } : undefined}
        />
        <StatCard
          label="Unreachable"
          value={String(data.unreachableCount)}
          subtitle={data.unreachableCount > 0 ? 'No URL or timeout' : 'All responding'}
        />
      </StatGrid>

      {/* Deployment info */}
      <StatGrid className="lg:grid-cols-2 xl:grid-cols-2">
        <StatCard
          label="Signal"
          value={formatGRT(weiToGRT(data.signalledTokens))}
          subtitle="GRT signalled"
        />
        <StatCard
          label="Stake"
          value={formatGRT(weiToGRT(data.stakedTokens))}
          subtitle="GRT staked"
        />
      </StatGrid>

      {/* Per-indexer breakdown */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Indexer Status</CardTitle>
            <span className="text-xs text-[var(--text-faint)]">
              Refreshes every 30s
            </span>
          </div>
        </CardHeader>
        <CardContent>
          {data.indexers.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)] py-4">
              No indexers have active allocations on this deployment.
            </p>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[var(--border)]">
                      <th className="px-4 py-2 text-left text-xs font-medium text-[var(--text-muted)] uppercase">Indexer</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-[var(--text-muted)] uppercase">Status</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-[var(--text-muted)] uppercase">Sync Progress</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-[var(--text-muted)] uppercase">Blocks Behind</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-[var(--text-muted)] uppercase">Entities</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-[var(--text-muted)] uppercase">Stake</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {data.indexers.map((indexer) => (
                      <tr key={indexer.indexerId} className="hover:bg-[var(--bg-elevated)] transition-colors">
                        <td className="px-4 py-3">
                          <Link
                            href={`/indexers/${indexer.indexerId}`}
                            className="hover:text-[var(--accent)] transition-colors"
                          >
                            <p className="font-medium text-[var(--text)] text-sm">
                              {indexer.indexerName ?? shortenAddress(indexer.indexerId)}
                            </p>
                          </Link>
                          <p className="text-[10px] text-[var(--text-faint)] font-mono">
                            {shortenAddress(indexer.indexerId, 6)}
                          </p>
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
                                variant={
                                  indexer.status === 'failed' ? 'orange' :
                                  indexer.syncProgress >= 99.9 ? 'teal' : 'accent'
                                }
                              />
                              <div className="flex justify-between mt-1">
                                <span className="text-[10px] font-mono text-[var(--text-faint)]">
                                  {formatNumber(indexer.latestBlock ?? 0)}
                                </span>
                                <span className="text-[10px] font-mono text-[var(--text-faint)]">
                                  {indexer.syncProgress.toFixed(2)}%
                                </span>
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
                              indexer.blocksBehind === 0 ? 'text-[var(--green)]' :
                              indexer.blocksBehind < 100 ? 'text-[var(--amber)]' :
                              'text-[var(--red)]'
                            )}>
                              {indexer.blocksBehind === 0 ? 'Caught up' : formatNumber(indexer.blocksBehind)}
                            </span>
                          ) : (
                            <span className="text-xs text-[var(--text-faint)]">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {indexer.entityCount ? (
                            <span className="text-sm font-mono text-[var(--text)]">
                              {formatNumber(Number(indexer.entityCount))}
                            </span>
                          ) : (
                            <span className="text-xs text-[var(--text-faint)]">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-sm font-mono text-[var(--text)]">
                            {formatGRT(weiToGRT(indexer.allocatedTokens))}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Error & warning log */}
              {data.indexers.some((i) => i.fatalError || (i.nonFatalErrors?.length ?? 0) > 0) && (
                <div className="mt-4 space-y-3">
                  <h4 className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">
                    Errors &amp; Warnings
                  </h4>
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
                          <Link
                            href={`/indexers/${indexer.indexerId}`}
                            className="text-xs font-medium text-[var(--text)] hover:text-[var(--accent)] transition-colors"
                          >
                            {indexer.indexerName ?? shortenAddress(indexer.indexerId)}
                          </Link>
                          <StatusBadge status={indexer.status} />
                          {(indexer.nonFatalErrorCount ?? 0) > 0 && (
                            <span className="text-[10px] text-[var(--text-faint)]">
                              {indexer.nonFatalErrorCount} non-fatal error{indexer.nonFatalErrorCount === 1 ? '' : 's'}
                            </span>
                          )}
                        </div>

                        {indexer.fatalError && (
                          <div className="mb-2">
                            <div className="flex items-center gap-1.5 mb-1">
                              <span className="text-[10px] font-semibold text-[var(--red)] uppercase">Fatal</span>
                              {indexer.fatalError.handler && (
                                <Badge variant="error">{indexer.fatalError.handler}</Badge>
                              )}
                            </div>
                            <p className="text-xs text-[var(--text-muted)] font-mono break-all leading-relaxed">
                              {indexer.fatalError.message}
                            </p>
                          </div>
                        )}

                        {indexer.nonFatalErrors && indexer.nonFatalErrors.length > 0 && (
                          <div className="space-y-1.5">
                            {!indexer.fatalError && (
                              <span className="text-[10px] font-semibold text-[var(--amber)] uppercase">
                                Non-fatal{indexer.nonFatalErrors.length > 1 ? ` (latest ${indexer.nonFatalErrors.length})` : ''}
                              </span>
                            )}
                            {indexer.fatalError && indexer.nonFatalErrors.length > 0 && (
                              <span className="text-[10px] font-semibold text-[var(--amber)] uppercase">
                                Non-fatal ({indexer.nonFatalErrors.length})
                              </span>
                            )}
                            {indexer.nonFatalErrors.map((msg, i) => (
                              <p
                                key={i}
                                className="text-xs text-[var(--text-muted)] font-mono break-all leading-relaxed pl-2 border-l-2 border-[var(--amber)] border-opacity-30"
                              >
                                {msg}
                              </p>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                </div>
              )}

              {/* Mobile cards */}
              <div className="md:hidden space-y-3">
                {data.indexers.map((indexer) => (
                  <div
                    key={`m-${indexer.indexerId}`}
                    className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)]"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <Link
                        href={`/indexers/${indexer.indexerId}`}
                        className="hover:text-[var(--accent)] transition-colors"
                      >
                        <p className="font-medium text-sm text-[var(--text)]">
                          {indexer.indexerName ?? shortenAddress(indexer.indexerId)}
                        </p>
                        <p className="text-[10px] text-[var(--text-faint)] font-mono">
                          {shortenAddress(indexer.indexerId, 6)}
                        </p>
                      </Link>
                      <StatusBadge status={indexer.status} />
                    </div>

                    {indexer.syncProgress !== undefined && (
                      <div className="mb-3">
                        <ProgressBar
                          value={indexer.syncProgress}
                          max={100}
                          size="sm"
                          variant={
                            indexer.status === 'failed' ? 'orange' :
                            indexer.syncProgress >= 99.9 ? 'teal' : 'accent'
                          }
                        />
                        <div className="flex justify-between mt-1">
                          <span className="text-[10px] font-mono text-[var(--text-faint)]">
                            Block {formatNumber(indexer.latestBlock ?? 0)}
                          </span>
                          <span className="text-[10px] font-mono text-[var(--text-faint)]">
                            {indexer.syncProgress.toFixed(2)}%
                          </span>
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="p-1.5 rounded bg-[var(--bg-surface)]">
                        <p className="text-[10px] text-[var(--text-faint)]">Behind</p>
                        <p className={cn(
                          'text-xs font-mono',
                          indexer.blocksBehind === 0 ? 'text-[var(--green)]' :
                          (indexer.blocksBehind ?? 0) < 100 ? 'text-[var(--amber)]' :
                          'text-[var(--text)]'
                        )}>
                          {indexer.blocksBehind !== undefined ? formatNumber(indexer.blocksBehind) : '—'}
                        </p>
                      </div>
                      <div className="p-1.5 rounded bg-[var(--bg-surface)]">
                        <p className="text-[10px] text-[var(--text-faint)]">Entities</p>
                        <p className="text-xs font-mono text-[var(--text)]">
                          {indexer.entityCount ? formatNumber(Number(indexer.entityCount)) : '—'}
                        </p>
                      </div>
                      <div className="p-1.5 rounded bg-[var(--bg-surface)]">
                        <p className="text-[10px] text-[var(--text-faint)]">Stake</p>
                        <p className="text-xs font-mono text-[var(--text)]">
                          {formatGRT(weiToGRT(indexer.allocatedTokens))}
                        </p>
                      </div>
                    </div>

                    {indexer.fatalError && (
                      <div className="mt-3 p-2 rounded bg-[var(--red-dim)] border border-[var(--red)] border-opacity-20">
                        <p className="text-[10px] text-[var(--red)] font-medium mb-0.5">Fatal Error</p>
                        <p className="text-[10px] text-[var(--text-muted)] font-mono break-all">
                          {indexer.fatalError.message}
                        </p>
                      </div>
                    )}

                    {!indexer.fatalError && indexer.nonFatalErrors && indexer.nonFatalErrors.length > 0 && (
                      <div className="mt-3 p-2 rounded bg-[var(--amber-dim)] border border-[var(--amber)] border-opacity-20">
                        <p className="text-[10px] text-[var(--amber)] font-medium mb-1">
                          {indexer.nonFatalErrorCount} non-fatal error{indexer.nonFatalErrorCount === 1 ? '' : 's'}
                        </p>
                        {indexer.nonFatalErrors.map((msg, i) => (
                          <p key={i} className="text-[10px] text-[var(--text-muted)] font-mono break-all leading-relaxed">
                            {msg}
                          </p>
                        ))}
                      </div>
                    )}
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
// Manifest Analysis Section (preserved from original page)
// ---------------------------------------------------------------------------

function ManifestSection({ hash }: { hash: string }) {
  const { data: analysis, isLoading, error } = useManifestAnalysis(hash);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Manifest Analysis</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
            <span className="ml-3 text-sm text-[var(--text-muted)]">Analysing manifest...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error || !analysis) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Manifest Analysis</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-[var(--text-muted)] py-4">
            Could not fetch or parse the manifest for this deployment.
          </p>
        </CardContent>
      </Card>
    );
  }

  const totalEvents = [...analysis.dataSources, ...analysis.templates].reduce((s, d) => s + d.eventHandlers, 0);
  const totalCalls = [...analysis.dataSources, ...analysis.templates].reduce((s, d) => s + d.callHandlers, 0);
  const totalBlocks = [...analysis.dataSources, ...analysis.templates].reduce((s, d) => s + d.blockHandlers, 0);
  const lowestStart = analysis.dataSources.reduce(
    (min, ds) => Math.min(min, ds.startBlock),
    Number.MAX_SAFE_INTEGER,
  );
  const startBlock = lowestStart === Number.MAX_SAFE_INTEGER ? 0 : lowestStart;

  return (
    <>
      {/* Complexity Stats */}
      <StatGrid className="lg:grid-cols-4 xl:grid-cols-4">
        <StatCard
          label="Overall Score"
          value={`${analysis.score}/100`}
          delta={{ value: analysis.category, positive: analysis.score < 50 }}
        />
        <StatCard
          label="Handler Profile"
          value={`${totalEvents}E / ${totalCalls}C / ${totalBlocks}B`}
          subtitle={totalBlocks > 0 ? 'Block handlers present' : 'Events only'}
        />
        <StatCard
          label="Data Sources"
          value={`${analysis.dataSources.length} sources`}
          subtitle={analysis.templates.length > 0 ? `+ ${analysis.templates.length} templates` : 'No templates'}
        />
        <StatCard
          label="Block Range"
          value={formatNumber(startBlock)}
          subtitle={`Start block on ${analysis.network}`}
        />
      </StatGrid>

      {/* Score Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Score Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {analysis.breakdown.map((dim) => (
              <div key={dim.dimension}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm text-[var(--text)]">{dim.dimension}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-[var(--text-faint)] font-mono">{dim.rawValue}</span>
                    <span className="text-sm font-mono font-medium text-[var(--text)]">
                      {dim.score}/{dim.maxScore}
                    </span>
                  </div>
                </div>
                <ProgressBar
                  value={dim.score}
                  max={dim.maxScore}
                  variant={scoreVariant(dim.score, dim.maxScore)}
                  size="sm"
                />
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

      {/* Data Sources */}
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
              <div
                key={i}
                className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)]"
              >
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
                    {ds.address ? (
                      <p className="text-sm font-mono text-[var(--text)] truncate" title={ds.address}>
                        {ds.address}
                      </p>
                    ) : (
                      <p className="text-sm font-mono text-[var(--red)] font-semibold">
                        ALL CONTRACTS
                      </p>
                    )}
                  </div>
                  <div>
                    <p className="text-xs text-[var(--text-faint)]">Start Block</p>
                    <p className="text-sm font-mono text-[var(--text)]">
                      {formatNumber(ds.startBlock)}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Templates */}
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
                <div
                  key={i}
                  className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)]"
                >
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

      {/* Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>Configuration</CardTitle>
        </CardHeader>
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
                {analysis.features.length > 0 ? (
                  analysis.features.map((f) => (
                    <Badge key={f} variant="accent">{f}</Badge>
                  ))
                ) : (
                  <span className="text-[var(--text-faint)]">None</span>
                )}
              </div>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-[var(--border)]">
              <span className="text-sm text-[var(--text-muted)]">Pruning</span>
              <span className={cn(
                'font-mono',
                analysis.pruning === 'auto' ? 'text-[var(--green)]' : 'text-[var(--amber)]'
              )}>
                {analysis.pruning ?? 'Not configured'}
              </span>
            </div>
            <div className="flex justify-between items-center py-2">
              <span className="text-sm text-[var(--text-muted)]">Graft</span>
              {analysis.graft ? (
                <div className="text-right">
                  <p className="font-mono text-sm text-[var(--text)]">
                    {analysis.graft.base.slice(0, 12)}...{analysis.graft.base.slice(-6)}
                  </p>
                  <p className="text-xs text-[var(--text-faint)]">
                    at block {formatNumber(analysis.graft.block)}
                  </p>
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
// Page
// ---------------------------------------------------------------------------

export default function DeploymentPage({
  params,
}: {
  params: Promise<{ hash: string }>;
}) {
  const { hash } = use(params);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold text-[var(--text)] mb-2">
            Deployment
          </h1>
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
        <Link
          href="/subgraphs"
          className={cn(
            'px-3 py-2 text-sm rounded-[var(--radius-button)]',
            'border border-[var(--border)] hover:border-[var(--accent-hover)]',
            'transition-colors flex-shrink-0'
          )}
        >
          Back to Subgraphs
        </Link>
      </div>

      {/* Indexing Health — the main event */}
      <IndexingHealthSection hash={hash} />

      {/* Manifest Analysis — secondary section */}
      <div className="pt-2">
        <h2 className="text-lg font-semibold text-[var(--text)] mb-4">Manifest Analysis</h2>
        <div className="space-y-6">
          <ManifestSection hash={hash} />
        </div>
      </div>
    </div>
  );
}
