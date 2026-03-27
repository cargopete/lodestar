'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAccount, useSignTypedData } from 'wagmi';
import { fetchVotes, submitVote } from '@/lib/api';
import { VOTE_DOMAIN, VOTE_TYPES, getCurrentPeriod } from '@/lib/voting';
import type { VoteMessage, VotesResponse } from '@/lib/voting';

const FIVE_MINUTES = 1000 * 60 * 5;

/**
 * Hook for fetching community votes for the current period
 */
export function useVotes() {
  const { address } = useAccount();
  const period = getCurrentPeriod();

  return useQuery({
    queryKey: ['votes', period, address?.toLowerCase()],
    queryFn: () => fetchVotes(period, address?.toLowerCase()),
    staleTime: FIVE_MINUTES,
    refetchInterval: FIVE_MINUTES,
  });
}

/**
 * Hook for casting a community vote via EIP-712 signature
 */
export function useSubmitVote() {
  const { address } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (indexerAddress: string) => {
      if (!address) throw new Error('Wallet not connected');

      const message: VoteMessage = {
        indexer: indexerAddress.toLowerCase() as `0x${string}`,
        period: getCurrentPeriod(),
        voter: address.toLowerCase() as `0x${string}`,
      };

      const signature = await signTypedDataAsync({
        domain: VOTE_DOMAIN,
        types: VOTE_TYPES,
        primaryType: 'Vote',
        message,
      });

      return submitVote(message, signature);
    },
    onSuccess: (_data, indexerAddress) => {
      const period = getCurrentPeriod();
      // Optimistically set userVote so the UI updates immediately
      // (the GET endpoint is CDN-cached and may return stale data)
      queryClient.setQueryData(
        ['votes', period, address?.toLowerCase()],
        (old: VotesResponse | undefined) => {
          if (!old) return old;
          return { ...old, userVote: indexerAddress.toLowerCase() };
        }
      );
      queryClient.invalidateQueries({ queryKey: ['votes'] });
    },
  });
}
