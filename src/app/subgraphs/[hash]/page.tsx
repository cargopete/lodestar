'use client';

import { use } from 'react';
import Link from 'next/link';
import { useManifestAnalysis } from '@/hooks/useNetworkStats';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { StatCard, StatGrid } from '@/components/ui/StatCard';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { cn, formatNumber } from '@/lib/utils';
import type { ComplexityCategory, DataSourceSignal, TemplateSignal } from '@/lib/manifest';

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

export default function ManifestDetailPage({
  params,
}: {
  params: Promise<{ hash: string }>;
}) {
  const { hash } = use(params);
  const { data: analysis, isLoading, error } = useManifestAnalysis(hash);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !analysis) {
    return (
      <div className="text-center py-24">
        <h2 className="text-xl font-semibold text-[var(--text)] mb-2">Manifest Not Found</h2>
        <p className="text-[var(--text-muted)]">
          Could not fetch or parse the manifest for this deployment.
        </p>
        <p className="text-xs text-[var(--text-faint)] font-mono mt-2">{hash}</p>
        <Link
          href="/subgraphs"
          className={cn(
            'inline-flex items-center gap-2 mt-6 px-4 py-2 text-sm font-medium',
            'rounded-[var(--radius-button)] border border-[var(--border)]',
            'hover:border-[var(--accent-hover)] transition-colors'
          )}
        >
          Back to Subgraphs
        </Link>
      </div>
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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-xl sm:text-2xl font-semibold text-[var(--text)]">Manifest Analysis</h1>
            <Badge variant={CATEGORY_VARIANT[analysis.category]}>{analysis.category}</Badge>
          </div>
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
          <div className="flex items-center gap-2 mt-1.5">
            <Badge variant="accent">{analysis.network}</Badge>
            <span className="text-xs text-[var(--text-faint)]">spec {analysis.specVersion}</span>
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

      {/* Stats */}
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
    </div>
  );
}
