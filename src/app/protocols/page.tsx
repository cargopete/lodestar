'use client';

import Link from 'next/link';
import { PROTOCOLS } from '@/lib/protocols/config';
import { useProtocolsDirectory } from '@/hooks/useProtocols';
import { formatUSD } from '@/lib/utils';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';

const CATEGORY_STYLES: Record<string, string> = {
  'DEX': 'bg-[var(--accent)]/10 text-[var(--accent)]',
  'Lending': 'bg-[var(--green)]/10 text-[var(--green)]',
  'Liquid Staking': 'bg-[#00A3FF]/12 text-[#5BC2FF]',
  'Yield Aggregator': 'bg-[#0657F9]/12 text-[#6E92FF]',
};

function CategoryBadge({ category }: { category: string }) {
  const styles = CATEGORY_STYLES[category] ?? 'bg-[var(--bg-elevated)] text-[var(--text-muted)]';
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap ${styles}`}>
      {category}
    </span>
  );
}

export default function ProtocolsPage() {
  const { data: summaries, isLoading } = useProtocolsDirectory();

  return (
    <div className="space-y-6">
      <div className="pb-2 border-b border-[var(--border)]">
        <h1 className="text-2xl font-semibold text-[var(--text)]">DeFi Protocols</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          Live analytics for leading DeFi protocols — all data sourced from The Graph
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Protocol Directory</CardTitle>
            <span className="text-xs text-[var(--text-faint)]">Data updated hourly · Powered by The Graph</span>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {PROTOCOLS.map((p) => (
                <div key={p.slug} className="h-12 shimmer rounded" />
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th className="text-left py-2 pr-4 text-[11px] font-medium text-[var(--text-faint)] w-8">#</th>
                    <th className="text-left py-2 pr-4 text-[11px] font-medium text-[var(--text-faint)]">Protocol</th>
                    <th className="text-left py-2 pr-4 text-[11px] font-medium text-[var(--text-faint)]">Category</th>
                    <th className="text-right py-2 pr-4 text-[11px] font-medium text-[var(--text-faint)]">TVL</th>
                    <th className="text-right py-2 pr-4 text-[11px] font-medium text-[var(--text-faint)]">30d Volume</th>
                    <th className="text-right py-2 text-[11px] font-medium text-[var(--text-faint)]">30d Fees</th>
                  </tr>
                </thead>
                <tbody>
                  {PROTOCOLS.map((protocol, i) => {
                    const summary = summaries?.[i];
                    const failed = summaries && !summary;
                    return (
                      <tr
                        key={protocol.slug}
                        className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--bg-elevated)] transition-colors"
                      >
                        <td className="py-3 pr-4 text-[var(--text-faint)] font-mono text-xs">{i + 1}</td>
                        <td className="py-3 pr-4">
                          <Link
                            href={`/protocols/${protocol.slug}`}
                            className="flex items-center gap-2.5 group"
                          >
                            <span
                              className="w-2.5 h-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: protocol.color }}
                            />
                            <span className="font-medium text-[var(--text)] group-hover:text-[var(--accent)] transition-colors">
                              {protocol.name}
                            </span>
                            <span className="text-[10px] text-[var(--text-faint)] hidden sm:inline">
                              {protocol.chains.join(', ')}
                            </span>
                          </Link>
                        </td>
                        <td className="py-3 pr-4">
                          <CategoryBadge category={protocol.category} />
                        </td>
                        <td className="py-3 pr-4 text-right font-mono text-[var(--text)] whitespace-nowrap">
                          {failed ? '—' : summary ? formatUSD(summary.tvlUSD) : <span className="text-[var(--text-faint)]">—</span>}
                        </td>
                        <td className="py-3 pr-4 text-right font-mono text-[var(--text-muted)] text-xs whitespace-nowrap">
                          {failed ? '—' : summary ? formatUSD(summary.volume30dUSD) : '—'}
                        </td>
                        <td className="py-3 text-right font-mono text-[var(--accent)] text-xs whitespace-nowrap">
                          {failed ? '—' : summary ? formatUSD(summary.fees30dUSD) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-center text-[var(--text-faint)]">
        Analytics powered by{' '}
        <a
          href="https://thegraph.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--accent)] hover:underline"
        >
          The Graph
        </a>
        {' '}— open, permissionless blockchain data
      </p>
    </div>
  );
}
