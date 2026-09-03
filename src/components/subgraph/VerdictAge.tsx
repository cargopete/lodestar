'use client';

import { useEffect, useState } from 'react';

/**
 * "as of 12s ago" for a cached verdict (RFC-006 D5, lodestar#59): a servability banner that cannot
 * say how old it is reads as an eternal truth, and the one that produced the uniswap-v4-base-3
 * incident was up to three minutes stale. Reads the clock in an effect, never during render, and
 * ticks so a page left open stays honest.
 */
export function VerdictAge({ probedAt, prefix = 'as of' }: { probedAt: string | null | undefined; prefix?: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    // The first read is deferred a tick rather than set synchronously in the effect, which is the
    // cascading-render pattern the compiler lint refuses; the label is blank for that one tick.
    const first = setTimeout(() => setNow(Date.now()), 0);
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, []);
  if (!probedAt || now === null) return null;
  const secs = Math.max(0, Math.round((now - Date.parse(probedAt)) / 1000));
  const age = secs < 90 ? `${secs}s` : `${Math.round(secs / 60)}m`;
  return <span className="font-normal text-[var(--text-muted)]">{prefix} {age} ago</span>;
}
