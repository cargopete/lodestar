'use client';

import { useState, useMemo } from 'react';
import { useAccount, useConnect } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { Card, CardHeader, CardTitle, CardContent } from './Card';
import { Badge } from './Badge';
import { ProgressBar } from './ProgressBar';
import { TransactionStatus } from './TransactionStatus';
import { useGRTBalance } from '@/hooks/useGRTBalance';
import { useDelegation, type DelegationStep } from '@/hooks/useDelegation';
import {
  formatGRT,
  formatGRTFull,
  isGreedyCut,
  cn,
} from '@/lib/utils';
import {
  calculateDelegationCapacity,
  calculateDelegatorAPR,
} from '@/lib/rewards';

interface DelegatePanelProps {
  indexer: {
    id: string;
    name: string;
    stakedTokens: string;
    lockedTokens?: string;
    delegatedTokens: string;
    indexingRewardCut: number;
    allocations?: Array<{
      allocatedTokens: string;
      subgraphDeployment: {
        signalledTokens: string;
        stakedTokens: string;
      };
    }>;
  };
  riskGrade?: string | null;
  reoEligible?: boolean | null;
  delegationRatio?: number;
  totalNetworkSignal?: number;
  annualIssuance?: number;
}

export function DelegatePanel({
  indexer,
  riskGrade,
  reoEligible,
  delegationRatio = 16,
  totalNetworkSignal = 0,
  annualIssuance = 0,
}: DelegatePanelProps) {
  const { isConnected } = useAccount();
  const { connect } = useConnect();
  const { balance } = useGRTBalance();
  const { delegate, step, error, txHash, reset } = useDelegation();

  const [amount, setAmount] = useState('');
  const [maxApproval, setMaxApproval] = useState(false);

  const amountGRT = parseFloat(amount) || 0;
  const selfStake = Number(BigInt(indexer.stakedTokens.split('.')[0])) / 1e18
    - Number(BigInt((indexer.lockedTokens ?? '0').split('.')[0])) / 1e18;
  const currentDelegated = Number(BigInt(indexer.delegatedTokens.split('.')[0])) / 1e18;

  // Capacity
  const capacity = useMemo(
    () => calculateDelegationCapacity(selfStake, currentDelegated, delegationRatio),
    [selfStake, currentDelegated, delegationRatio]
  );

  // APR projection after delegation
  const projectedAPR = useMemo(() => {
    if (!indexer.allocations?.length || totalNetworkSignal === 0 || annualIssuance === 0) return 0;
    return calculateDelegatorAPR(
      indexer.allocations,
      indexer.indexingRewardCut,
      currentDelegated + amountGRT || 1,
      totalNetworkSignal,
      annualIssuance
    );
  }, [indexer.allocations, indexer.indexingRewardCut, currentDelegated, amountGRT, totalNetworkSignal, annualIssuance]);

  // Pre-flight warnings
  const isGreedy = isGreedyCut(indexer.indexingRewardCut);
  const exceedsCapacity = amountGRT > capacity.availableCapacity;
  const exceedsBalance = amountGRT > balance;
  const hasWarning = isGreedy || exceedsCapacity || exceedsBalance;

  // Step labels for transaction status
  const txSteps = useMemo(() => {
    const s = step as string;
    const approveStatus =
      s === 'approving' || s === 'waiting_approval' ? 'active' :
      s === 'delegating' || s === 'waiting_delegation' || s === 'confirmed' ? 'done' :
      s === 'error' ? 'error' : 'pending';
    const delegateStatus =
      s === 'delegating' || s === 'waiting_delegation' ? 'active' :
      s === 'confirmed' ? 'done' :
      s === 'error' && approveStatus === 'done' ? 'error' : 'pending';
    return [
      { label: 'Approve GRT', status: approveStatus as 'pending' | 'active' | 'done' | 'error' },
      { label: 'Delegate', status: delegateStatus as 'pending' | 'active' | 'done' | 'error' },
      { label: 'Confirmed', status: (s === 'confirmed' ? 'done' : 'pending') as 'pending' | 'active' | 'done' | 'error' },
    ];
  }, [step]);

  const isProcessing = !['idle', 'confirmed', 'error'].includes(step);

  const handleDelegate = () => {
    if (!isConnected) {
      connect({ connector: injected() });
      return;
    }
    if (error) {
      reset();
      return;
    }
    if (amountGRT <= 0 || exceedsBalance || exceedsCapacity) return;
    delegate(indexer.id, amountGRT, maxApproval);
  };

  // Button label
  const buttonLabel = (() => {
    if (error) return 'Failed, try again';
    if (step === 'confirmed') return 'Delegated!';
    if (step === 'waiting_delegation') return 'Confirming delegation...';
    if (step === 'delegating') return 'Sign delegation...';
    if (step === 'waiting_approval') return 'Confirming approval...';
    if (step === 'approving') return 'Sign approval...';
    if (!isConnected) return 'Connect Wallet to Delegate';
    if (amountGRT <= 0) return 'Enter amount';
    if (exceedsBalance) return 'Insufficient GRT balance';
    if (exceedsCapacity) return 'Exceeds capacity';
    return `Delegate ${formatGRT(amountGRT)} GRT`;
  })();

  const buttonDisabled = isProcessing
    || step === 'confirmed'
    || (isConnected && (amountGRT <= 0 || exceedsBalance || exceedsCapacity));

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Delegate</CardTitle>
          {isConnected && balance > 0 && (
            <span className="text-xs text-[var(--text-muted)] font-mono">
              {formatGRTFull(balance)} GRT available
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Experimental banner */}
        <div className="flex items-center gap-2 p-2.5 rounded-md bg-[var(--accent-dim)] border border-[var(--accent-hover)]">
          <svg className="w-4 h-4 text-[var(--accent-text)] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714a2.25 2.25 0 00.659 1.591L19 14.5M14.25 3.104c.251.023.501.05.75.082M4.5 15h15M4.5 15a2.25 2.25 0 00-2.25 2.25v.75a2.25 2.25 0 002.25 2.25h15a2.25 2.25 0 002.25-2.25v-.75A2.25 2.25 0 0019.5 15" />
          </svg>
          <span className="text-[11px] text-[var(--accent-text)]">
On-chain delegation is irreversible. Double-check amounts before signing.
          </span>
        </div>

        {/* Amount input */}
        <div>
          <div className="relative">
            <input
              type="number"
              value={amount}
              onChange={(e) => { setAmount(e.target.value); if (step !== 'idle') reset(); }}
              placeholder="0.00"
              disabled={isProcessing}
              className={cn(
                'w-full px-4 py-3 text-lg font-mono rounded-lg',
                'bg-[var(--bg-elevated)] border',
                exceedsBalance || exceedsCapacity ? 'border-[var(--red)]' : 'border-[var(--border)]',
                'text-[var(--text)] placeholder:text-[var(--text-faint)]',
                'focus:outline-none focus:border-[var(--accent)]',
                'disabled:opacity-60'
              )}
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--text-faint)]">
              GRT
            </span>
          </div>
          {/* Quick-fill buttons */}
          {isConnected && balance > 0 && (
            <div className="flex gap-2 mt-2">
              {[0.25, 0.5, 0.75, 1].map((pct) => (
                <button
                  key={pct}
                  onClick={() => {
                    setAmount(Math.floor(balance * pct).toString());
                    if (step !== 'idle') reset();
                  }}
                  disabled={isProcessing}
                  className="flex-1 px-2 py-1 text-[11px] font-medium rounded-md bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--accent-hover)] hover:text-[var(--accent-text)] transition-colors disabled:opacity-50"
                >
                  {pct === 1 ? 'MAX' : `${pct * 100}%`}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Pre-flight info */}
        {amountGRT > 0 && (
          <div className="space-y-2 p-3 rounded-lg bg-[var(--bg-elevated)]">
            <div className="flex justify-between text-xs">
              <span className="text-[var(--text-muted)]">Delegation amount</span>
              <span className="font-mono text-[var(--text)]">{formatGRT(amountGRT, 4)} GRT</span>
            </div>
            {/* APR */}
            {projectedAPR > 0 && (
              <div className="flex justify-between text-xs pt-1 border-t border-[var(--border)]">
                <span className="text-[var(--text-muted)]">Projected APR</span>
                <span className={cn('font-mono font-medium', projectedAPR >= 3 ? 'text-[var(--green)]' : 'text-[var(--text)]')}>
                  {projectedAPR.toFixed(2)}%
                </span>
              </div>
            )}
            {projectedAPR > 0 && (
              <div className="flex justify-between text-xs">
                <span className="text-[var(--text-muted)]">Est. annual reward</span>
                <span className="font-mono text-[var(--green)]">
                  ~{formatGRT(amountGRT * (projectedAPR / 100))} GRT
                </span>
              </div>
            )}
            {/* Capacity after */}
            <div className="flex justify-between text-xs">
              <span className="text-[var(--text-muted)]">Capacity after</span>
              <span className={cn(
                'font-mono',
                exceedsCapacity ? 'text-[var(--red)]' : 'text-[var(--text)]'
              )}>
                {formatGRT(Math.max(capacity.availableCapacity - amountGRT, 0))} GRT remaining
              </span>
            </div>
          </div>
        )}

        {/* Warnings */}
        {isGreedy && (
          <div className="flex items-center gap-2 p-2.5 rounded-md bg-[var(--red-dim)] border border-[var(--red)]">
            <svg className="w-4 h-4 text-[var(--red)] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <span className="text-xs text-[var(--red)]">
              100% reward cut: delegators earn 0% APR
            </span>
          </div>
        )}

        {reoEligible === false && !isGreedy && (
          <div className="flex items-center gap-2 p-2.5 rounded-md bg-[var(--amber-dim)] border border-[var(--amber)]">
            <svg className="w-4 h-4 text-[var(--amber)] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <span className="text-xs text-[var(--amber)]">
              Not REO eligible, so may not earn rewards
            </span>
          </div>
        )}

        {riskGrade && ['D', 'F'].includes(riskGrade) && !isGreedy && (
          <div className="flex items-center gap-2 p-2.5 rounded-md bg-[var(--amber-dim)] border border-[var(--amber)]">
            <Badge variant="error">{riskGrade}</Badge>
            <span className="text-xs text-[var(--amber)]">
              Low risk score; consider reviewing indexer details
            </span>
          </div>
        )}

        {/* Max approval toggle */}
        {isConnected && amountGRT > 0 && (
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={maxApproval}
              onChange={(e) => setMaxApproval(e.target.checked)}
              className="rounded border-[var(--border)] accent-[var(--accent)]"
            />
            <span className="text-[11px] text-[var(--text-faint)]">
              Approve unlimited GRT (skip approval on future delegations)
            </span>
          </label>
        )}

        {/* Transaction status */}
        {step !== 'idle' && (
          <TransactionStatus
            steps={txSteps}
            txHash={txHash}
            error={error}
          />
        )}

        {/* Action button */}
        <button
          onClick={handleDelegate}
          disabled={buttonDisabled && !error}
          className={cn(
            'w-full py-3 text-sm font-semibold rounded-lg transition-all',
            step === 'confirmed'
              ? 'bg-[var(--green)] text-white'
              : error
                ? 'bg-[var(--red)]/15 text-[var(--red)] hover:bg-[var(--red)]/25'
                : buttonDisabled
                  ? 'bg-[var(--bg-elevated)] text-[var(--text-faint)] cursor-not-allowed'
                  : 'bg-[var(--accent)] text-white hover:opacity-90',
          )}
        >
          {isProcessing && (
            <span className="inline-block w-4 h-4 mr-2 border-2 border-white border-t-transparent rounded-full animate-spin align-middle" />
          )}
          {buttonLabel}
        </button>
      </CardContent>
    </Card>
  );
}
