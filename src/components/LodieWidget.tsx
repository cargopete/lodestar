'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { usePathname } from 'next/navigation';

const TIPS: Record<string, string> = {
  '/': "These are the headline numbers — stake, allocations, query fees. A good place to find your bearings.",
  '/indexers': "Every indexer runs a different course. Check the risk score and cut rate before committing your delegation.",
  '/delegators': "Positions, rewards, and anything thawing. Track your anchors here.",
  '/services': "Horizon's new waters. Indexers provision stake here to serve data services beyond subgraphs.",
  '/payments': "The TAP pipeline — escrow balances and redemptions. What's been earned and what's been collected.",
  '/subgraphs': "Each subgraph charts different territory. The complexity score tells you how demanding it is to index.",
  '/poi': "Proof of Indexing. If indexers disagree here, someone's off course. Worth investigating before you trust the signal.",
  '/leaderboard': "The monthly standings — community votes and protocol metrics, combined.",
  '/calculator': "Run the numbers before you move. Redelegation carries a cost. Best to know before you sail.",
  '/compare': "Side by side. Useful when you've narrowed it down to two and need to make the call.",
  '/governance': "The protocol's compass. GIPs shape the rules — worth knowing what's in the water ahead.",
  '/roadmap': "What's being built and what's next. The Graph moves steadily.",
  '/blog': "Guides and notes from the network's edge. Useful if you're setting up infrastructure.",
  '/indexing': "Sync progress and health across subgraphs. Useful for indexers keeping watch on their fleet.",
};

function getTip(pathname: string): string {
  if (TIPS[pathname]) return TIPS[pathname];
  for (const key of Object.keys(TIPS).sort((a, b) => b.length - a.length)) {
    if (key !== '/' && pathname.startsWith(key)) return TIPS[key];
  }
  return "Steady as she goes. I'm here if you need your bearings.";
}

export function LodieWidget() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close panel on navigation
  useEffect(() => { setOpen(false); }, [pathname]);

  const tip = getTip(pathname);

  return (
    <div className="hidden lg:flex fixed z-50 right-6 bottom-6 flex-col items-end gap-2">
      {/* Tip panel */}
      {open && (
        <div
          className="bg-[var(--bg-elevated)] border border-[var(--border-mid)] rounded-[var(--radius-card)] shadow-2xl p-4 w-72 max-w-[calc(100vw-2rem)]"
          style={{ animation: 'lodie-panel-in 0.2s ease-out' }}
        >
          <div className="flex items-start gap-3">
            <div className="shrink-0 w-12 h-12 rounded-full overflow-hidden bg-[#ddeef5] border border-amber-400/20 shadow-md shadow-amber-400/10">
              <Image
                src="/lodie.png"
                alt="Lodie"
                width={48}
                height={48}
                className="w-full h-full object-cover object-top scale-110"
              />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-semibold text-[var(--text-faint)] uppercase tracking-widest mb-1">Lodie</p>
              <p className="text-[12.5px] text-[var(--text-muted)] leading-relaxed">{tip}</p>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-[var(--text-faint)] hover:text-[var(--text)] transition-colors text-xl leading-none -mt-0.5 -mr-0.5 shrink-0"
              aria-label="Close"
            >
              &times;
            </button>
          </div>
        </div>
      )}

      {/* Trigger button */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Close Lodie' : 'Ask Lodie'}
        title={open ? 'Close' : 'Ask Lodie'}
        className="w-14 h-14 rounded-full overflow-hidden bg-[#ddeef5] border-2 border-amber-400/30 shadow-lg shadow-amber-400/15 hover:border-amber-400/55 hover:shadow-amber-400/25 transition-all duration-200"
        style={{ animation: 'lodie-float 3.5s ease-in-out infinite' }}
      >
        <Image
          src="/lodie.png"
          alt="Lodie"
          width={56}
          height={56}
          className="w-full h-full object-cover object-top scale-110"
        />
      </button>
    </div>
  );
}
