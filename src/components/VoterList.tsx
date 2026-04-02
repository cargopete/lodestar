'use client';

import { useState } from 'react';
import { useVotes } from '@/hooks/useVoting';
import { Card } from '@/components/ui/Card';
import { shortenAddress } from '@/lib/utils';
import type { CommunityVote } from '@/lib/voting';

interface VoterListProps {
  indexerAddress: string;
  period?: string;
}

export function VoterList({ indexerAddress, period }: VoterListProps) {
  const { data: votes } = useVotes(period);
  const [expanded, setExpanded] = useState(false);

  const indexerVoters = (votes?.voters ?? []).filter(
    (v) => v.indexer_address.toLowerCase() === indexerAddress.toLowerCase()
  );

  const tally = votes?.tallies?.find(
    (t) => t.indexer_address.toLowerCase() === indexerAddress.toLowerCase()
  );

  if (indexerVoters.length === 0) {
    return null;
  }

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-xs text-[var(--accent)] hover:underline"
      >
        {tally?.weighted_votes ?? 0} weighted vote{(tally?.weighted_votes ?? 0) !== 1 ? 's' : ''} from {indexerVoters.length} voter{indexerVoters.length !== 1 ? 's' : ''}
        {expanded ? ' (hide)' : ' (show)'}
      </button>

      {expanded && (
        <div className="mt-2 space-y-1">
          {indexerVoters.map((voter) => (
            <VoterRow key={voter.voter_address} voter={voter} />
          ))}
        </div>
      )}
    </div>
  );
}

function VoterRow({ voter }: { voter: CommunityVote }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="font-mono text-[var(--text-muted)]">
        {shortenAddress(voter.voter_address)}
      </span>
      {voter.is_delegator ? (
        <span className="px-1.5 py-0.5 rounded-full bg-[var(--accent)]/15 text-[var(--accent)] text-[10px] font-medium">
          Delegator (5x)
        </span>
      ) : (
        <span className="px-1.5 py-0.5 rounded-full bg-[var(--bg-elevated)] text-[var(--text-faint)] text-[10px] font-medium">
          Voter
        </span>
      )}
    </div>
  );
}

/**
 * Compact vote count shown inline in table rows
 */
export function VoteCount({ indexerAddress, period }: { indexerAddress: string; period?: string }) {
  const { data: votes } = useVotes(period);

  const tally = votes?.tallies?.find(
    (t) => t.indexer_address.toLowerCase() === indexerAddress.toLowerCase()
  );

  const weighted = tally?.weighted_votes ?? 0;

  return (
    <span className="font-mono text-xs text-[var(--text-muted)]">
      {weighted}
    </span>
  );
}
