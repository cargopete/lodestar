'use client';

import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNetworkStats } from '@/hooks/useNetworkStats';
import { DelegatePanel } from '@/components/ui/DelegatePanel';
import { Card, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { weiToGRT, cn } from '@/lib/utils';
import type { RecommendResponse } from '@/app/api/delegate/recommend/route';
import type { EnrichedIndexer } from '@/lib/enriched';

// ─── Preference sliders ───────────────────────────────────────────────────────

const PREFERENCES = [
  {
    key: 'returns',
    label: 'Best returns',
    description: 'Prioritise high APR and generous reward cuts',
  },
  {
    key: 'stability',
    label: 'Stability',
    description: 'Prefer indexers with unchanged cut parameters',
  },
  {
    key: 'safety',
    label: 'Safety',
    description: 'Favour ample delegation headroom and high self-stake',
  },
  {
    key: 'network',
    label: 'Network contribution',
    description: 'Weight query volume, REO eligibility, and allocation efficiency',
  },
] as const;

type PrefKey = (typeof PREFERENCES)[number]['key'];
type Prefs = Record<PrefKey, number>;

const DEFAULT_PREFS: Prefs = { returns: 5, stability: 5, safety: 5, network: 5 };

// ─── Hooks ────────────────────────────────────────────────────────────────────

function useRecommendation(prefs: Prefs) {
  const params = new URLSearchParams({
    returns:   String(prefs.returns),
    stability: String(prefs.stability),
    safety:    String(prefs.safety),
    network:   String(prefs.network),
  });

  return useQuery<RecommendResponse>({
    queryKey: ['delegate-recommend', prefs],
    queryFn: async () => {
      const res = await fetch(`/api/delegate/recommend?${params}`);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    staleTime: 60_000,
  });
}

function useCandidates(prefs: Prefs, enabled: boolean) {
  const params = new URLSearchParams({
    returns:   String(prefs.returns),
    stability: String(prefs.stability),
    safety:    String(prefs.safety),
    network:   String(prefs.network),
    count:     '8',
  });

  return useQuery<{ candidates: Array<{ indexer: EnrichedIndexer; score: number; reasons: string[] }> }>({
    queryKey: ['delegate-candidates', prefs],
    queryFn: async () => {
      const res = await fetch(`/api/delegate/recommend?${params}`);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    staleTime: 60_000,
    enabled,
  });
}

// ─── Preference slider ────────────────────────────────────────────────────────

function PrefSlider({
  pref,
  value,
  onChange,
}: {
  pref: (typeof PREFERENCES)[number];
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-[var(--text)]">{pref.label}</p>
          <p className="text-[11px] text-[var(--text-faint)]">{pref.description}</p>
        </div>
        <span className="text-xs font-mono text-[var(--text-muted)] w-8 text-right">
          {value === 5 ? '—' : value < 5 ? `−${5 - value}` : `+${value - 5}`}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-[var(--text-faint)]">Less</span>
        <input
          type="range"
          min={0}
          max={10}
          step={1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="flex-1 accent-[var(--accent)] h-1.5 cursor-pointer"
        />
        <span className="text-[10px] text-[var(--text-faint)]">More</span>
      </div>
    </div>
  );
}

// ─── Indexer card ─────────────────────────────────────────────────────────────

function RecommendationCard({
  data,
  onSwap,
}: {
  data: RecommendResponse;
  onSwap: () => void;
}) {
  const { indexer, reasons } = data;
  const name = indexer.ensName ?? indexer.name ?? indexer.id.slice(0, 10) + '…';

  return (
    <div className="p-4 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border)]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-[var(--accent-dim)] flex items-center justify-center flex-shrink-0">
            <span className="text-sm font-bold text-[var(--accent)]">
              {name.slice(0, 2).toUpperCase()}
            </span>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-semibold text-[var(--text)] truncate">{name}</p>
              <Badge variant={
                indexer.scoreGrade === 'A' ? 'success' :
                indexer.scoreGrade === 'B' ? 'accent' :
                indexer.scoreGrade === 'C' ? 'warning' : 'error'
              }>
                {indexer.scoreGrade}
              </Badge>
            </div>
            <p className="text-[11px] font-mono text-[var(--text-faint)] truncate">{indexer.id}</p>
          </div>
        </div>
        <button
          onClick={onSwap}
          className="flex-shrink-0 text-xs text-[var(--accent)] hover:underline whitespace-nowrap"
        >
          change →
        </button>
      </div>

      {reasons.length > 0 && (
        <ul className="mt-3 space-y-1">
          {reasons.map((r) => (
            <li key={r} className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
              <svg className="w-3.5 h-3.5 text-[var(--green)] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
              {r}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Candidate picker ─────────────────────────────────────────────────────────

function CandidatePicker({
  prefs,
  currentId,
  onSelect,
  onClose,
}: {
  prefs: Prefs;
  currentId: string;
  onSelect: (rec: RecommendResponse) => void;
  onClose: () => void;
}) {
  const { data, isLoading } = useCandidates(prefs, true);

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-faint)]">
          Top eligible indexers
        </p>
        <button
          onClick={onClose}
          className="text-xs text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
        >
          ✕
        </button>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-6">
          <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {data?.candidates.map((c) => {
        const name = c.indexer.ensName ?? c.indexer.name ?? c.indexer.id.slice(0, 10) + '…';
        const isActive = c.indexer.id === currentId;
        const apy = c.indexer.rollingAPY30d ?? c.indexer.delegatorAPR;

        return (
          <button
            key={c.indexer.id}
            onClick={() => {
              onSelect({ indexer: c.indexer, score: c.score, reasons: c.reasons });
              onClose();
            }}
            className={cn(
              'w-full flex items-center justify-between px-4 py-3 text-left transition-colors',
              'border-b border-[var(--border)]',
              isActive
                ? 'bg-[var(--accent-dim)]'
                : 'hover:bg-[var(--bg-surface)]',
            )}
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-[var(--bg-surface)] flex items-center justify-center flex-shrink-0">
                <span className="text-xs font-bold text-[var(--text-muted)]">
                  {name.slice(0, 2).toUpperCase()}
                </span>
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-medium text-[var(--text)] truncate">{name}</p>
                  {isActive && (
                    <span className="text-[10px] text-[var(--accent)] font-medium">current</span>
                  )}
                </div>
                <p className="text-[11px] text-[var(--text-faint)]">
                  {apy.toFixed(1)}% APR · {c.indexer.delegationCapacity.utilizationPercent.toFixed(0)}% capacity
                </p>
              </div>
            </div>
            <Badge variant={
              c.indexer.scoreGrade === 'A' ? 'success' :
              c.indexer.scoreGrade === 'B' ? 'accent' :
              c.indexer.scoreGrade === 'C' ? 'warning' : 'error'
            }>
              {c.indexer.scoreGrade}
            </Badge>
          </button>
        );
      })}

      {/* Escape hatch */}
      <a
        href="/indexers"
        className="block px-4 py-3 text-xs text-center text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--bg-surface)] transition-colors"
      >
        None of these? Browse all indexers →
      </a>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DelegatePage() {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [showPrefs, setShowPrefs] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [override, setOverride] = useState<RecommendResponse | null>(null);

  const { data: rec, isLoading, error } = useRecommendation(prefs);
  const { data: networkData } = useNetworkStats();

  // Use manual override if set, otherwise use recommendation
  const active = override ?? rec;

  const network = networkData?.graphNetwork;
  const delegationRatio = network?.delegationRatio ?? 16;
  const totalNetworkSignal = network?.totalTokensSignalled ? weiToGRT(network.totalTokensSignalled) : 0;
  const annualIssuance = network?.networkGRTIssuancePerBlock
    ? weiToGRT(network.networkGRTIssuancePerBlock) * 2628000
    : 0;

  const setPref = useCallback((key: PrefKey, value: number) => {
    setPrefs((p) => ({ ...p, [key]: value }));
    setOverride(null); // clear manual override when prefs change
  }, []);

  const resetPrefs = useCallback(() => {
    setPrefs(DEFAULT_PREFS);
    setOverride(null);
  }, []);

  const isDefaultPrefs = PREFERENCES.every((p) => prefs[p.key] === 5);

  return (
    <div className="max-w-xl mx-auto space-y-5 px-4 py-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-[var(--text)]">Delegate GRT</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          We pick the best indexer for you. Connect your wallet, enter an amount, and confirm.
        </p>
      </div>

      {/* Recommendation */}
      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {error && (
        <Card>
          <CardContent className="py-6 text-center">
            <p className="text-sm text-[var(--text-muted)]">
              Could not load recommendation — indexer data may still be warming up.
            </p>
          </CardContent>
        </Card>
      )}

      {active && !isLoading && (
        <>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)] mb-2">
              {override ? 'Selected indexer' : 'Recommended indexer'}
            </p>
            <RecommendationCard
              data={active}
              onSwap={() => { setShowPicker((v) => !v); setShowPrefs(false); }}
            />
          </div>

          {/* Candidate picker */}
          {showPicker && (
            <CandidatePicker
              prefs={prefs}
              currentId={active.indexer.id}
              onSelect={(c) => setOverride(c)}
              onClose={() => setShowPicker(false)}
            />
          )}

          {/* Customise / escape hatch — below the card */}
          {!showPicker && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <button
                onClick={() => { setShowPrefs((v) => !v); }}
                className="flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
              >
                <svg className={cn('w-3 h-3 transition-transform', showPrefs && 'rotate-90')} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
                {showPrefs ? 'Hide preferences' : 'Customise selection'}
                {!isDefaultPrefs && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-[var(--accent-dim)] text-[var(--accent)]">
                    custom
                  </span>
                )}
              </button>
              <span className="text-[var(--border)] text-xs">·</span>
              <a href="/indexers" className="text-xs text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors">
                Browse all indexers
              </a>
            </div>
          )}

          {/* Preferences sliders */}
          {showPrefs && !showPicker && (
            <div className="p-4 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border)] space-y-4">
              {PREFERENCES.map((pref) => (
                <PrefSlider
                  key={pref.key}
                  pref={pref}
                  value={prefs[pref.key]}
                  onChange={(v) => setPref(pref.key, v)}
                />
              ))}
              {!isDefaultPrefs && (
                <button
                  onClick={resetPrefs}
                  className="text-xs text-[var(--text-faint)] hover:text-[var(--text-muted)] transition-colors"
                >
                  Reset to defaults
                </button>
              )}
            </div>
          )}

          {/* Delegate panel */}
          <DelegatePanel
            indexer={{
              id: active.indexer.id,
              name: active.indexer.ensName ?? active.indexer.name,
              stakedTokens: active.indexer.stakedTokens,
              lockedTokens: active.indexer.lockedTokens,
              delegatedTokens: active.indexer.delegatedTokens,
              indexingRewardCut: active.indexer.indexingRewardCut,
            }}
            riskGrade={active.indexer.scoreGrade}
            reoEligible={active.indexer.reoStatus === 'eligible'}
            delegationRatio={delegationRatio}
            totalNetworkSignal={totalNetworkSignal}
            annualIssuance={annualIssuance}
          />
        </>
      )}

      {/* How it works */}
      <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]">
        <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">How delegation works</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            {
              n: '1',
              title: 'Approve & Delegate',
              body: 'First delegation needs two transactions. After that, just one. No protocol tax since Horizon.',
            },
            {
              n: '2',
              title: 'Earn Rewards',
              body: 'Rewards accrue automatically as the indexer closes allocations.',
            },
            {
              n: '3',
              title: 'Undelegate',
              body: '28-day thawing period to withdraw. Manage positions from your portfolio.',
            },
          ].map(({ n, title, body }) => (
            <div key={n} className="flex gap-3">
              <span className="w-6 h-6 rounded-full bg-[var(--accent-dim)] flex items-center justify-center flex-shrink-0 text-xs font-bold text-[var(--accent)]">
                {n}
              </span>
              <div>
                <p className="text-sm font-medium text-[var(--text)]">{title}</p>
                <p className="text-[11px] text-[var(--text-faint)]">{body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
