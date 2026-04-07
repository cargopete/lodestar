'use client';

import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useAccount } from 'wagmi';

// ─── Static content ──────────────────────────────────────────────────────────

const PAGE_TIPS: Record<string, { basic: string; deep?: string }> = {
  '/': {
    basic: "These are the headline numbers — stake, allocations, query fees. A good place to find your bearings.",
    deep: "Total stake is GRT locked by indexers as collateral. Allocations show how that stake is directed at subgraphs. Query fees are what data consumers have paid — the core revenue signal. If fees are low relative to allocations, the network may be over-indexed on that deployment.",
  },
  '/indexers': {
    basic: "Every indexer runs a different course. Check the risk score and cut rate before committing your delegation.",
    deep: "The risk score is a 7-dimension composite graded A–F: REO compliance (25%), self-stake ratio (20%), cut stability (15%), allocation efficiency (15%), over-delegation (10%), transparency (10%), and delegation trend (5%). An F in REO or self-stake is the most concerning.",
  },
  '/delegators': {
    basic: "Positions, rewards, and anything thawing. Track your anchors here.",
    deep: "Undelegating starts a 28-day thawing period — your GRT is locked and earns nothing during that time. The portfolio page shows unrealised rewards, which only materialise when you undelegate.",
  },
  '/services': {
    basic: "Horizon's new waters. Indexers provision stake here to serve data services beyond subgraphs.",
    deep: "Horizon separates indexing agreements from the old allocation model. Indexers provision stake per service type, allowing more flexible pricing and new revenue streams beyond query fees.",
  },
  '/payments': {
    basic: "The TAP pipeline — escrow balances and redemptions. What's been earned and what's been collected.",
    deep: "TAP replaces the old voucher system. Gateways deposit escrow and issue RAVs to indexers, who redeem them on-chain. The gap between escrow and redeemed is the outstanding obligation — useful for spotting redemption delays.",
  },
  '/subgraphs': {
    basic: "Each subgraph charts different territory. The complexity score tells you how demanding it is to index.",
    deep: "Complexity is scored Light→Extreme based on handler count, entity types, eth_call usage, and block time normalised by chain. Heavy or Extreme subgraphs on fast chains put real pressure on indexer infrastructure.",
  },
  '/poi': {
    basic: "Proof of Indexing. If indexers disagree here, someone's off course.",
    deep: "A POI is a cryptographic hash of an indexer's state at a given block. If two indexers produce different POIs for the same deployment and block, one is indexing incorrectly. Persistent divergence can lead to disputes and slashing.",
  },
  '/leaderboard': {
    basic: "The monthly standings — community votes and protocol metrics, combined.",
    deep: "The leaderboard score blends on-chain metrics with community votes. Delegators with active positions vote with 5× weight. Designed to reward consistent, transparent indexing over raw size.",
  },
  '/calculator': {
    basic: "Run the numbers before you move. Redelegation carries a cost.",
    deep: "The 0.5% delegation tax compounds with the opportunity cost of the 28-day thawing period. The calculator shows the break-even point — how long you need to stay with the new indexer before the switch pays off.",
  },
  '/compare': {
    basic: "Side by side. Useful when you've narrowed it down to two.",
    deep: "Focus on cut rate stability over time, self-stake ratio, and allocation efficiency. A high-performing indexer with a volatile cut history is a risk.",
  },
  '/governance': {
    basic: "The protocol's compass. GIPs shape the rules — worth knowing what's in the water ahead.",
    deep: "GIPs go through Draft → Candidate → Accepted → Deployed. Candidate-stage GIPs are the ones to watch — they'll affect indexer economics within epochs once deployed.",
  },
  '/roadmap': {
    basic: "What's being built and what's next. The Graph moves steadily.",
    deep: "The next major unlocks are on-chain indexing agreements (GIP-0087/0088 still in draft) and a richer rewards model tied to service quality rather than allocation size.",
  },
  '/blog': {
    basic: "Guides and notes from the network's edge.",
    deep: "Practical indexer infrastructure — archive node setup, graph-node configuration, chain lag debugging. Sourced from real conversations in The Graph's community.",
  },
  '/indexing': {
    basic: "Sync progress and health across subgraphs. Useful for indexers keeping watch on their fleet.",
    deep: "If a subgraph is stuck behind chain head, check graph-node logs for eth_call latency or reorg_threshold misconfiguration. On fast chains, the default 250-block reorg threshold keeps you in slow block-walk mode — 50 is usually fine.",
  },
};

const WISDOMS = [
  "Steady as she goes. I'm here if you need your bearings.",
  "The sea doesn't rush. Neither should a good delegation decision.",
  "A lighthouse doesn't chase ships — it simply stays lit.",
  "Every epoch is a new tide. The network keeps turning.",
  "The best indexers are the ones still here in two years.",
  "Fog doesn't mean danger. It just means look more carefully.",
  "Cut rates change. Habits don't. Watch the history.",
  "GRT delegated is GRT at work. Know where it's pointed.",
];

const SUGGESTED_QUESTIONS = [
  "Which indexers have the best APY right now?",
  "What's the network's current state?",
  "Explain the risk score system",
  "How does delegation tax work?",
  "Which indexers are REO eligible?",
  "Is my wallet delegation healthy?",
];

const ONBOARDING_KEY = 'lodestar:lodie-toured';

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

type Mode = 'tip' | 'chat';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
}

export function LodieWidget() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('tip');
  const [depth, setDepth] = useState<0 | 1>(0);
  const [wisdom] = useState(randomWisdom);
  const [toured, setToured] = useState(true);
  const [dataWarning, setDataWarning] = useState<string | null>(null);
  const [walletWarning, setWalletWarning] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const pathname = usePathname();
  const { address: walletAddress } = useAccount();

  // First visit onboarding
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
    setMode('tip');
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

  // Data-aware: indexer detail page
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
          setDataWarning("This indexer takes 100% of indexing rewards. Delegators earn from query fees only.");
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

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input when chat opens
  useEffect(() => {
    if (mode === 'chat' && open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [mode, open]);

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

  const sendMessage = async (text: string) => {
    if (!text.trim() || streaming) return;
    const userMsg: Message = { role: 'user', content: text };
    setMessages((m) => [...m, userMsg, { role: 'assistant', content: '', streaming: true }]);
    setInput('');
    setStreaming(true);

    try {
      const res = await fetch('/api/lodie/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, page: pathname, walletAddress }),
      });

      if (!res.ok || !res.body) throw new Error('Failed');

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let full = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        full += dec.decode(value, { stream: true });
        setMessages((m) => {
          const updated = [...m];
          updated[updated.length - 1] = { role: 'assistant', content: full, streaming: true };
          return updated;
        });
      }

      setMessages((m) => {
        const updated = [...m];
        updated[updated.length - 1] = { role: 'assistant', content: full, streaming: false };
        return updated;
      });
    } catch {
      setMessages((m) => {
        const updated = [...m];
        updated[updated.length - 1] = { role: 'assistant', content: "The lantern flickered. Couldn't get a response — try again.", streaming: false };
        return updated;
      });
    } finally {
      setStreaming(false);
    }
  };

  const pageTip = getPageTip(pathname);
  const mainTip = depth === 1 && pageTip?.deep ? pageTip.deep : (pageTip?.basic ?? wisdom);
  const hasDeep = !!pageTip?.deep;
  const showOnboarding = !toured;
  const showWarning = !showOnboarding && !!dataWarning;
  const showWalletBanner = !showOnboarding && !showWarning && !!walletWarning;

  return (
    <div className="flex fixed z-50 flex-col gap-2 items-end
      right-4 bottom-[calc(var(--bottom-nav-height)+var(--safe-bottom,0px)+72px)]
      lg:right-6 lg:bottom-6">

      {open && (
        <div
          className="bg-[var(--bg-elevated)] border border-[var(--border-mid)] rounded-[var(--radius-card)] shadow-2xl w-80 max-w-[calc(100vw-2rem)] flex flex-col overflow-hidden"
          style={{ animation: 'lodie-panel-in 0.2s ease-out', maxHeight: mode === 'chat' ? '480px' : 'none' }}
        >
          {/* Header */}
          <div className="flex items-center gap-2.5 px-4 pt-4 pb-3 border-b border-[var(--border)] shrink-0">
            <div className="w-8 h-8 rounded-full overflow-hidden bg-[#ddeef5] border border-amber-400/20 shrink-0">
              <Image src="/lodie.png" alt="Lodie" width={32} height={32} className="w-full h-full object-cover object-top scale-110" />
            </div>
            <span className="text-[11px] font-semibold text-[var(--text-faint)] uppercase tracking-widest flex-1">Lodie</span>

            {/* Mode toggle */}
            <div className="flex items-center gap-1 bg-[var(--bg)] rounded-[var(--radius-button)] p-0.5">
              <button
                onClick={() => setMode('tip')}
                className={`px-2 py-0.5 text-[10px] rounded-[5px] transition-colors ${mode === 'tip' ? 'bg-[var(--bg-elevated)] text-[var(--text)]' : 'text-[var(--text-faint)] hover:text-[var(--text)]'}`}
              >
                Guide
              </button>
              <button
                onClick={() => setMode('chat')}
                className={`px-2 py-0.5 text-[10px] rounded-[5px] transition-colors ${mode === 'chat' ? 'bg-[var(--bg-elevated)] text-[var(--text)]' : 'text-[var(--text-faint)] hover:text-[var(--text)]'}`}
              >
                Ask
              </button>
            </div>

            <button
              onClick={() => { setOpen(false); setDepth(0); }}
              className="text-[var(--text-faint)] hover:text-[var(--text)] transition-colors text-xl leading-none shrink-0"
              aria-label="Close"
            >
              &times;
            </button>
          </div>

          {/* ── Tip mode ── */}
          {mode === 'tip' && (
            <div className="p-4">
              {showOnboarding && (
                <p className="text-[12.5px] text-[var(--text-muted)] leading-relaxed">
                  Welcome aboard. I'm Lodie — spirit of this lighthouse. Navigate to any page and I'll tell you what to look for. Press{' '}
                  <kbd className="px-1 py-px rounded bg-[var(--bg)] text-[var(--text-faint)] text-[10px] font-mono">L</kbd>
                  {' '}to summon me anytime, or switch to <strong className="text-[var(--text)]">Ask</strong> to chat.
                </p>
              )}
              {showWarning && (
                <p className="text-[12.5px] text-amber-400 leading-relaxed">{dataWarning}</p>
              )}
              {!showOnboarding && !showWarning && (
                <p className="text-[12.5px] text-[var(--text-muted)] leading-relaxed">{mainTip}</p>
              )}

              {showWalletBanner && (
                <div className="mt-3 pt-3 border-t border-[var(--border)] flex items-start gap-2">
                  <span className="text-amber-400 text-[11px] mt-px">◆</span>
                  <p className="text-[11px] text-amber-400/90 leading-relaxed">{walletWarning}</p>
                </div>
              )}

              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between">
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
                {!showOnboarding && (
                  <button
                    onClick={() => setMode('chat')}
                    className="w-full text-[11px] px-3 py-1.5 rounded-[var(--radius-button)] border border-[var(--border)] bg-[var(--bg)] text-[var(--accent)] hover:opacity-80 transition-opacity text-center"
                  >
                    Chat with Lodie →
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ── Chat mode ── */}
          {mode === 'chat' && (
            <>
              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-[160px]">
                {messages.length === 0 && (
                  <div className="space-y-2">
                    <p className="text-[11px] text-[var(--text-faint)]">Ask me anything about The Graph — or pick a question:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {SUGGESTED_QUESTIONS.map((q) => (
                        <button
                          key={q}
                          onClick={() => sendMessage(q)}
                          className="text-[10.5px] px-2 py-1 rounded-[var(--radius-button)] bg-[var(--bg)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--border-mid)] transition-colors text-left"
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {messages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] rounded-[var(--radius-card)] px-3 py-2 text-[12px] leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-[var(--accent-dim)] text-[var(--text)] border border-[var(--accent)]/20'
                        : 'bg-[var(--bg)] text-[var(--text-muted)] border border-[var(--border)]'
                    }`}>
                      {msg.content || (msg.streaming ? (
                        <span className="flex flex-col gap-1.5">
                          <span className="flex items-center gap-1 py-0.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60 animate-bounce" style={{ animationDelay: '0ms' }} />
                            <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60 animate-bounce" style={{ animationDelay: '150ms' }} />
                            <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60 animate-bounce" style={{ animationDelay: '300ms' }} />
                          </span>
                          <span className="text-[10px] text-[var(--text-faint)] leading-relaxed italic">
                            This might take a while. Please be patient — our budget this month is three times last month&apos;s. (Last month&apos;s budget was $0.)
                          </span>
                        </span>
                      ) : null)}
                      {msg.streaming && msg.content && (
                        <span className="inline-block w-1 h-3 ml-0.5 bg-current opacity-60 animate-pulse" />
                      )}
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              {/* Input */}
              <div className="px-3 pb-3 pt-2 border-t border-[var(--border)] shrink-0">
                <form
                  onSubmit={(e) => { e.preventDefault(); sendMessage(input); }}
                  className="flex gap-2"
                >
                  <input
                    ref={inputRef}
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Ask Lodie anything..."
                    disabled={streaming}
                    className="flex-1 px-3 py-2 text-[12px] bg-[var(--bg)] border border-[var(--border)] rounded-[var(--radius-button)] text-[var(--text)] placeholder-[var(--text-faint)] outline-none focus:ring-1 focus:ring-[var(--accent)] disabled:opacity-50 transition-shadow"
                  />
                  <button
                    type="submit"
                    disabled={!input.trim() || streaming}
                    className="px-3 py-2 bg-[var(--accent)] text-white rounded-[var(--radius-button)] text-[12px] font-medium hover:opacity-90 disabled:opacity-40 transition-opacity shrink-0"
                  >
                    →
                  </button>
                </form>
              </div>
            </>
          )}
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
