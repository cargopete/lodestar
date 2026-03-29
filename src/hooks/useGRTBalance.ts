'use client';

import { useAccount, useReadContract } from 'wagmi';
import { CONTRACTS } from '@/lib/wallet';
import { GRT_ABI } from '@/lib/staking-abi';

/**
 * Read GRT balance and current staking allowance for the connected wallet.
 * Polls every 15s so the UI stays fresh after approve/delegate txns.
 */
export function useGRTBalance() {
  const { address } = useAccount();

  const { data: rawBalance, ...balanceQuery } = useReadContract({
    address: CONTRACTS.grt,
    abi: GRT_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 15_000 },
  });

  const { data: rawAllowance, ...allowanceQuery } = useReadContract({
    address: CONTRACTS.grt,
    abi: GRT_ABI,
    functionName: 'allowance',
    args: address ? [address, CONTRACTS.staking] : undefined,
    query: { enabled: !!address, refetchInterval: 15_000 },
  });

  // Convert from bigint (wei) to GRT (number) for display
  const balance = rawBalance != null ? Number(rawBalance) / 1e18 : 0;
  const allowance = rawAllowance != null ? Number(rawAllowance) / 1e18 : 0;

  return {
    balance,
    allowance,
    rawBalance: rawBalance ?? BigInt(0),
    rawAllowance: rawAllowance ?? BigInt(0),
    isLoading: balanceQuery.isLoading || allowanceQuery.isLoading,
    refetch: () => {
      balanceQuery.refetch();
      allowanceQuery.refetch();
    },
  };
}
