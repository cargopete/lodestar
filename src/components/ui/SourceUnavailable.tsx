'use client';

import { Card } from './Card';

/**
 * Says out loud that an upstream data source could not be reached.
 *
 * The failure this exists for: `/api/network-stats` answers 503 when the nest behind it is
 * unreachable, `data` comes back undefined, and every `network ? weiToGRT(...) : 0` downstream
 * renders a confident `0.00 GRT`. The page looks healthy, the numbers are wrong, and the first
 * anyone knows is somebody asking why the network has no stake in it. Absent data must read as
 * absent, and it must say so once, at the top, rather than only as a grid of dashes.
 */
export function SourceUnavailable({ what, detail }: { what: string; detail?: string }) {
  return (
    <Card className="border-[var(--red-dim)]">
      <p className="text-sm text-[var(--red-text)]">
        {what} could not be loaded.
        {detail ? ` ${detail}` : ''}
      </p>
      <p className="text-xs text-[var(--text-muted)] mt-1">
        The figures it feeds are shown as unavailable rather than as zero. Nothing below is a
        statement about the network.
      </p>
    </Card>
  );
}
