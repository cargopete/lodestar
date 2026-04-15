'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAccount, useSignMessage } from 'wagmi';

const SUBSCRIBE_MESSAGE = (address: string) =>
  `Subscribe to Lodestar notifications\n\nAddress: ${address.toLowerCase()}`;

async function fetchSubscriptionStatus(address: string): Promise<boolean> {
  const res = await fetch(`/api/push/subscribe?address=${address}`);
  if (!res.ok) return false;
  const data = await res.json();
  return data.subscribed ?? false;
}

export function usePushStatus() {
  const { address } = useAccount();
  return useQuery({
    queryKey: ['push-subscription', address?.toLowerCase()],
    queryFn: () => fetchSubscriptionStatus(address!.toLowerCase()),
    enabled: !!address,
    staleTime: 1000 * 60 * 5,
  });
}

export function useTogglePushSubscription() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (currentlySubscribed: boolean) => {
      if (!address) throw new Error('Wallet not connected');
      const normalised = address.toLowerCase();

      if (currentlySubscribed) {
        const res = await fetch(`/api/push/subscribe?address=${normalised}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Failed to unsubscribe');
        return false;
      }

      const signature = await signMessageAsync({ message: SUBSCRIBE_MESSAGE(normalised) });

      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: normalised, signature }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? 'Failed to subscribe');
      }

      return true;
    },
    onSuccess: (subscribed) => {
      queryClient.setQueryData(
        ['push-subscription', address?.toLowerCase()],
        subscribed
      );
    },
  });
}
