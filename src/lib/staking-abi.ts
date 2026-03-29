/**
 * Minimal ABIs for The Graph HorizonStaking and GRT Token contracts.
 * Only includes the functions we use — keeps bundle size small.
 */

// HorizonStaking — delegation functions (Horizon-native with verifier param)
export const STAKING_ABI = [
  // Write — delegate tokens to a service provider via a verifier
  {
    name: 'delegate',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'serviceProvider', type: 'address' },
      { name: 'verifier', type: 'address' },
      { name: 'tokens', type: 'uint256' },
      { name: 'minSharesOut', type: 'uint256' },
    ],
    outputs: [],
  },
  // Write — start undelegation (thawing), returns thaw request ID
  {
    name: 'undelegate',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'serviceProvider', type: 'address' },
      { name: 'verifier', type: 'address' },
      { name: 'shares', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  // Write — withdraw thawed tokens (nThawRequests=0 means process all)
  {
    name: 'withdrawDelegated',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'serviceProvider', type: 'address' },
      { name: 'verifier', type: 'address' },
      { name: 'nThawRequests', type: 'uint256' },
    ],
    outputs: [],
  },
  // Read — get delegation details
  {
    name: 'getDelegation',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'serviceProvider', type: 'address' },
      { name: 'verifier', type: 'address' },
      { name: 'delegator', type: 'address' },
    ],
    outputs: [
      { name: 'shares', type: 'uint256' },
      { name: 'tokensLocked', type: 'uint256' },
      { name: 'tokensLockedUntil', type: 'uint256' },
    ],
  },
  // Legacy 2-param delegate for backward compatibility
  {
    name: 'delegate',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'serviceProvider', type: 'address' },
      { name: 'tokens', type: 'uint256' },
    ],
    outputs: [],
  },
] as const;

// GRT ERC20 Token — approve, allowance, balanceOf
export const GRT_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

/** Delegation tax rate (0.5% = 5000 PPM) */
export const DELEGATION_TAX_PPM = 5000;
export const DELEGATION_TAX_RATE = DELEGATION_TAX_PPM / 1_000_000; // 0.005
