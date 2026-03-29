'use client';

import { useState, useCallback } from 'react';
import { useAccount } from 'wagmi';
import { writeContract, waitForTransactionReceipt } from 'wagmi/actions';
import { parseEther, type Hash } from 'viem';
import { useQueryClient } from '@tanstack/react-query';
import { config, CONTRACTS } from '@/lib/wallet';
import { STAKING_ABI, GRT_ABI } from '@/lib/staking-abi';
import { useGRTBalance } from './useGRTBalance';

export type DelegationStep =
  | 'idle'
  | 'approving'
  | 'waiting_approval'
  | 'delegating'
  | 'waiting_delegation'
  | 'confirmed'
  | 'error';

/**
 * Hook for the full approve → delegate flow.
 * Checks existing allowance and skips approval if sufficient.
 */
export function useDelegation() {
  const { address } = useAccount();
  const { rawAllowance, refetch: refetchBalance } = useGRTBalance();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<DelegationStep>('idle');
  const [error, setError] = useState<string | null>(null);
  const [approveTxHash, setApproveTxHash] = useState<Hash | undefined>();
  const [delegateTxHash, setDelegateTxHash] = useState<Hash | undefined>();

  const delegate = useCallback(async (
    indexerAddress: string,
    amountGRT: number,
    useMaxApproval: boolean = false,
  ) => {
    if (!address) {
      setError('Wallet not connected');
      setStep('error');
      return;
    }

    setError(null);
    setApproveTxHash(undefined);
    setDelegateTxHash(undefined);
    const amountWei = parseEther(amountGRT.toString());

    try {
      // Step 1: Check allowance, approve if needed
      if (rawAllowance < amountWei) {
        setStep('approving');
        const approvalAmount = useMaxApproval
          ? BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')
          : amountWei;

        const approveHash = await writeContract(config, {
          address: CONTRACTS.grt,
          abi: GRT_ABI,
          functionName: 'approve',
          args: [CONTRACTS.staking, approvalAmount],
        });
        setApproveTxHash(approveHash);

        setStep('waiting_approval');
        await waitForTransactionReceipt(config, { hash: approveHash });
        refetchBalance();
      }

      // Step 2: Delegate
      setStep('delegating');
      const delegateHash = await writeContract(config, {
        address: CONTRACTS.staking,
        abi: STAKING_ABI,
        functionName: 'delegate',
        args: [
          indexerAddress as `0x${string}`,
          CONTRACTS.subgraphService,
          amountWei,
          BigInt(0),
        ],
      });
      setDelegateTxHash(delegateHash);

      setStep('waiting_delegation');
      await waitForTransactionReceipt(config, { hash: delegateHash });

      // Done
      setStep('confirmed');
      refetchBalance();
      queryClient.invalidateQueries({ queryKey: ['indexerDetails'] });
      queryClient.invalidateQueries({ queryKey: ['delegatorPortfolio'] });
      queryClient.invalidateQueries({ queryKey: ['enrichedIndexers'] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Transaction failed';
      if (msg.includes('User rejected') || msg.includes('user rejected')) {
        setError('Transaction rejected');
      } else {
        setError(msg.length > 120 ? msg.slice(0, 120) + '...' : msg);
      }
      setStep('error');
    }
  }, [address, rawAllowance, refetchBalance, queryClient]);

  const reset = useCallback(() => {
    setStep('idle');
    setError(null);
    setApproveTxHash(undefined);
    setDelegateTxHash(undefined);
  }, []);

  return {
    delegate,
    step,
    error,
    approveTxHash,
    delegateTxHash,
    txHash: delegateTxHash ?? approveTxHash,
    reset,
  };
}
