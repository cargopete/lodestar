import { recoverTypedDataAddress } from 'viem';

/**
 * EIP-712 domain and types for community voting.
 * Signed off-chain (gasless), verified server-side.
 */

export const VOTE_DOMAIN = {
  name: 'Lodestar',
  version: '1',
  chainId: 42161, // Arbitrum One
} as const;

export const VOTE_TYPES = {
  Vote: [
    { name: 'indexer', type: 'address' },
    { name: 'period', type: 'string' },
    { name: 'voter', type: 'address' },
  ],
} as const;

export interface VoteMessage {
  indexer: `0x${string}`;
  period: string;
  voter: `0x${string}`;
}

export interface CommunityVote {
  voter_address: string;
  indexer_address: string;
  is_delegator: boolean;
  vote_weight: number;
  created_at: string;
}

export interface VoteTally {
  indexer_address: string;
  weighted_votes: number;
  voter_count: number;
}

export interface VotesResponse {
  period: string;
  tallies: VoteTally[];
  voters: CommunityVote[];
  userVote: string | null; // indexer address the user voted for, if any
}

/**
 * Recover the signer address from an EIP-712 vote signature.
 * Pure crypto — no RPC calls needed.
 */
export async function recoverVoteSigner(
  message: VoteMessage,
  signature: `0x${string}`
): Promise<`0x${string}`> {
  return recoverTypedDataAddress({
    domain: VOTE_DOMAIN,
    types: VOTE_TYPES,
    primaryType: 'Vote',
    message,
    signature,
  });
}

/**
 * Get the current voting period string (YYYY-MM format).
 */
export function getCurrentPeriod(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}
