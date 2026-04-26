'use client';

import { useState, useMemo } from 'react';
import { parseEther } from 'viem';
import { Card, CardHeader, CardTitle, CardContent } from './Card';
import { Badge } from './Badge';
import { ProgressBar } from './ProgressBar';
import { TransactionStatus } from './TransactionStatus';
import { useUndelegation } from '@/hooks/useUndelegation';
import { calculateThawingRemaining, formatThawingTime, calculateExchangeRate } from '@/lib/rewards';
import {
  weiToGRT,
  formatGRT,
  formatGRTFull,
  shortenAddress,
  resolveIndexerName,
  cn,
} from '@/lib/utils';
import { downloadThawingReminder } from '@/lib/calendar';
import type { DelegatedStake } from '@/lib/queries';

interface UndelegatePanelProps {
  position: DelegatedStake;
  className?: string;
  onClose: () => void;
}

export function UndelegatePanel({ position, className, onClose }: UndelegatePanelProps) {
  const { startUndelegate, withdraw, step, error, txHash, reset } = useUndelegation();
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<'undelegate' | 'withdraw'>('undelegate');

  const stakedGRT = weiToGRT(position.stakedTokens);
  const lockedGRT = weiToGRT(position.lockedTokens);
  const isThawing = lockedGRT > 0;
  const amountGRT = parseFloat(amount) || 0;

  // Exchange rate for converting GRT to shares
  const exchangeRate = calculateExchangeRate(
    position.indexer.delegatedTokens,
    position.indexer.delegatorShares
  );

  // Convert desired GRT to shares (in wei)
  const sharesToUndelegate = useMemo(() => {
    if (amountGRT <= 0 || exchangeRate <= 0) return BigInt(0);
    // shares = tokens / exchangeRate (both in GRT, convert to wei)
    const sharesGRT = amountGRT / exchangeRate;
    return parseEther(sharesGRT.toFixed(18));
  }, [amountGRT, exchangeRate]);

  // Thawing progress
  const thawing = isThawing ? calculateThawingRemaining(position.lockedUntil) : null;

  const indexerName = resolveIndexerName(position.indexer.account, position.indexer.id);
  const exceedsStake = amountGRT > stakedGRT;

  const isProcessing = !['idle', 'confirmed', 'error'].includes(step);

  const handleAction = () => {
    if (error) { reset(); return; }

    if (mode === 'withdraw') {
      withdraw(position.indexer.id);
    } else {
      if (amountGRT <= 0 || exceedsStake) return;
      startUndelegate(position.indexer.id, sharesToUndelegate);
    }
  };

  const txSteps = useMemo(() => {
    if (mode === 'withdraw') {
      return [
        { label: 'Withdraw', status: (['withdrawing', 'waiting_withdrawal'].includes(step) ? 'active' : step === 'confirmed' ? 'done' : step === 'error' ? 'error' : 'pending') as 'pending' | 'active' | 'done' | 'error' },
        { label: 'Confirmed', status: (step === 'confirmed' ? 'done' : 'pending') as 'pending' | 'active' | 'done' | 'error' },
      ];
    }
    return [
      { label: 'Undelegate', status: (['undelegating', 'waiting_undelegation'].includes(step) ? 'active' : step === 'confirmed' ? 'done' : step === 'error' ? 'error' : 'pending') as 'pending' | 'active' | 'done' | 'error' },
      { label: 'Confirmed', status: (step === 'confirmed' ? 'done' : 'pending') as 'pending' | 'active' | 'done' | 'error' },
    ];
  }, [step, mode]);

  const buttonLabel = (() => {
    if (error) return 'Failed — try again';
    if (step === 'confirmed') return mode === 'withdraw' ? 'Withdrawn!' : 'Undelegation started!';
    if (isProcessing) return mode === 'withdraw' ? 'Withdrawing...' : 'Undelegating...';
    if (mode === 'withdraw') return 'Withdraw Thawed GRT';
    if (amountGRT <= 0) return 'Enter amount';
    if (exceedsStake) return 'Exceeds delegated amount';
    return `Undelegate ${formatGRT(amountGRT)} GRT`;
  })();

  return (
    <div className={cn(
      'border border-[var(--border)] rounded-lg bg-[var(--bg-surface)] p-4 space-y-4',
      className
    )}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-semibold text-[var(--text)]">Manage Position</h4>
          <Badge variant="accent">{indexerName}</Badge>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-[var(--bg-elevated)] transition-colors"
        >
          <svg className="w-4 h-4 text-[var(--text-faint)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Experimental banner */}
      <div className="flex items-center gap-2 p-2.5 rounded-md bg-[var(--accent-dim)] border border-[var(--accent-hover)]">
        <svg className="w-4 h-4 text-[var(--accent)] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714a2.25 2.25 0 00.659 1.591L19 14.5M14.25 3.104c.251.023.501.05.75.082M4.5 15h15M4.5 15a2.25 2.25 0 00-2.25 2.25v.75a2.25 2.25 0 002.25 2.25h15a2.25 2.25 0 002.25-2.25v-.75A2.25 2.25 0 0019.5 15" />
        </svg>
        <span className="text-[11px] text-[var(--accent)]">
          <strong>Experimental</strong> — on-chain transactions are irreversible. Verify before signing.
        </span>
      </div>

      {/* Position summary */}
      <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-[var(--bg-elevated)]">
        <div>
          <p className="text-[10px] text-[var(--text-faint)]">Delegated</p>
          <p className="text-sm font-mono text-[var(--text)]">{formatGRTFull(stakedGRT)} GRT</p>
        </div>
        {isThawing && (
          <div>
            <p className="text-[10px] text-[var(--text-faint)]">Thawing</p>
            <p className="text-sm font-mono text-[var(--amber)]">{formatGRTFull(lockedGRT)} GRT</p>
          </div>
        )}
      </div>

      {/* Thawing progress */}
      {isThawing && thawing && (
        <div className="space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-[var(--text-muted)]">Thawing progress</span>
            <span className={cn(
              'font-medium',
              thawing.isComplete ? 'text-[var(--green)]' : 'text-[var(--amber)]'
            )}>
              {formatThawingTime(position.lockedUntil)}
            </span>
          </div>
          <ProgressBar
            value={thawing.percentComplete}
            max={100}
            variant={thawing.isComplete ? 'teal' : 'orange'}
            size="sm"
          />
          {thawing.isComplete ? (
            <button
              onClick={() => setMode('withdraw')}
              className={cn(
                'w-full py-2 text-xs font-semibold rounded-md transition-colors',
                mode === 'withdraw'
                  ? 'bg-[var(--green)] text-white'
                  : 'bg-[var(--green)]/15 text-[var(--green)] hover:bg-[var(--green)]/25'
              )}
            >
              Ready to withdraw {formatGRT(lockedGRT)} GRT
            </button>
          ) : (
            <button
              onClick={() => downloadThawingReminder({
                lockedUntil: position.lockedUntil,
                amountGRT: lockedGRT,
                indexerName,
              })}
              className="flex items-center justify-center gap-1.5 w-full py-1.5 text-[11px] font-medium rounded-md bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--accent-hover)] hover:text-[var(--accent)] transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
              </svg>
              Add thaw reminder to calendar
            </button>
          )}
        </div>
      )}

      {/* Mode tabs */}
      {isThawing && thawing?.isComplete && (
        <div className="flex gap-2">
          <button
            onClick={() => setMode('undelegate')}
            className={cn(
              'flex-1 py-1.5 text-xs font-medium rounded-md transition-colors',
              mode === 'undelegate'
                ? 'bg-[var(--accent)]/15 text-[var(--accent)] border border-[var(--accent)]'
                : 'bg-[var(--bg-elevated)] text-[var(--text-muted)] border border-[var(--border)]'
            )}
          >
            Undelegate More
          </button>
          <button
            onClick={() => setMode('withdraw')}
            className={cn(
              'flex-1 py-1.5 text-xs font-medium rounded-md transition-colors',
              mode === 'withdraw'
                ? 'bg-[var(--green)]/15 text-[var(--green)] border border-[var(--green)]'
                : 'bg-[var(--bg-elevated)] text-[var(--text-muted)] border border-[var(--border)]'
            )}
          >
            Withdraw
          </button>
        </div>
      )}

      {/* Undelegate input */}
      {mode === 'undelegate' && (
        <div>
          <div className="relative">
            <input
              type="number"
              value={amount}
              onChange={(e) => { setAmount(e.target.value); if (step !== 'idle') reset(); }}
              placeholder="0.00"
              disabled={isProcessing}
              className={cn(
                'w-full px-4 py-2.5 text-base font-mono rounded-lg',
                'bg-[var(--bg-elevated)] border',
                exceedsStake ? 'border-[var(--red)]' : 'border-[var(--border)]',
                'text-[var(--text)] placeholder:text-[var(--text-faint)]',
                'focus:outline-none focus:border-[var(--accent)]',
                'disabled:opacity-60'
              )}
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--text-faint)] text-sm">
              GRT
            </span>
          </div>
          <div className="flex gap-2 mt-2">
            {[0.25, 0.5, 1].map((pct) => (
              <button
                key={pct}
                onClick={() => {
                  setAmount(Math.floor(stakedGRT * pct).toString());
                  if (step !== 'idle') reset();
                }}
                disabled={isProcessing}
                className="flex-1 px-2 py-1 text-[11px] font-medium rounded-md bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--accent-hover)] hover:text-[var(--accent)] transition-colors disabled:opacity-50"
              >
                {pct === 1 ? 'ALL' : `${pct * 100}%`}
              </button>
            ))}
          </div>
          {amountGRT > 0 && !exceedsStake && (
            <p className="text-xs text-[var(--amber)] mt-2">
              Starts 28-day thawing period. Tokens cannot be used until thawing completes.
            </p>
          )}
        </div>
      )}

      {/* Transaction status */}
      {step !== 'idle' && (
        <TransactionStatus steps={txSteps} txHash={txHash} error={error} />
      )}

      {/* Action button */}
      <button
        onClick={handleAction}
        disabled={(isProcessing || step === 'confirmed' || (mode === 'undelegate' && (amountGRT <= 0 || exceedsStake))) && !error}
        className={cn(
          'w-full py-2.5 text-sm font-semibold rounded-lg transition-all',
          step === 'confirmed'
            ? 'bg-[var(--green)] text-white'
            : error
              ? 'bg-[var(--red)]/15 text-[var(--red)] hover:bg-[var(--red)]/25'
              : mode === 'withdraw'
                ? 'bg-[var(--green)] text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed'
                : amountGRT > 0 && !exceedsStake
                  ? 'bg-[var(--amber)] text-white hover:opacity-90'
                  : 'bg-[var(--bg-elevated)] text-[var(--text-faint)] cursor-not-allowed',
        )}
      >
        {isProcessing && (
          <span className="inline-block w-4 h-4 mr-2 border-2 border-white border-t-transparent rounded-full animate-spin align-middle" />
        )}
        {buttonLabel}
      </button>

      {/* Calendar reminder after successful undelegation (before on-chain state refreshes) */}
      {step === 'confirmed' && mode === 'undelegate' && amountGRT > 0 && (
        <button
          onClick={() => downloadThawingReminder({
            lockedUntil: Math.floor(Date.now() / 1000) + 28 * 86400,
            amountGRT,
            indexerName,
          })}
          className="flex items-center justify-center gap-1.5 w-full py-1.5 text-[11px] font-medium rounded-md bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--accent-hover)] hover:text-[var(--accent)] transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
          </svg>
          Add thaw reminder to calendar
        </button>
      )}
    </div>
  );
}
