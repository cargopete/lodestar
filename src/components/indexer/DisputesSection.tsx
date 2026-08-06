'use client';

import Link from 'next/link';
import { useIndexerDisputes, type IndexerDispute } from '@/hooks/useNetworkStats';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { shortenAddress, formatGRT } from '@/lib/utils';

function statusVariant(status: string | null): 'success' | 'warning' | 'error' | 'default' {
  switch ((status ?? '').toLowerCase()) {
    case 'accepted': return 'error';   // dispute upheld → indexer slashed
    case 'rejected': return 'success'; // dispute dismissed → indexer cleared
    case 'draw': return 'warning';
    default: return 'default';         // undecided / pending
  }
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}

function grt(v: string | null): number {
  const n = Number(v ?? 0);
  return isNaN(n) ? 0 : n;
}

export function DisputesSection({ address }: { address: string }) {
  const { data, isLoading } = useIndexerDisputes(address);
  const disputes: IndexerDispute[] = data?.disputes ?? [];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Disputes &amp; Slashing</CardTitle>
          {!isLoading && (
            <span className="text-[10px] text-[var(--text-faint)]">
              {disputes.length === 0 ? 'Clean record' : `${disputes.length} on record`}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-6">
            <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : disputes.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)] py-2">
            No disputes on record. This indexer has never been disputed or slashed.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="px-4 py-2 text-left text-[11px] font-medium text-[var(--text-muted)]">Type</th>
                  <th className="px-4 py-2 text-left text-[11px] font-medium text-[var(--text-muted)]">Status</th>
                  <th className="px-4 py-2 text-right text-[11px] font-medium text-[var(--text-muted)]">Slashed</th>
                  <th className="px-4 py-2 text-right text-[11px] font-medium text-[var(--text-muted)] hidden sm:table-cell">Burned</th>
                  <th className="px-4 py-2 text-left text-[11px] font-medium text-[var(--text-muted)] hidden md:table-cell">Fisherman</th>
                  <th className="px-4 py-2 text-right text-[11px] font-medium text-[var(--text-muted)]">Opened</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {disputes.map((d) => {
                  const slashed = grt(d.tokens_slashed_grt);
                  const burned = grt(d.tokens_burned_grt);
                  return (
                    <tr key={d.id} className="hover:bg-[var(--bg-elevated)]">
                      <td className="px-4 py-3">
                        <span className="text-sm text-[var(--text)]">{d.dispute_type ?? 'Dispute'}</span>
                        {d.deployment_id && (
                          <Link href={`/subgraphs/${d.deployment_id}`} className="block text-[10px] font-mono text-[var(--text-faint)] hover:text-[var(--accent-text)] truncate max-w-[160px]">
                            {d.deployment_id.slice(0, 10)}…
                          </Link>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={statusVariant(d.status)}>{d.status ?? 'Undecided'}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={slashed > 0 ? 'font-mono text-sm text-[var(--red)]' : 'text-sm text-[var(--text-faint)]'}>
                          {slashed > 0 ? `${formatGRT(slashed)} GRT` : '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right hidden sm:table-cell">
                        <span className={burned > 0 ? 'font-mono text-sm text-[var(--text)]' : 'text-sm text-[var(--text-faint)]'}>
                          {burned > 0 ? `${formatGRT(burned)} GRT` : '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        {d.fisherman ? (
                          <a href={`https://arbiscan.io/address/${d.fisherman}`} target="_blank" rel="noopener noreferrer" className="text-[11px] font-mono text-[var(--text-muted)] hover:text-[var(--accent-text)]">
                            {shortenAddress(d.fisherman)}
                          </a>
                        ) : <span className="text-[var(--text-faint)]">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-[var(--text-muted)]">{fmtDate(d.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
