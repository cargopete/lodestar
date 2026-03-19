'use client';

import { useState, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from './Card';
import { Badge } from './Badge';
import { ProgressBar } from './ProgressBar';
import { weiToGRT, formatGRT, formatUSD, formatPPM, shortenAddress, cn } from '@/lib/utils';
import { calculateEstimatedAPR } from '@/lib/rewards';

interface IndexerOption {
  id: string;
  name: string;
  stakedTokens: string;
  delegatedTokens: string;
  indexingRewardCut: number;
}

interface RedelegationCalculatorProps {
  currentIndexer: IndexerOption;
  targetIndexer: IndexerOption;
  delegationAmount: number;
  grtPrice: number;
  thawingPeriodDays?: number;
  delegationRatio?: number;
  networkRewardsPerYear?: number;
}

interface CalculationResult {
  // Rewards comparison
  currentAPR: number;
  targetAPR: number;
  aprDifference: number;

  // Costs
  rewardsLostDuringThaw: number;
  gasCostEstimate: number;
  totalSwitchCost: number;

  // Projections
  dailyRewardsCurrent: number;
  dailyRewardsTarget: number;
  dailyGain: number;

  // Break-even
  breakEvenDays: number;
  netGain30Days: number;
  netGain90Days: number;
  netGain180Days: number;

  // Recommendation
  shouldSwitch: boolean;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

function calculateRedelegation(
  currentIndexer: IndexerOption,
  targetIndexer: IndexerOption,
  delegationAmount: number,
  grtPrice: number,
  thawingPeriodDays: number,
  delegationRatio: number,
  networkRewardsPerYear: number
): CalculationResult {
  const currentSelfStake = weiToGRT(currentIndexer.stakedTokens);
  const currentDelegated = weiToGRT(currentIndexer.delegatedTokens);
  const targetSelfStake = weiToGRT(targetIndexer.stakedTokens);
  const targetDelegated = weiToGRT(targetIndexer.delegatedTokens);

  // Calculate APRs
  const currentTotalStake = currentSelfStake + currentDelegated;
  const targetTotalStake = targetSelfStake + targetDelegated;

  const currentIndexerRewards = (currentTotalStake / 3000000000) * networkRewardsPerYear;
  const targetIndexerRewards = (targetTotalStake / 3000000000) * networkRewardsPerYear;

  const currentAPR = calculateEstimatedAPR(
    currentIndexerRewards,
    currentIndexer.indexingRewardCut,
    currentSelfStake,
    currentDelegated,
    delegationAmount
  );

  const targetAPR = calculateEstimatedAPR(
    targetIndexerRewards,
    targetIndexer.indexingRewardCut,
    targetSelfStake,
    targetDelegated + delegationAmount, // Add your delegation to target
    delegationAmount
  );

  const aprDifference = targetAPR - currentAPR;

  // Daily rewards
  const dailyRewardsCurrent = (delegationAmount * (currentAPR / 100)) / 365;
  const dailyRewardsTarget = (delegationAmount * (targetAPR / 100)) / 365;
  const dailyGain = dailyRewardsTarget - dailyRewardsCurrent;

  // Rewards lost during thawing (no rewards during this period)
  const rewardsLostDuringThaw = dailyRewardsCurrent * thawingPeriodDays;

  // Gas cost estimate (undelegate + delegate on Arbitrum)
  // Roughly 0.0001-0.001 ETH per tx on Arbitrum, using conservative estimate
  const gasPerTxGRT = 0.5; // ~$0.01-0.02 worth of GRT for gas
  const gasCostEstimate = gasPerTxGRT * 2; // Two transactions

  const totalSwitchCost = rewardsLostDuringThaw + gasCostEstimate;

  // Break-even calculation
  const breakEvenDays = dailyGain > 0 ? Math.ceil(totalSwitchCost / dailyGain) : Infinity;

  // Net gain projections (after break-even)
  const netGain30Days = dailyGain > 0 ? (dailyGain * 30) - totalSwitchCost : -(totalSwitchCost + Math.abs(dailyGain) * 30);
  const netGain90Days = dailyGain > 0 ? (dailyGain * 90) - totalSwitchCost : -(totalSwitchCost + Math.abs(dailyGain) * 90);
  const netGain180Days = dailyGain > 0 ? (dailyGain * 180) - totalSwitchCost : -(totalSwitchCost + Math.abs(dailyGain) * 180);

  // Recommendation logic
  let shouldSwitch = false;
  let confidence: 'high' | 'medium' | 'low' = 'low';
  let reason = '';

  if (aprDifference <= 0) {
    shouldSwitch = false;
    confidence = 'high';
    reason = 'Target indexer has lower or equal APR. No benefit to switching.';
  } else if (breakEvenDays <= 30) {
    shouldSwitch = true;
    confidence = 'high';
    reason = `Break-even in ${breakEvenDays} days. Strong opportunity.`;
  } else if (breakEvenDays <= 60) {
    shouldSwitch = true;
    confidence = 'medium';
    reason = `Break-even in ${breakEvenDays} days. Reasonable opportunity if you plan to hold long-term.`;
  } else if (breakEvenDays <= 90) {
    shouldSwitch = false;
    confidence = 'medium';
    reason = `Break-even takes ${breakEvenDays} days. Consider waiting for a better opportunity.`;
  } else {
    shouldSwitch = false;
    confidence = 'high';
    reason = `Break-even takes ${breakEvenDays === Infinity ? '∞' : breakEvenDays} days. Not recommended.`;
  }

  return {
    currentAPR,
    targetAPR,
    aprDifference,
    rewardsLostDuringThaw,
    gasCostEstimate,
    totalSwitchCost,
    dailyRewardsCurrent,
    dailyRewardsTarget,
    dailyGain,
    breakEvenDays,
    netGain30Days,
    netGain90Days,
    netGain180Days,
    shouldSwitch,
    confidence,
    reason,
  };
}

export function RedelegationCalculator({
  currentIndexer,
  targetIndexer,
  delegationAmount,
  grtPrice,
  thawingPeriodDays = 28,
  delegationRatio = 16,
  networkRewardsPerYear = 300000000,
}: RedelegationCalculatorProps) {
  const result = useMemo(
    () =>
      calculateRedelegation(
        currentIndexer,
        targetIndexer,
        delegationAmount,
        grtPrice,
        thawingPeriodDays,
        delegationRatio,
        networkRewardsPerYear
      ),
    [currentIndexer, targetIndexer, delegationAmount, grtPrice, thawingPeriodDays, delegationRatio, networkRewardsPerYear]
  );

  const confidenceColors = {
    high: 'var(--green)',
    medium: 'var(--amber)',
    low: 'var(--text-faint)',
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Should I Switch?</CardTitle>
          <Badge variant={result.shouldSwitch ? 'success' : 'error'}>
            {result.shouldSwitch ? 'Yes' : 'No'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {/* Indexer comparison header */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="p-4 rounded-lg bg-[var(--bg-elevated)] border-l-4 border-[var(--text-faint)]">
            <p className="text-xs text-[var(--text-faint)] mb-1">Current</p>
            <p className="font-semibold text-[var(--text)]">{currentIndexer.name}</p>
            <p className="text-sm font-mono text-[var(--accent)]">{result.currentAPR.toFixed(2)}% APR</p>
          </div>
          <div className="p-4 rounded-lg bg-[var(--bg-elevated)] border-l-4 border-[var(--accent)]">
            <p className="text-xs text-[var(--text-faint)] mb-1">Target</p>
            <p className="font-semibold text-[var(--text)]">{targetIndexer.name}</p>
            <p className="text-sm font-mono text-[var(--accent)]">{result.targetAPR.toFixed(2)}% APR</p>
          </div>
        </div>

        {/* APR difference */}
        <div className="mb-6 p-4 rounded-lg bg-[var(--accent-dim)] border border-[var(--accent-hover)]">
          <div className="flex justify-between items-center">
            <span className="text-sm text-[var(--text-muted)]">APR Difference</span>
            <span
              className={cn(
                'text-xl font-mono font-semibold',
                result.aprDifference > 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'
              )}
            >
              {result.aprDifference > 0 ? '+' : ''}{result.aprDifference.toFixed(2)}%
            </span>
          </div>
        </div>

        {/* Costs breakdown */}
        <div className="mb-6">
          <h4 className="text-sm font-medium text-[var(--text)] mb-3">Switch Costs</h4>
          <div className="space-y-2">
            <div className="flex justify-between items-center py-2 border-b border-[var(--border)]">
              <span className="text-sm text-[var(--text-muted)]">
                Rewards lost during {thawingPeriodDays}-day thaw
              </span>
              <span className="font-mono text-[var(--amber)]">
                -{formatGRT(result.rewardsLostDuringThaw)} GRT
              </span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-[var(--border)]">
              <span className="text-sm text-[var(--text-muted)]">Estimated gas (2 txs)</span>
              <span className="font-mono text-[var(--text)]">
                ~{formatGRT(result.gasCostEstimate)} GRT
              </span>
            </div>
            <div className="flex justify-between items-center py-2">
              <span className="text-sm font-medium text-[var(--text)]">Total Switch Cost</span>
              <span className="font-mono font-semibold text-[var(--amber)]">
                {formatGRT(result.totalSwitchCost)} GRT
              </span>
            </div>
          </div>
        </div>

        {/* Break-even */}
        <div className="mb-6 p-4 rounded-lg bg-[var(--bg-elevated)]">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm text-[var(--text-muted)]">Break-even Period</span>
            <span className="text-lg font-mono font-semibold text-[var(--text)]">
              {result.breakEvenDays === Infinity ? '∞' : `${result.breakEvenDays} days`}
            </span>
          </div>
          {result.breakEvenDays !== Infinity && result.breakEvenDays > 0 && (
            <ProgressBar
              value={Math.min(result.breakEvenDays, 90)}
              max={90}
              variant={result.breakEvenDays <= 30 ? 'teal' : result.breakEvenDays <= 60 ? 'orange' : 'accent'}
              size="sm"
            />
          )}
          <p className="text-xs text-[var(--text-faint)] mt-2">
            Daily gain: {result.dailyGain > 0 ? '+' : ''}{formatGRT(result.dailyGain)} GRT/day
          </p>
        </div>

        {/* Projections */}
        <div className="mb-6">
          <h4 className="text-sm font-medium text-[var(--text)] mb-3">Net Gain Projections</h4>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: '30 Days', value: result.netGain30Days },
              { label: '90 Days', value: result.netGain90Days },
              { label: '180 Days', value: result.netGain180Days },
            ].map((proj) => (
              <div key={proj.label} className="p-3 rounded-lg bg-[var(--bg-elevated)] text-center">
                <p className="text-xs text-[var(--text-faint)]">{proj.label}</p>
                <p
                  className={cn(
                    'text-sm font-mono font-semibold',
                    proj.value > 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'
                  )}
                >
                  {proj.value > 0 ? '+' : ''}{formatGRT(proj.value)}
                </p>
                <p className="text-xs text-[var(--text-faint)]">
                  {formatUSD(proj.value * grtPrice)}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Recommendation */}
        <div
          className={cn(
            'p-4 rounded-lg border',
            result.shouldSwitch
              ? 'bg-[rgba(0,201,160,0.1)] border-[var(--green)]'
              : 'bg-[rgba(239,68,68,0.1)] border-red-400'
          )}
        >
          <div className="flex items-start gap-3">
            <div
              className={cn(
                'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0',
                result.shouldSwitch ? 'bg-[var(--green)]' : 'bg-red-400'
              )}
            >
              {result.shouldSwitch ? (
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              )}
            </div>
            <div>
              <p className="font-semibold text-[var(--text)]">
                {result.shouldSwitch ? 'Switching is recommended' : 'Stay with current indexer'}
              </p>
              <p className="text-sm text-[var(--text-muted)] mt-1">{result.reason}</p>
              <p className="text-xs mt-2" style={{ color: confidenceColors[result.confidence] }}>
                Confidence: {result.confidence}
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Standalone page component
interface RedelegationPageProps {
  indexers: IndexerOption[];
  userDelegations?: Array<{
    indexerId: string;
    amount: number;
  }>;
  grtPrice: number;
}

export function RedelegationPage({
  indexers,
  userDelegations = [],
  grtPrice,
}: RedelegationPageProps) {
  const [currentIndexerId, setCurrentIndexerId] = useState<string>(
    userDelegations[0]?.indexerId || indexers[0]?.id || ''
  );
  const [targetIndexerId, setTargetIndexerId] = useState<string>(
    indexers[1]?.id || ''
  );
  const [amount, setAmount] = useState<string>(
    userDelegations[0]?.amount.toString() || '10000'
  );

  const currentIndexer = indexers.find((i) => i.id === currentIndexerId);
  const targetIndexer = indexers.find((i) => i.id === targetIndexerId);

  if (!currentIndexer || !targetIndexer) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-[var(--text-muted)]">Select two indexers to compare</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Selection */}
      <Card>
        <CardHeader>
          <CardTitle>Compare Indexers</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-[var(--text-muted)] mb-2">
                Current Indexer
              </label>
              <select
                value={currentIndexerId}
                onChange={(e) => setCurrentIndexerId(e.target.value)}
                className={cn(
                  'w-full px-3 py-2 text-sm rounded-[var(--radius-button)]',
                  'bg-[var(--bg-elevated)] border border-[var(--border)]',
                  'text-[var(--text)]',
                  'focus:outline-none focus:border-[var(--accent)]'
                )}
              >
                {indexers.map((indexer) => (
                  <option key={indexer.id} value={indexer.id}>
                    {indexer.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-[var(--text-muted)] mb-2">
                Target Indexer
              </label>
              <select
                value={targetIndexerId}
                onChange={(e) => setTargetIndexerId(e.target.value)}
                className={cn(
                  'w-full px-3 py-2 text-sm rounded-[var(--radius-button)]',
                  'bg-[var(--bg-elevated)] border border-[var(--border)]',
                  'text-[var(--text)]',
                  'focus:outline-none focus:border-[var(--accent)]'
                )}
              >
                {indexers
                  .filter((i) => i.id !== currentIndexerId)
                  .map((indexer) => (
                    <option key={indexer.id} value={indexer.id}>
                      {indexer.name}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-[var(--text-muted)] mb-2">
                Delegation Amount (GRT)
              </label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className={cn(
                  'w-full px-3 py-2 text-sm font-mono rounded-[var(--radius-button)]',
                  'bg-[var(--bg-elevated)] border border-[var(--border)]',
                  'text-[var(--text)]',
                  'focus:outline-none focus:border-[var(--accent)]'
                )}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Calculator */}
      <RedelegationCalculator
        currentIndexer={currentIndexer}
        targetIndexer={targetIndexer}
        delegationAmount={parseFloat(amount) || 0}
        grtPrice={grtPrice}
      />
    </div>
  );
}
