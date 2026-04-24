'use client';

import { useState, useEffect } from 'react';

const MESSAGES = [
  "Apologies for the wait — this one's taking the scenic route. On a total infrastructure budget of $0 we're honestly doing our best. Sit back, it'll come.",
  "Still loading, I'm afraid. The network is having a little think. Between you and me, we run this whole thing on $0, so a touch of patience is part of the deal.",
  "My sincerest apologies. I haven't crashed — I'm just doing what I can with precisely no budget whatsoever. Make yourself comfortable, the data is on its way.",
];

export function ChartSkeleton({ height = '280px' }: { height?: string }) {
  const [isSlow, setIsSlow] = useState(false);
  const [msg] = useState(() => MESSAGES[Math.floor(Math.random() * MESSAGES.length)]);

  useEffect(() => {
    const t = setTimeout(() => setIsSlow(true), 3000);
    return () => clearTimeout(t);
  }, []);

  return (
    <div style={{ minHeight: height }} className="flex flex-col items-center justify-center gap-4 py-6">
      <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin flex-shrink-0" />
      {isSlow && (
        <p className="text-[11px] text-[var(--text-muted)] leading-relaxed text-center max-w-[220px] px-6">{msg}</p>
      )}
    </div>
  );
}
