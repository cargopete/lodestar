'use client';

import { useMemo, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { useAprProvenance } from '@/hooks/useNetworkStats';
import { calculateDelegatorAPRBreakdown } from '@/lib/rewards';
import { weiToGRT, formatGRT, formatPPM, shortenAddress, cn } from '@/lib/utils';
import type { ProvenanceEvent } from '@/lib/api';

interface AprProvenancePanelProps {
  address: string;
  delegatedTokensWei: string;
  delegatedThawingTokensWei: string;
  allocations: Array<{
    allocatedTokens: string;
    subgraphDeployment: { signalledTokens: string; stakedTokens: string };
  }>;
  indexingRewardCutPPM: number;
  indexingRewardEffectiveCut?: string | null;
  ownStakeRatio?: string | null;
  totalNetworkSignal: number;
  annualIssuance: number;
  /** Protocol-enforced cooldown between delegation-parameter changes (seconds) */
  delegatorParameterCooldown: number;
  /** Unix seconds of the indexer's last delegation-parameter change */
  lastDelegationParameterUpdate: number;
  /** Mount-stable "now" in seconds, passed from the page to keep render pure */
  nowSec: number;
}

/**
 * Delegation-parameter cooldown status — the lock window during which an
 * indexer can't change its cut again. A caveat about term stability, not a
 * return metric. Returns null when there's nothing noteworthy to surface.
 */
function cooldownNote(
  cooldown: number,
  lastUpdate: number,
  nowSec: number,
): { text: string; tone: 'up' | 'neutral' | 'down' } | null {
  // Anything before the network existed (~Sept 2020) is a zero/sentinel value —
  // the indexer has no recorded parameter change, so don't invent a 50-year "stable" claim.
  const NETWORK_GENESIS = 1_600_000_000;
  if (!lastUpdate || lastUpdate < NETWORK_GENESIS) return null;
  const daysSince = Math.floor((nowSec - lastUpdate) / 86400);
  const cooldownDays = cooldown / 86400;
  const isLocked = cooldown > 0 && nowSec - lastUpdate < cooldown;
  if (isLocked) {
    const remaining = Math.max(1, Math.ceil(cooldownDays - (nowSec - lastUpdate) / 86400));
    return {
      text: `Cut locked for ${remaining}d (cooldown) · last changed ${daysSince}d ago — terms can't change until then`,
      tone: 'up',
    };
  }
  if (daysSince <= 30) {
    return { text: `Cut changed ${daysSince}d ago — recheck before delegating`, tone: 'down' };
  }
  return { text: `Cut stable — unchanged for ${daysSince}d`, tone: 'neutral' };
}

function fmtPpmFromValue(v: number | null | undefined): string {
  if (v == null) return '—';
  // parameter_changes stores cut values in PPM (1,000,000 = 100%)
  return formatPPM(v);
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const days = Math.floor((now - then) / 86400000);
  if (days <= 0) {
    const hours = Math.floor((now - then) / 3600000);
    return hours <= 0 ? 'just now' : `${hours}h ago`;
  }
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function eventSentence(e: ProvenanceEvent): { text: string; tone: 'down' | 'up' | 'neutral' } {
  const who = e.delegatorName || (e.delegator ? shortenAddress(e.delegator) : 'a delegator');
  const amount = e.tokensGRT != null ? `${formatGRT(e.tokensGRT)} GRT` : '';
  switch (e.kind) {
    case 'undelegation':
      return { text: `${who} undelegated ${amount} — moved to the thawing pool, no longer earning`, tone: 'down' };
    case 'delegation':
      return { text: `${who} delegated ${amount} — added to the active earning base`, tone: 'up' };
    case 'withdrawal':
      return { text: `${who} withdrew ${amount} of fully-thawed stake`, tone: 'neutral' };
    case 'reward_cut':
      return {
        text: `Indexing reward cut changed ${fmtPpmFromValue(e.oldValue)} → ${fmtPpmFromValue(e.newValue)}`,
        tone: (e.oldValue ?? 0) > (e.newValue ?? 0) ? 'up' : 'down',
      };
    case 'query_fee_cut':
      return {
        text: `Query fee cut changed ${fmtPpmFromValue(e.oldValue)} → ${fmtPpmFromValue(e.newValue)}`,
        tone: 'neutral',
      };
    default:
      return { text: 'Parameter changed', tone: 'neutral' };
  }
}

export function AprProvenancePanel({
  address,
  delegatedTokensWei,
  delegatedThawingTokensWei,
  allocations,
  indexingRewardCutPPM,
  indexingRewardEffectiveCut,
  ownStakeRatio,
  totalNetworkSignal,
  annualIssuance,
  delegatorParameterCooldown,
  lastDelegationParameterUpdate,
  nowSec,
}: AprProvenancePanelProps) {
  const { data, isLoading } = useAprProvenance(address);
  const [showEvents, setShowEvents] = useState(false);
  const cooldown = cooldownNote(delegatorParameterCooldown, lastDelegationParameterUpdate, nowSec);

  const breakdown = useMemo(() => {
    const delegated = weiToGRT(delegatedTokensWei);
    const thawing = weiToGRT(delegatedThawingTokensWei || '0');
    const activeBase = delegated - thawing;
    const effCut = indexingRewardEffectiveCut != null ? parseFloat(indexingRewardEffectiveCut) : null;
    const own = ownStakeRatio != null ? parseFloat(ownStakeRatio) : null;
    const delegatedStakeRatio = own != null && own >= 0 && own <= 1 ? 1 - own : null;
    return {
      delegated,
      thawing,
      ...calculateDelegatorAPRBreakdown(
        allocations,
        indexingRewardCutPPM,
        activeBase,
        totalNetworkSignal,
        annualIssuance,
        effCut,
        delegatedStakeRatio,
      ),
    };
  }, [delegatedTokensWei, delegatedThawingTokensWei, allocations, indexingRewardCutPPM, indexingRewardEffectiveCut, ownStakeRatio, totalNetworkSignal, annualIssuance]);

  const { delegated, thawing, annualDelegatorRewards, activeBase, rawCut, effectiveCut, apr, aprUncapped } = breakdown;
  const thawingPct = delegated > 0 ? (thawing / delegated) * 100 : 0;
  // Only surface the uncapped figure when the P95 clamp actually moved the number.
  const clampMatters = aprUncapped - apr > 0.1;
  // Genuine over-delegation = the delegation-ratio cap bites, i.e. the delegator
  // share drops below the naive (1 − rawCut). effective < raw on its own is the
  // NORMAL case (indexer with low self-stake ratio), not over-delegation.
  const ownRatioNum = ownStakeRatio != null ? parseFloat(ownStakeRatio) : null;
  const delStakeRatio = ownRatioNum != null && ownRatioNum >= 0 && ownRatioNum <= 1 ? 1 - ownRatioNum : null;
  const delegatorFraction = delStakeRatio != null ? delStakeRatio * (1 - effectiveCut) : 1 - rawCut;
  const overDelegated = delegatorFraction < 1 - rawCut - 0.005;
  // A negative effective cut is legitimate (high self-stake offsets the cut) but
  // reads oddly, so display it as 0% while the maths keeps the real value.
  const negativeEffCut = effectiveCut < 0;
  const displayEffCut = Math.max(0, effectiveCut);
  const cutSub = negativeEffCut
    ? `Raw ${(rawCut * 100).toFixed(1)}% nominal · effectively ~0% — high self-stake offsets the cut, so delegators keep their full delegated-stake share`
    : overDelegated
      ? `Raw ${(rawCut * 100).toFixed(1)}% · effective ${(effectiveCut * 100).toFixed(1)}% — over-delegated, so some delegated stake earns nothing`
      : `Raw ${(rawCut * 100).toFixed(1)}% set by indexer · ${(effectiveCut * 100).toFixed(1)}% effective on delegated-stake rewards`;
  const reconcile = data?.reconcile ?? null;
  const events = data?.events ?? [];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle>APR Provenance</CardTitle>
          {reconcile ? (
            <span
              className={cn(
                'inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-full border',
                reconcile.verified
                  ? 'text-[var(--green)] border-[var(--green)] bg-[var(--green-dim)]'
                  : 'text-[var(--amber)] border-[var(--amber)] bg-[var(--amber-dim)]',
              )}
              title={
                reconcile.verified
                  ? 'On-chain getDelegationPool matches the subgraph block-for-block'
                  : `Subgraph trails the chain by ${formatGRT(Math.abs(reconcile.driftGRT))} GRT (${(reconcile.driftPct * 100).toFixed(2)}%) — likely indexing lag`
              }
            >
              {reconcile.verified ? (
                <>
                  <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0l-3.5-3.5a1 1 0 011.4-1.4l2.8 2.79 6.8-6.79a1 1 0 011.4 0z" clipRule="evenodd" /></svg>
                  Chain-verified
                </>
              ) : (
                <>⚠ Subgraph lagging chain</>
              )}
            </span>
          ) : null}
        </div>
        <p className="text-xs text-[var(--text-muted)] mt-1">
          The headline APR, decomposed — and every event that moved it. No black box.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Decomposition — show your working */}
        <div className="rounded-lg border border-[var(--border)] divide-y divide-[var(--border)]">
          <ProvRow
            label="Annualized delegator rewards"
            sub="Signal-weighted across active allocations, P95-capped, after the indexer's cut"
            value={`${formatGRT(annualDelegatorRewards)} GRT`}
          />
          <ProvRow
            label="÷ Active earning base"
            sub={`${formatGRT(delegated)} delegated − ${formatGRT(thawing)} thawing`}
            value={`${formatGRT(activeBase)} GRT`}
            warn={thawing > 0}
          />
          <ProvRow
            label="Cut applied"
            sub={cutSub}
            value={`${(displayEffCut * 100).toFixed(1)}%`}
          />
          <div className="flex items-center justify-between px-4 py-3 bg-[var(--bg-elevated)]">
            <span className="text-sm font-semibold text-[var(--text)]">= Delegator APR</span>
            <span className="flex items-baseline gap-2">
              <span
                className="text-lg font-semibold font-mono text-[var(--accent)]"
                title="Per-allocation signal-to-stake ratios clamped to the P95 of this indexer's allocations, so one tiny-stake/high-signal subgraph can't run away with the estimate."
              >
                {apr.toFixed(2)}%
              </span>
              {clampMatters && (
                <span
                  className="text-[11px] font-mono text-[var(--text-faint)]"
                  title="The same projection without the P95 clamp — the raw run-rate. Other dashboards pick different percentiles (95/99/100), which is the main source of cross-dashboard divergence."
                >
                  · {aprUncapped.toFixed(2)}% uncapped
                </span>
              )}
            </span>
          </div>
        </div>

        {/* Active vs thawing breakdown */}
        {delegated > 0 && (
          <div>
            <div className="flex items-center justify-between text-[11px] text-[var(--text-faint)] mb-1.5">
              <span>Delegation pool composition</span>
              {thawing > 0 && (
                <span className="text-[var(--amber)]">{thawingPct.toFixed(1)}% thawing (excluded from APR)</span>
              )}
            </div>
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-[var(--bg-elevated)]">
              <div
                className="bg-[var(--green)]"
                style={{ width: `${Math.max(0, 100 - thawingPct)}%` }}
                title={`Active / earning: ${formatGRT(activeBase)} GRT`}
              />
              <div
                className="bg-[var(--amber)]"
                style={{ width: `${thawingPct}%` }}
                title={`Thawing (incl. fully-thawed-not-withdrawn): ${formatGRT(thawing)} GRT`}
              />
            </div>
            <div className="flex items-center gap-4 mt-2 text-[11px] text-[var(--text-muted)]">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[var(--green)]" /> Active {formatGRT(activeBase)} GRT
              </span>
              {thawing > 0 && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[var(--amber)]" /> Thawing {formatGRT(thawing)} GRT
                </span>
              )}
            </div>
          </div>
        )}

        {/* Cooldown / parameter-stability note */}
        {cooldown && (
          <div className="flex items-start gap-2 text-[11px]">
            <span
              className={cn(
                'mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0',
                cooldown.tone === 'up' ? 'bg-[var(--green)]' : cooldown.tone === 'down' ? 'bg-[var(--amber)]' : 'bg-[var(--text-faint)]',
              )}
            />
            <span className="text-[var(--text-muted)] leading-relaxed">{cooldown.text}</span>
          </div>
        )}

        {/* Why did it change — event trail, collapsed by default */}
        <div className="border-t border-[var(--border)] pt-3">
          <button
            type="button"
            onClick={() => setShowEvents((v) => !v)}
            aria-expanded={showEvents}
            className="flex w-full items-center justify-between gap-2 text-sm font-medium text-[var(--text)] hover:text-[var(--accent)] transition-colors"
          >
            <span>
              Why did it change?
              {!isLoading && events.length > 0 && (
                <span className="ml-2 text-[11px] font-normal text-[var(--text-faint)]">
                  {events.length} event{events.length !== 1 ? 's' : ''}
                </span>
              )}
            </span>
            <svg
              className={cn('w-4 h-4 flex-shrink-0 transition-transform', showEvents && 'rotate-180')}
              viewBox="0 0 20 20" fill="currentColor"
            >
              <path fillRule="evenodd" d="M5.3 7.3a1 1 0 011.4 0L10 10.6l3.3-3.3a1 1 0 111.4 1.4l-4 4a1 1 0 01-1.4 0l-4-4a1 1 0 010-1.4z" clipRule="evenodd" />
            </svg>
          </button>
          {showEvents && (
            <div className="mt-3">
              {isLoading ? (
                <p className="text-xs text-[var(--text-faint)]">Loading event trail…</p>
              ) : events.length === 0 ? (
                <p className="text-xs text-[var(--text-faint)]">
                  No recent delegation or parameter activity on record.
                </p>
              ) : (
                <ul className="space-y-2">
                  {events.map((e, i) => {
                    const { text, tone } = eventSentence(e);
                    return (
                      <li key={i} className="flex items-start gap-2.5 text-xs">
                        <span
                          className={cn(
                            'mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0',
                            tone === 'down' ? 'bg-[var(--red)]' : tone === 'up' ? 'bg-[var(--green)]' : 'bg-[var(--text-faint)]',
                          )}
                        />
                        <span className="text-[var(--text-muted)] leading-relaxed">{text}</span>
                        <span className="ml-auto text-[var(--text-faint)] whitespace-nowrap">{timeAgo(e.timestamp)}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ProvRow({
  label,
  sub,
  value,
  warn,
}: {
  label: string;
  sub: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3">
      <div>
        <p className="text-sm text-[var(--text)]">{label}</p>
        <p className={cn('text-[11px] mt-0.5', warn ? 'text-[var(--amber)]' : 'text-[var(--text-faint)]')}>{sub}</p>
      </div>
      <span className="text-sm font-mono text-[var(--text)] whitespace-nowrap">{value}</span>
    </div>
  );
}
