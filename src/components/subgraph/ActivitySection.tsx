'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useSubgraphVersions, useSubgraphCuration } from '@/hooks/useNetworkStats';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { formatGRT, shortenAddress, formatRelativeTime } from '@/lib/utils';
import { buildActivityFeed } from '@/lib/subgraph-activity';

/**
 * Per-subgraph activity log, assembled client-side from the version history
 * (deployment publishes) and curator signal changes — the timestamped events the
 * network subgraph exposes. Merged into a single reverse-chronological timeline.
 */
export function ActivitySection({ hash }: { hash: string }) {
  const { data: versionsData, isLoading: vLoading } = useSubgraphVersions(hash);
  const { data: curationData, isLoading: cLoading } = useSubgraphCuration(hash);

  const events = useMemo(
    () => buildActivityFeed(versionsData?.versions ?? [], curationData?.signals ?? []),
    [versionsData, curationData],
  );

  const isLoading = vLoading || cLoading;

  return (
    <Card>
      <CardHeader><CardTitle>Activity</CardTitle></CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : events.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)] py-2">No recorded activity for this subgraph.</p>
        ) : (
          <ul className="space-y-3">
            {events.map((e, i) => (
              <li key={`${e.kind}-${e.ts}-${i}`} className="flex items-start gap-3">
                <span
                  className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${e.kind === 'version' ? 'bg-[var(--accent)]' : 'bg-[var(--green)]'}`}
                />
                <div className="min-w-0 flex-1">
                  {e.kind === 'version' ? (
                    <p className="text-sm text-[var(--text)]">
                      Version <span className="font-medium">{e.label}</span> deployed
                      <Link href={`/subgraphs/${e.ipfsHash}`} className="ml-2 text-[11px] font-mono text-[var(--text-faint)] hover:text-[var(--accent)]">
                        {e.ipfsHash.slice(0, 10)}…
                      </Link>
                    </p>
                  ) : (
                    <p className="text-sm text-[var(--text)]">
                      Curator <span className="font-mono text-[var(--text-muted)]">{shortenAddress(e.curator)}</span> signalled{' '}
                      <span className="font-mono text-[var(--green)]">{formatGRT(e.signalledGrt)} GRT</span>
                    </p>
                  )}
                  <p className="text-[11px] text-[var(--text-faint)]" title={new Date(e.ts * 1000).toLocaleString()}>
                    {formatRelativeTime(e.ts)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
