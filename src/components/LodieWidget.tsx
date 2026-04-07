'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useAccount } from 'wagmi';

// ─── Content ────────────────────────────────────────────────────────────────

const PAGE_TIPS: Record<string, { basic: string; deep?: string }> = {
  '/': {
    basic: "These are the headline numbers — stake, allocations, query fees. A good place to find your bearings.",
    deep: "Total stake is GRT locked by indexers as collateral. Allocations show how that stake is directed at subgraphs. Query fees are what data consumers have paid — the core revenue signal. If fees are low relative to allocations, the network may be over-indexed on that deployment.",
  },
  '/indexers': {
    basic: "Every indexer runs a different course. Check the risk score and cut rate before committing your delegation.",
    deep: "The risk score is a 7-dimension composite graded A–F: REO compliance (25%), self-stake ratio (20%), cut stability (15%), allocation efficiency (15%), over-delegation (10%), transparency (10%), and delegation trend (5%). An F in REO or self-stake is the most concerning — the others can recover.",
  },
  '/delegators': {
    basic: "Positions, rewards, and anything thawing. Track your anchors here.",
    deep: "Undelegating starts a 28-day thawing period — your GRT is locked and earns nothing during that time. Plan accordingly before moving. The portfolio page shows unrealised rewards, which only materialise when you undelegate.",
  },
  '/services': {
    basic: "Horizon's new waters. Indexers provision stake here to serve data services beyond subgraphs.",
    deep: "Horizon separates indexing agreements from the old allocation model. Indexers now provision stake per service type rather than per subgraph deployment. This allows more flexible service pricing and creates new revenue streams beyond query fees.",
  },
  '/payments': {
    basic: "The TAP pipeline — escrow balances and redemptions. What's been earned and what's been collected.",
    deep: "TAP (Timeline Aggregation Protocol) replaces the old voucher system. Gateways deposit escrow and issue RAVs (Receipt Aggregate Vouchers) to indexers, who redeem them on-chain. The gap between escrow and redeemed is the outstanding obligation — useful for spotting redemption delays.",
  },
  '/subgraphs': {
    basic: "Each subgraph charts different territory. The complexity score tells you how demanding it is to index.",
    deep: "Complexity is scored Light→Extreme based on handler count, entity types, `eth_call` usage, and block time normalised by chain. A 'Heavy' or 'Extreme' subgraph on a fast chain (BSC, Polygon) will put pressure on indexer infrastructure — relevant when choosing which deployments to allocate to.",
  },
  '/poi': {
    basic: "Proof of Indexing. If indexers disagree here, someone's off course. Worth investigating before you trust the signal.",
    deep: "A POI is a cryptographic hash of an indexer's state at a given block. If two indexers produce different POIs for the same deployment and block, one of them is indexing incorrectly. Persistent divergence can lead to disputes and slashing.",
  },
  '/leaderboard': {
    basic: "The monthly standings — community votes and protocol metrics, combined.",
    deep: "The leaderboard score blends on-chain metrics (allocation efficiency, cut rate, REO status, etc.) with community votes. Delegators with active positions vote with 5× weight. The point system is designed to reward consistent, transparent indexing over raw size.",
  },
  '/calculator': {
    basic: "Run the numbers before you move. Redelegation carries a cost. Best to know before you sail.",
    deep: "The 0.5% delegation tax is the main cost. On a large position it compounds with the opportunity cost of the 28-day thawing period. The calculator shows the break-even point — how long you need to stay with the new indexer before the switch pays off.",
  },
  '/compare': {
    basic: "Side by side. Useful when you've narrowed it down to two and need to make the call.",
    deep: "Focus on cut rate stability over time (not just current), self-stake ratio (skin in the game), and allocation efficiency (are they earning on their allocations?). A high-performing indexer with a volatile cut history is a risk.",
  },
  '/governance': {
    basic: "The protocol's compass. GIPs shape the rules — worth knowing what's in the water ahead.",
    deep: "GIPs (Graph Improvement Proposals) go through Draft → Candidate → Accepted → Deployed. The ones currently in Candidate stage are the ones to watch — they'll affect indexer economics within the next few epochs once deployed.",
  },
  '/roadmap': {
    basic: "What's being built and what's next. The Graph moves steadily.",
    deep: "The Horizon upgrade introduced provisions and data services. The next major unlocks are on-chain indexing agreements (GIP-0087/0088 still in draft) and a richer rewards model tied to service quality rather than allocation size.",
  },
  '/blog': {
    basic: "Guides and notes from the network's edge. Useful if you're setting up infrastructure.",
    deep: "The posts here cover practical indexer infrastructure — archive node setup, graph-node configuration, chain lag debugging. Sourced from real conversations in The Graph's Discord and indexer community.",
  },
  '/indexing': {
    basic: "Sync progress and health across subgraphs. Useful for indexers keeping watch on their fleet.",
    deep: "If a subgraph is stuck behind chain head, check the graph-node logs for eth_call latency or reorg_threshold misconfiguration. On fast chains (BSC, Polygon), the default reorg threshold of 250 blocks keeps you in slow block-walk mode almost permanently — 50 is usually fine.",
  },
};

const WISDOMS = [
  "Steady as she goes. I'm here if you need your bearings.",
  "The sea doesn't rush. Neither should a good delegation decision.",
  "A lighthouse doesn't chase ships — it simply stays lit.",
  "Every epoch is a new tide. The network keeps turning regardless.",
  "The best indexers are the ones still here in two years.",
  "Fog doesn't mean danger. It just means look more carefully.",
  "Cut rates change. Habits don't. Watch the history, not just the current number.",
  "GRT delegated is GRT at work. Know where it's pointed.",
];

const ONBOARDING_KEY = 'lodestar:lodie-toured';

// ─── Helpers ────────────────────────────────────────────────────────────────

function getPageTip(pathname: string): { basic: string; deep?: string } | null {
  if (PAGE_TIPS[pathname]) return PAGE_TIPS[pathname];
  for (const key of Object.keys(PAGE_TIPS).sort((a, b) => b.length - a.length)) {
    if (key !== '/' && pathname.startsWith(key)) return PAGE_TIPS[key];
  }
  return null;
}

function randomWisdom(): string {
  return WISDOMS[Math.floor(Math.random() * WISDOMS.length)];
}

// ─── Component ───────────────────────────────────────────────────────────────

export function LodieWidget() {
  const [open, setOpen] = useState(false);
  const [depth, setDepth] = useState<0 | 1>(0);
  const [wisdom] = useState(randomWisdom);
  const [toured, setToured] = useState(true);
  const [dataWarning, setDataWarning] = useState<string | null>(null);
  const [walletWarning, setWalletWarning] = useState<string | null>(null);

  const pathname = usePathname();
  const { address: walletAddress } = useAccount();

  // Check first visit
  useEffect(() => {
    if (!localStorage.getItem(ONBOARDING_KEY)) {
      setToured(false);
      setOpen(true);
    }
  }, []);

  // Reset on navigation
  useEffect(() => {
    setOpen(false);
    setDepth(0);
    setDataWarning(null);
  }, [pathname]);

  // Keyboard shortcut: L
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'l' && e.key !== 'L') return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
      setOpen((o) => !o);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Data-aware: detect greedy/idle indexer on detail page
  useEffect(() => {
    const match = pathname.match(/^\/indexers\/(0x[a-fA-F0-9]{40})/i);
    if (!match) return;
    fetch(`/api/indexer/${match[1]}`)
      .then((r) => r.json())
      .then(({ data }) => {
        const ix = data?.indexer;
        if (!ix) return;
        const cut = ix.indexingRewardCut as number;
        if (cut >= 1_000_000) {
          setDataWarning("This indexer takes 100% of indexing rewards. Delegators earn nothing from indexing — only query fees.");
        } else if (cut >= 900_000) {
          setDataWarning(`This indexer takes ${(cut / 10_000).toFixed(0)}% of indexing rewards. Delegators keep ${(100 - cut / 10_000).toFixed(0)}%.`);
        } else if ((ix.allocationCount as number) === 0) {
          setDataWarning("No active allocations — this indexer isn't earning indexing rewards right now.");
        }
      })
      .catch(() => {});
  }, [pathname]);

  // Wallet health check
  useEffect(() => {
    if (!walletAddress) { setWalletWarning(null); return; }
    fetch(`/api/portfolio?address=${walletAddress}&type=delegator`)
      .then((r) => r.json())
      .then(({ data }) => {
        const stakes = (data?.delegator?.stakes ?? []) as Array<{
          lockedTokens: string;
          indexer: { indexingRewardCut: number };
        }>;
        const greedy = stakes.filter((s) => s.indexer.indexingRewardCut >= 900_000);
        const thawing = stakes.filter((s) => BigInt(s.lockedTokens || '0') > 0n);
        if (greedy.length > 0) {
          setWalletWarning(`${greedy.length} of your indexed position${greedy.length > 1 ? 's have' : ' has'} a 90%+ cut — worth reviewing.`);
        } else if (thawing.length > 0) {
          setWalletWarning(`${thawing.length} undelegation${thawing.length > 1 ? 's are' : ' is'} currently thawing.`);
        } else {
          setWalletWarning(null);
        }
      })
      .catch(() => {});
  }, [walletAddress]);

  const completeTour = () => {
    localStorage.setItem(ONBOARDING_KEY, '1');
    setToured(true);
  };

  const toggleOpen = () => {
    setOpen((o) => {
      if (o) setDepth(0);
      return !o;
    });
  };

  const pageTip = getPageTip(pathname);
  const mainTip = depth === 1 && pageTip?.deep ? pageTip.deep : (pageTip?.basic ?? wisdom);
  const hasDeep = !!pageTip?.deep;

  // Content priority: onboarding > data warning > page tip/wisdom
  const showOnboarding = !toured;
  const showWarning = !showOnboarding && !!dataWarning;
  const showWalletBanner = !showOnboarding && !showWarning && !!walletWarning;

  return (
    <div className="flex fixed z-50 flex-col gap-2 items-end
      right-4 bottom-[calc(var(--bottom-nav-height)+var(--safe-bottom,0px)+72px)]
      lg:right-6 lg:bottom-6">

      {/* Panel */}
      {open && (
        <div
          className="bg-[var(--bg-elevated)] border border-[var(--border-mid)] rounded-[var(--radius-card)] shadow-2xl p-4 w-72 max-w-[calc(100vw-2rem)]"
          style={{ animation: 'lodie-panel-in 0.2s ease-out' }}
        >
          <div className="flex items-start gap-3">
            <div className="shrink-0 w-12 h-12 rounded-full overflow-hidden bg-[#ddeef5] border border-amber-400/20 shadow-md shadow-amber-400/10">
              <Image src="/lodie.png" alt="Lodie" width={48} height={48} className="w-full h-full object-cover object-top scale-110" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-semibold text-[var(--text-faint)] uppercase tracking-widest mb-1">Lodie</p>

              {showOnboarding && (
                <p className="text-[12.5px] text-[var(--text-muted)] leading-relaxed">
                  Welcome aboard. I'm Lodie — spirit of this lighthouse. Navigate to any page and I'll tell you what to look for. Press <kbd className="px-1 py-px rounded bg-[var(--bg)] text-[var(--text-faint)] text-[10px] font-mono">L</kbd> to summon me anytime.
                </p>
              )}

              {showWarning && (
                <p className="text-[12.5px] text-amber-400 leading-relaxed">{dataWarning}</p>
              )}

              {!showOnboarding && !showWarning && (
                <p className="text-[12.5px] text-[var(--text-muted)] leading-relaxed">{mainTip}</p>
              )}
            </div>
            <button
              onClick={() => { setOpen(false); setDepth(0); }}
              className="text-[var(--text-faint)] hover:text-[var(--text)] transition-colors text-xl leading-none -mt-0.5 -mr-0.5 shrink-0"
              aria-label="Close"
            >
              &times;
            </button>
          </div>

          {/* Wallet warning banner */}
          {showWalletBanner && (
            <div className="mt-3 pt-3 border-t border-[var(--border)] flex items-start gap-2">
              <span className="text-amber-400 text-[11px] mt-px">◆</span>
              <p className="text-[11px] text-amber-400/90 leading-relaxed">{walletWarning}</p>
            </div>
          )}

          {/* Footer */}
          <div className="mt-3 flex items-center justify-between">
            {showOnboarding ? (
              <button onClick={completeTour} className="text-[11px] text-[var(--accent)] hover:opacity-80 transition-opacity">
                Got it, I'll explore →
              </button>
            ) : depth === 0 && hasDeep ? (
              <button onClick={() => setDepth(1)} className="text-[11px] text-[var(--text-faint)] hover:text-[var(--text)] transition-colors">
                Tell me more →
              </button>
            ) : depth === 1 ? (
              <button onClick={() => setDepth(0)} className="text-[11px] text-[var(--text-faint)] hover:text-[var(--text)] transition-colors">
                ← Back
              </button>
            ) : (
              <span />
            )}
            <span className="text-[10px] text-[var(--text-faint)] font-mono">L to summon</span>
          </div>
        </div>
      )}

      {/* Trigger */}
      <button
        onClick={toggleOpen}
        aria-label={open ? 'Close Lodie' : 'Ask Lodie'}
        title="Lodie (press L)"
        className="w-14 h-14 rounded-full overflow-hidden bg-[#ddeef5] border-2 border-amber-400/30 shadow-lg shadow-amber-400/15 hover:border-amber-400/55 hover:shadow-amber-400/25 transition-all duration-200"
        style={{ animation: 'lodie-float 3.5s ease-in-out infinite' }}
      >
        <Image src="/lodie.png" alt="Lodie" width={56} height={56} className="w-full h-full object-cover object-top scale-110" />
      </button>
    </div>
  );
}
