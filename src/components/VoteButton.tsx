'use client';

import { useAccount, useConnect } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { useSubmitVote, useVotes } from '@/hooks/useVoting';
import { cn } from '@/lib/utils';

interface VoteButtonProps {
  indexerAddress: string;
  className?: string;
}

export function VoteButton({ indexerAddress, className }: VoteButtonProps) {
  const { isConnected } = useAccount();
  const { connect } = useConnect();
  const { data: votes } = useVotes();
  const { mutate: vote, isPending, error, reset } = useSubmitVote();

  const userVote = votes?.userVote;
  const hasVoted = !!userVote;
  const votedForThis = userVote?.toLowerCase() === indexerAddress.toLowerCase();

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

  if (hasVoted) {
    return null; // Already voted for someone else — hide button
  }

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (error) {
      reset();
      return;
    }
    if (!isConnected) {
      connect({ connector: injected() });
      return;
    }
    vote(indexerAddress);
  };

  const label = error
    ? 'Failed — retry?'
    : isPending
      ? 'Signing...'
      : isConnected
        ? 'Vote'
        : 'Connect to Vote';

  return (
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
  );
}
