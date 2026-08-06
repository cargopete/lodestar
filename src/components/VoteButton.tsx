'use client';

import { useState } from 'react';
import { useAccount, useConnect } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { useSubmitVote, useVotes } from '@/hooks/useVoting';
import { getCurrentPeriod } from '@/lib/voting';
import { cn } from '@/lib/utils';

interface VoteButtonProps {
  indexerAddress: string;
  period?: string;
  className?: string;
}

export function VoteButton({ indexerAddress, period, className }: VoteButtonProps) {
  const { isConnected } = useAccount();
  const { connect } = useConnect();
  const isHistorical = !!period && period !== getCurrentPeriod();
  const { data: votes } = useVotes(isHistorical ? period : undefined);
  const { mutate: vote, isPending, error, reset } = useSubmitVote();
  const [toast, setToast] = useState<string | null>(null);

  const userVote = votes?.userVote;
  const hasVoted = !!userVote;
  const votedForThis = userVote?.toLowerCase() === indexerAddress.toLowerCase();

  if (isHistorical) {
    return (
      <span className={cn('text-xs text-[var(--text-faint)]', className)}>—</span>
    );
  }

  if (votedForThis) {
    return (
      <button
        disabled
        className={cn(
          'px-3 py-1.5 text-xs font-medium rounded-md',
          'bg-[var(--green)]/15 text-[var(--green)] cursor-default',
          className
        )}
      >
        Voted
      </button>
    );
  }

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (error) {
      reset();
      return;
    }
    if (hasVoted) {
      setToast('Already voted this month');
      setTimeout(() => setToast(null), 2500);
      return;
    }
    if (!isConnected) {
      connect({ connector: injected() });
      return;
    }
    vote(indexerAddress);
  };

  const label = error
    ? 'Failed, retry?'
    : isPending
      ? 'Signing...'
      : isConnected
        ? 'Vote'
        : 'Connect to Vote';

  return (
    <div className="relative">
      <button
        onClick={handleClick}
        disabled={isPending}
        title={error?.message}
        className={cn(
          'px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
          error
            ? 'bg-[var(--red)]/15 text-[var(--red)] hover:bg-[var(--red)]/25'
            : 'bg-[var(--accent)]/15 text-[var(--accent)] hover:bg-[var(--accent)]/25',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          className
        )}
      >
        {label}
      </button>
      {toast && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 text-xs font-medium rounded-md bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text-muted)] whitespace-nowrap shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  );
}
