'use client';

import { useState, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from './Card';
import { Badge } from './Badge';
import { ProgressBar } from './ProgressBar';
import { weiToGRT, formatGRT, formatPPM, formatPercent, cn } from '@/lib/utils';
import {
  calculateDelegationCapacity,
  calculateDelegatorAPR,
} from '@/lib/rewards';

interface DelegationCalculatorProps {
  indexer: {
    id: string;
    name: string;
    stakedTokens: string;
    delegatedTokens: string;
    indexingRewardCut: number;
    queryFeeCut: number;
    delegatorParameterCooldown: number;
    lastDelegationParameterUpdate: number;
    allocations?: Array<{
      allocatedTokens: string;
      subgraphDeployment: {
        signalledTokens: string;
        stakedTokens: string;
      };
    }>;
  };
  delegationRatio?: number;
  totalNetworkSignal?: number;
  annualIssuance?: number;
}


export function DelegationCalculator({
  indexer,
  delegationRatio = 16,
  totalNetworkSignal = 0,
  annualIssuance = 0,
}: DelegationCalculatorProps) {
  const [delegationAmount, setDelegationAmount] = useState<string>('10000');

  const selfStake = weiToGRT(indexer.stakedTokens);
  const currentDelegated = weiToGRT(indexer.delegatedTokens);
  const newDelegation = parseFloat(delegationAmount) || 0;

  // Calculate capacity
  const capacity = useMemo(
    () => calculateDelegationCapacity(selfStake, currentDelegated, delegationRatio),
    [selfStake, currentDelegated, delegationRatio]
  );

  // Calculate estimated APR using per-allocation signal-weighted rewards (grtinfo method)
  const estimatedAPR = useMemo(
    () => {
      if (!indexer.allocations?.length || totalNetworkSignal === 0 || annualIssuance === 0) return 0;
      return calculateDelegatorAPR(
        indexer.allocations,
        indexer.indexingRewardCut,
        selfStake,
        currentDelegated + newDelegation || currentDelegated || 1,
        totalNetworkSignal,
        annualIssuance
      );
    },
    [indexer.allocations, indexer.indexingRewardCut, currentDelegated, newDelegation, totalNetworkSignal, annualIssuance]
  );

  // Effective cut: what delegators effectively pay, accounting for self-stake in the pool
  // Formula: effectiveCut = 1 - (1 - rawCut) × (selfStake + delegated) / delegated
  const rawCut = indexer.indexingRewardCut / 1_000_000;
  const currentEffectiveCut = useMemo(() => {
    if (currentDelegated <= 0) return null;
    return (1 - (1 - rawCut) * (selfStake + currentDelegated) / currentDelegated) * 100;
  }, [rawCut, selfStake, currentDelegated]);

  const afterEffectiveCut = useMemo(() => {
    const totalDelegated = currentDelegated + newDelegation;
    if (totalDelegated <= 0) return null;
    return (1 - (1 - rawCut) * (selfStake + totalDelegated) / totalDelegated) * 100;
  }, [rawCut, selfStake, currentDelegated, newDelegation]);

  // Check if parameters are locked (cooldown active)
  const now = Math.floor(Date.now() / 1000);
  const cooldownEnd = indexer.lastDelegationParameterUpdate + indexer.delegatorParameterCooldown;
  const isLocked = cooldownEnd > now;
  const lockDaysRemaining = isLocked ? Math.ceil((cooldownEnd - now) / 86400) : 0;

  // Determine if capacity is available
  const wouldExceedCapacity = newDelegation > capacity.availableCapacity;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Delegation Calculator</CardTitle>
          {isLocked && (
            <Badge variant="success">
              Locked {lockDaysRemaining}d
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {/* Indexer summary */}
        <div className="grid grid-cols-3 gap-4 mb-6 p-4 rounded-lg bg-[var(--bg-elevated)]">
          <div>
            <p className="text-xs text-[var(--text-faint)]">Self-Stake</p>
            <p className="text-sm font-mono text-[var(--text)]">{formatGRT(selfStake)} GRT</p>
          </div>
          <div>
            <p className="text-xs text-[var(--text-faint)]">Current Delegated</p>
            <p className="text-sm font-mono text-[var(--text)]">{formatGRT(currentDelegated)} GRT</p>
          </div>
          <div>
            <p className="text-xs text-[var(--text-faint)]">Reward Cut (Raw)</p>
            <p className="text-sm font-mono text-[var(--text)]">{formatPPM(indexer.indexingRewardCut)}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--text-faint)]">Effective Cut (Current)</p>
            <p className={cn('text-sm font-mono', currentEffectiveCut !== null && currentEffectiveCut < 0 ? 'text-[var(--green)]' : 'text-[var(--text)]')}>
              {currentEffectiveCut !== null ? formatPercent(currentEffectiveCut) : '—'}
            </p>
          </div>
          <div>
            <p className="text-xs text-[var(--text-faint)]">Effective Cut (After)</p>
            <p className={cn('text-sm font-mono', afterEffectiveCut !== null && afterEffectiveCut < 0 ? 'text-[var(--green)]' : 'text-[var(--text)]')}>
              {afterEffectiveCut !== null ? formatPercent(afterEffectiveCut) : '—'}
            </p>
          </div>
          <div>
            <p className="text-xs text-[var(--text-faint)]">Query Fee Cut</p>
            <p className="text-sm font-mono text-[var(--text)]">{formatPPM(indexer.queryFeeCut)}</p>
          </div>
        </div>
        {currentEffectiveCut !== null && currentEffectiveCut < 0 && (
          <p className="text-xs text-[var(--green)] -mt-4 mb-6 px-1">
            Negative effective cut = indexer self-stake is subsidising delegator returns
          </p>
        )}

        {/* Capacity indicator */}
        <div className="mb-6">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm text-[var(--text-muted)]">Delegation Capacity</span>
            <span className="text-sm font-mono text-[var(--text)]">
              {formatGRT(capacity.availableCapacity)} GRT available
            </span>
          </div>
          <ProgressBar
            value={capacity.utilizationPercent}
            max={100}
            variant={capacity.utilizationPercent > 90 ? 'orange' : 'teal'}
            size="md"
          />
          <p className="text-xs text-[var(--text-faint)] mt-1">
            {capacity.utilizationPercent.toFixed(1)}% utilized ({delegationRatio}x ratio)
          </p>
        </div>

        {/* Input */}
        <div className="mb-6">
          <label className="block text-sm text-[var(--text-muted)] mb-2">
            Delegation Amount (GRT)
          </label>
          <div className="relative">
            <input
              type="number"
              value={delegationAmount}
              onChange={(e) => setDelegationAmount(e.target.value)}
              placeholder="10000"
              className={cn(
                'w-full px-4 py-3 text-lg font-mono rounded-lg',
                'bg-[var(--bg-elevated)] border',
                wouldExceedCapacity ? 'border-[var(--amber)]' : 'border-[var(--border)]',
                'text-[var(--text)] placeholder:text-[var(--text-faint)]',
                'focus:outline-none focus:border-[var(--accent)]'
              )}
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--text-faint)]">
              GRT
            </span>
          </div>
          {wouldExceedCapacity && (
            <p className="text-xs text-[var(--amber)] mt-1">
              Exceeds available capacity by {formatGRT(newDelegation - capacity.availableCapacity)} GRT
            </p>
          )}
        </div>

        {/* Results */}
        <div className="space-y-4">
          {/* Estimated APR */}
          <div className="p-4 rounded-lg bg-[var(--accent-dim)] border border-[var(--accent-hover)]">
            <div className="flex justify-between items-center">
              <span className="text-sm text-[var(--text-muted)]">Estimated APR</span>
              <span className="text-2xl font-mono font-semibold text-[var(--accent)]">
                {estimatedAPR.toFixed(2)}%
              </span>
            </div>
            <p className="text-xs text-[var(--text-faint)] mt-1">
              Based on current network rewards distribution
            </p>
          </div>

          {/* Rewards breakdown */}
          <div className="p-4 rounded-lg bg-[var(--bg-elevated)]">
            <p className="text-sm text-[var(--text-muted)] mb-3">Annual Rewards Estimate</p>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-sm text-[var(--text-faint)]">After Indexer Cut</span>
                <span className="text-sm font-mono text-[var(--green)]">
                  ~{formatGRT((newDelegation || 1000) * (estimatedAPR / 100))} GRT
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Warning for high cuts */}
        {indexer.indexingRewardCut > 200000 && (
          <div className="mt-4 p-3 rounded-lg bg-[rgba(255,140,66,0.1)] border border-[var(--amber)]">
            <p className="text-sm text-[var(--amber)]">
              <strong>High reward cut:</strong> This indexer takes {formatPPM(indexer.indexingRewardCut)} of indexing rewards.
              Consider comparing with other indexers.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
