'use client';

import { Card } from '@/components/ui/Card';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { shortenAddress, formatNumber } from '@/lib/utils';
import { badIndexerLabel, type GatewayProbeResult, type BadIndexerCategory } from '@/lib/gateway-probe';

interface Props {
  result: GatewayProbeResult;
  /** for resolving addresses → display names */
  indexers: { indexerId: string; indexerName: string | null }[];
}

function categoryVariant(category: BadIndexerCategory): BadgeVariant {
  switch (category) {
    case 'stale':
      return 'warning';
    case 'errored':
      return 'error';
    case 'timeout':
      return 'warning';
    case 'unavailable':
      return 'error';
    default:
      return 'default';
  }
}

export function GatewayServingCard({ result, indexers }: Props) {
  const nameFor = (addr: string): string => {
    const match = indexers.find((i) => i.indexerId.toLowerCase() === addr.toLowerCase());
    return match?.indexerName || shortenAddress(addr, 6);
  };

  // Served — the happy path.
  if (result.verdict === 'served') {
    return (
      <Card className="border-[var(--green-dim)]">
        <div className="flex items-start gap-2">
          <span aria-hidden>✓</span>
          <div>
            <p className="text-sm font-semibold text-[var(--green)]">Gateway is serving this subgraph</p>
            <p className="text-[13px] text-[var(--text-muted)] mt-0.5">
              A live query returned attested data
              {result.servedBlock != null ? ` at block ${formatNumber(result.servedBlock)}` : ''}. This is the
              consumer&apos;s-eye view: the same path a paid API key takes.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  // Bad indexers — the outage case. This is the signal /status and QoS miss.
  if (result.verdict === 'bad-indexers') {
    const n = result.badIndexers.length;
    return (
      <Card className="border-[var(--red-dim)]">
        <div className="flex items-start gap-2">
          <span aria-hidden>⛔</span>
          <div className="w-full">
            <p className="text-sm font-semibold text-[var(--red-text)]">
              Gateway can&apos;t serve this subgraph: 0 of {n} indexer{n === 1 ? '' : 's'} usable
            </p>
            <p className="text-[13px] text-[var(--text-muted)] mt-0.5 mb-3">
              A live query through the gateway was rejected by every allocated indexer it tried. This is why queries
              return &ldquo;bad indexers&rdquo; even when the sync table looks healthy.
            </p>
            <div className="space-y-1.5">
              {result.badIndexers.map((b) => (
                <div
                  key={b.indexer}
                  className="flex items-center justify-between gap-3 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-[var(--text)] truncate">{nameFor(b.indexer)}</p>
                    <p className="text-[10px] font-mono text-[var(--text-faint)]">{shortenAddress(b.indexer, 6)}</p>
                  </div>
                  <div className="flex flex-col items-end gap-0.5 shrink-0">
                    <Badge variant={categoryVariant(b.category)}>{badIndexerLabel(b)}</Badge>
                    {b.detail && b.detail.toLowerCase() !== badIndexerLabel(b).toLowerCase() && (
                      <span className="text-[10px] font-mono text-[var(--text-faint)]" title={`${b.kind}(${b.detail})`}>
                        {b.kind}: {b.detail}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Card>
    );
  }

  // No indexers available to the gateway at all.
  if (result.verdict === 'no-indexers') {
    return (
      <Card className="border-[var(--amber)]">
        <div className="flex items-start gap-2">
          <span aria-hidden>⚠</span>
          <div>
            <p className="text-sm font-semibold text-[var(--amber)]">No indexers available to the gateway</p>
            <p className="text-[13px] text-[var(--text-muted)] mt-0.5">
              The gateway found no indexer it could route a query to. Signal GRT to attract indexers.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  // not-found / error — keep it quiet so a probe hiccup doesn't cry wolf.
  if (result.verdict === 'not-found') {
    return (
      <Card>
        <p className="text-[13px] text-[var(--text-muted)]">
          The gateway doesn&apos;t recognise this deployment ({result.message ?? 'not found'}).
        </p>
      </Card>
    );
  }

  return null;
}
