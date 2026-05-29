'use client';

import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { formatGRT, weiToGRT, formatRelativeTime } from '@/lib/utils';
import type { SubgraphVersion } from '@/hooks/useNetworkStats';

/**
 * Presentational table of a subgraph's deployment version history.
 * Each row is a published version (semver label + its deployment ID); the
 * version currently being viewed is flagged and not re-linked.
 */
export function VersionsTable({ versions }: { versions: SubgraphVersion[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-[var(--border)]">
            <th className="px-4 py-2 text-left text-[11px] font-medium text-[var(--text-muted)]">Version</th>
            <th className="px-4 py-2 text-left text-[11px] font-medium text-[var(--text-muted)]">Deployment</th>
            <th className="px-4 py-2 text-right text-[11px] font-medium text-[var(--text-muted)] hidden sm:table-cell">Signal</th>
            <th className="px-4 py-2 text-right text-[11px] font-medium text-[var(--text-muted)]">Created</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {versions.map((v) => (
            <tr key={`${v.version}-${v.ipfsHash}`} className="hover:bg-[var(--bg-elevated)]">
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-[var(--text)]">{v.label || `v${v.version}`}</span>
                  {v.isCurrent && <Badge variant="success">Current</Badge>}
                </div>
              </td>
              <td className="px-4 py-3">
                {v.isCurrent ? (
                  <span className="text-[11px] font-mono text-[var(--text-faint)]">
                    {v.ipfsHash.slice(0, 10)}…{v.ipfsHash.slice(-6)}
                  </span>
                ) : (
                  <Link
                    href={`/subgraphs/${v.ipfsHash}`}
                    className="text-[11px] font-mono text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
                  >
                    {v.ipfsHash.slice(0, 10)}…{v.ipfsHash.slice(-6)}
                  </Link>
                )}
              </td>
              <td className="px-4 py-3 text-right hidden sm:table-cell">
                <span className="font-mono text-sm text-[var(--green)]">{formatGRT(weiToGRT(v.signalledTokens))}</span>
              </td>
              <td className="px-4 py-3 text-right">
                <span className="text-sm text-[var(--text-muted)]" title={new Date(v.createdAt * 1000).toLocaleString()}>
                  {formatRelativeTime(v.createdAt)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
