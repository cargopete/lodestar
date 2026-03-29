'use client';

import { useState, useCallback } from 'react';
import { useAccount } from 'wagmi';
import { writeContract, waitForTransactionReceipt } from 'wagmi/actions';
import { type Hash } from 'viem';
import { useQueryClient } from '@tanstack/react-query';
import { config, CONTRACTS } from '@/lib/wallet';
import { STAKING_ABI } from '@/lib/staking-abi';

export type UndelegationStep =
  | 'idle'
  | 'undelegating'
  | 'waiting_undelegation'
  | 'withdrawing'
  | 'waiting_withdrawal'
  | 'confirmed'
  | 'error';

/**
 * Hook for undelegating (start thawing) and withdrawing (after thawing).
 *
 * Note: Horizon's withdrawDelegated takes (provider, verifier, nThawRequests).
 * There is no single-tx redelegate — that requires withdraw + separate delegate.
 */
export function useUndelegation() {
  const { address } = useAccount();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<UndelegationStep>('idle');
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<Hash | undefined>();

  const invalidateCaches = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['indexerDetails'] });
    queryClient.invalidateQueries({ queryKey: ['delegatorPortfolio'] });
    queryClient.invalidateQueries({ queryKey: ['enrichedIndexers'] });
  }, [queryClient]);

  /**
   * Start undelegation — converts shares to thawing tokens.
   * The contract returns a bytes32 thaw request ID.
   */
  const startUndelegate = useCallback(async (
    indexerAddress: string,
    sharesWei: bigint,
  ) => {
    if (!address) {
      setError('Wallet not connected');
      setStep('error');
      return;
    }

    setError(null);
    setTxHash(undefined);

    try {
      setStep('undelegating');
      const hash = await writeContract(config, {
        address: CONTRACTS.staking,
        abi: STAKING_ABI,
        functionName: 'undelegate',
        args: [
          indexerAddress as `0x${string}`,
          CONTRACTS.subgraphService,
          sharesWei,
        ],
      });
      setTxHash(hash);

      setStep('waiting_undelegation');
      await waitForTransactionReceipt(config, { hash });

      setStep('confirmed');
      invalidateCaches();
    } catch (err) {
      handleError(err, setError, setStep);
    }
  }, [address, invalidateCaches]);

  /**
   * Withdraw all thawed tokens back to wallet.
   * nThawRequests = 0 means "process all pending thaw requests".
   */
  const withdraw = useCallback(async (indexerAddress: string) => {
    if (!address) {
      setError('Wallet not connected');
      setStep('error');
      return;
    }

    setError(null);
    setTxHash(undefined);

    try {
      setStep('withdrawing');
      const hash = await writeContract(config, {
        address: CONTRACTS.staking,
        abi: STAKING_ABI,
        functionName: 'withdrawDelegated',
        args: [
          indexerAddress as `0x${string}`,
          CONTRACTS.subgraphService,
          BigInt(0), // 0 = process all thaw requests
        ],
      });
      setTxHash(hash);

      setStep('waiting_withdrawal');
      await waitForTransactionReceipt(config, { hash });

      setStep('confirmed');
      invalidateCaches();
    } catch (err) {
      handleError(err, setError, setStep);
    }
  }, [address, invalidateCaches]);

  const reset = useCallback(() => {
    setStep('idle');
    setError(null);
    setTxHash(undefined);
  }, []);

  return {
    startUndelegate,
    withdraw,
    step,
    error,
    txHash,
    reset,
  };
}

function handleError(
  err: unknown,
  setError: (e: string) => void,
  setStep: (s: UndelegationStep) => void,
) {
  const msg = err instanceof Error ? err.message : 'Transaction failed';
  if (msg.includes('User rejected') || msg.includes('user rejected')) {
    setError('Transaction rejected');
  } else {
    setError(msg.length > 120 ? msg.slice(0, 120) + '...' : msg);
  }
  setStep('error');
}
