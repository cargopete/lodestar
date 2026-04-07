'use client';

import { useState, useCallback, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useNetworkStats } from '@/hooks/useNetworkStats';
import { DelegatePanel } from '@/components/ui/DelegatePanel';
import { Card, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { weiToGRT, cn } from '@/lib/utils';
import type { RecommendResponse } from '@/app/api/delegate/recommend/route';

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

// ─── Recommendation hook ──────────────────────────────────────────────────────

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

// ─── Preference slider component ─────────────────────────────────────────────

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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DelegatePage() {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [showPrefs, setShowPrefs] = useState(false);
  const [showSwap, setShowSwap] = useState(false);

  const { data: rec, isLoading, error } = useRecommendation(prefs);
  const { data: networkData } = useNetworkStats();

  const network = networkData?.graphNetwork;
  const delegationRatio = network?.delegationRatio ?? 16;
  const totalNetworkSignal = network?.totalTokensSignalled ? weiToGRT(network.totalTokensSignalled) : 0;
  const annualIssuance = network?.networkGRTIssuancePerBlock
    ? weiToGRT(network.networkGRTIssuancePerBlock) * 2628000
    : 0;

  const setPref = useCallback((key: PrefKey, value: number) => {
    setPrefs((p) => ({ ...p, [key]: value }));
  }, []);

  const resetPrefs = useCallback(() => setPrefs(DEFAULT_PREFS), []);

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

      {/* Preferences toggle */}
      <div>
        <button
          onClick={() => setShowPrefs((v) => !v)}
          className="flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
        >
          <svg
            className={cn('w-3.5 h-3.5 transition-transform', showPrefs && 'rotate-90')}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
          {showPrefs ? 'Hide preferences' : 'Customise selection'}
          {!isDefaultPrefs && (
            <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-[var(--accent-dim)] text-[var(--accent)]">
              custom
            </span>
          )}
        </button>

        {showPrefs && (
          <div className="mt-3 p-4 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border)] space-y-4">
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

      {rec && !isLoading && (
        <>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)] mb-2">
              Recommended indexer
            </p>
            <RecommendationCard data={rec} onSwap={() => setShowSwap((v) => !v)} />
          </div>

          {/* Manual swap: link to directory */}
          {showSwap && (
            <div className="p-3 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-[var(--text-muted)]">
              Want a different indexer?{' '}
              <Link href="/indexers" className="text-[var(--accent)] hover:underline">
                Browse the directory
              </Link>{' '}
              and click Delegate on any indexer profile.
            </div>
          )}

          {/* Delegate panel */}
          <DelegatePanel
            indexer={{
              id: rec.indexer.id,
              name: rec.indexer.ensName ?? rec.indexer.name,
              stakedTokens: rec.indexer.stakedTokens,
              lockedTokens: rec.indexer.lockedTokens,
              delegatedTokens: rec.indexer.delegatedTokens,
              indexingRewardCut: rec.indexer.indexingRewardCut,
            }}
            riskGrade={rec.indexer.scoreGrade}
            reoEligible={rec.indexer.reoStatus === 'eligible'}
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
