import { decodeEventLog } from 'viem';

// ---------------------------------------------------------------------------
// ABIs
// ---------------------------------------------------------------------------

export const BOUNTY_BOARD_ABI = [
  {
    name: 'post',
    type: 'function' as const,
    stateMutability: 'nonpayable' as const,
    inputs: [
      { name: 'deploymentId', type: 'bytes32' },
      { name: 'amount', type: 'uint256' },
      { name: 'expiresAt', type: 'uint256' },
    ],
    outputs: [{ name: 'bountyId', type: 'uint256' }],
  },
  {
    name: 'claim',
    type: 'function' as const,
    stateMutability: 'nonpayable' as const,
    inputs: [
      { name: 'bountyId', type: 'uint256' },
      { name: 'allocationId', type: 'address' },
    ],
    outputs: [],
  },
  {
    name: 'cancel',
    type: 'function' as const,
    stateMutability: 'nonpayable' as const,
    inputs: [{ name: 'bountyId', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'refundExpired',
    type: 'function' as const,
    stateMutability: 'nonpayable' as const,
    inputs: [{ name: 'bountyId', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'getBounty',
    type: 'function' as const,
    stateMutability: 'view' as const,
    inputs: [{ name: 'bountyId', type: 'uint256' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'developer', type: 'address' },
          { name: 'deploymentId', type: 'bytes32' },
          { name: 'amount', type: 'uint256' },
          { name: 'postedAt', type: 'uint256' },
          { name: 'expiresAt', type: 'uint256' },
          { name: 'winner', type: 'address' },
          { name: 'settled', type: 'bool' },
        ],
      },
    ],
  },
  {
    name: 'bountyCount',
    type: 'function' as const,
    stateMutability: 'view' as const,
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  // Events
  {
    name: 'BountyPosted',
    type: 'event' as const,
    inputs: [
      { name: 'bountyId', type: 'uint256', indexed: true },
      { name: 'developer', type: 'address', indexed: true },
      { name: 'deploymentId', type: 'bytes32', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'expiresAt', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'BountyClaimed',
    type: 'event' as const,
    inputs: [
      { name: 'bountyId', type: 'uint256', indexed: true },
      { name: 'indexer', type: 'address', indexed: true },
      { name: 'allocationId', type: 'address', indexed: false },
    ],
  },
  {
    name: 'BountyCancelled',
    type: 'event' as const,
    inputs: [{ name: 'bountyId', type: 'uint256', indexed: true }],
  },
  {
    name: 'BountyRefunded',
    type: 'event' as const,
    inputs: [{ name: 'bountyId', type: 'uint256', indexed: true }],
  },
] as const;

export const GRT_ABI = [
  {
    name: 'approve',
    type: 'function' as const,
    stateMutability: 'nonpayable' as const,
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'allowance',
    type: 'function' as const,
    stateMutability: 'view' as const,
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function extractBountyId(
  logs: readonly { topics: readonly string[]; data: string; address: string }[],
  bountyBoardAddress: string,
): bigint | null {
  for (const log of logs) {
    if (log.address.toLowerCase() !== bountyBoardAddress.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({
        abi: BOUNTY_BOARD_ABI,
        eventName: 'BountyPosted',
        topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
        data: log.data as `0x${string}`,
      });
      return decoded.args.bountyId;
    } catch {
      // not this event, keep looking
    }
  }
  return null;
}
