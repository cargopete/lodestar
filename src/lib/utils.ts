import { clsx, type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

/**
 * Convert wei to GRT (18 decimals)
 */
export function weiToGRT(wei: string | bigint): number {
  if (typeof wei === 'string') {
    // Subgraph sometimes returns decimal strings — truncate before BigInt conversion
    const intPart = wei.split('.')[0];
    return Number(BigInt(intPart)) / 1e18;
  }
  return Number(wei) / 1e18;
}

/**
 * Format GRT amount with appropriate suffix (K, M, B)
 */
export function formatGRT(amount: number, decimals = 2): string {
  if (amount >= 1e9) {
    return `${(amount / 1e9).toFixed(decimals)}B`;
  }
  if (amount >= 1e6) {
    return `${(amount / 1e6).toFixed(decimals)}M`;
  }
  if (amount >= 1e3) {
    return `${(amount / 1e3).toFixed(decimals)}K`;
  }
  return amount.toFixed(decimals);
}

/**
 * Format GRT with full precision for display
 */
export function formatGRTFull(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(amount);
}

/**
 * Convert PPM (parts per million) to percentage
 */
export function ppmToPercent(ppm: number): number {
  return ppm / 10000;
}

/**
 * Format PPM as percentage string
 */
export function formatPPM(ppm: number): string {
  return `${ppmToPercent(ppm).toFixed(2)}%`;
}

/**
 * Format percentage
 */
export function formatPercent(value: number, decimals = 2): string {
  return `${value.toFixed(decimals)}%`;
}

/**
 * Format USD currency with compact notation for large values
 */
export function formatUSD(amount: number, decimals = 2): string {
  if (decimals <= 2 && amount >= 1e9) {
    return `$ ${(amount / 1e9).toFixed(2)}B`;
  }
  if (decimals <= 2 && amount >= 1e6) {
    return `$ ${(amount / 1e6).toFixed(2)}M`;
  }
  if (decimals <= 2 && amount >= 1e3) {
    return `$ ${(amount / 1e3).toFixed(2)}K`;
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount);
}

/**
 * Shorten Ethereum address
 */
export function shortenAddress(address: string, chars = 4): string {
  if (!address) return '';
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

/**
 * Resolve indexer display name from account data
 * Priority: defaultDisplayName > metadata.displayName > first line of metadata.description > shortened address
 */
export function resolveIndexerName(
  account: { defaultDisplayName?: string | null; metadata?: { displayName?: string | null; description?: string | null } | null } | null | undefined,
  address: string
): string {
  if (account?.defaultDisplayName) return account.defaultDisplayName;
  if (account?.metadata?.displayName) return account.metadata.displayName;
  if (account?.metadata?.description) {
    const desc = account.metadata.description.trim();
    // Try to extract org name before common bio patterns
    const bioPattern = /^(.+?)\s+(?:is |are |was |has been |operates |provides |runs |offers |serves )/i;
    const match = desc.match(bioPattern);
    if (match && match[1].length >= 3 && match[1].length <= 30) return match[1];
    // If description is short enough, use it directly
    if (desc.length <= 30) return desc;
    // Fall back to first word(s) before punctuation
    const firstChunk = desc.split(/[.!,\-–—:]/)[0]?.trim();
    if (firstChunk && firstChunk.length <= 30) return firstChunk;
    return desc.slice(0, 27) + '...';
  }
  return shortenAddress(address);
}

/**
 * Calculate epoch progress percentage
 */
export function calculateEpochProgress(
  currentBlock: number,
  epochStartBlock: number,
  epochLength: number
): number {
  const blocksIntoEpoch = currentBlock - epochStartBlock;
  return Math.min((blocksIntoEpoch / epochLength) * 100, 100);
}

/**
 * Calculate delegation capacity percentage used
 */
export function calculateCapacityUsed(
  selfStake: number,
  delegated: number,
  delegationRatio: number
): number {
  const maxDelegation = selfStake * delegationRatio;
  if (maxDelegation === 0) return 100;
  return Math.min((delegated / maxDelegation) * 100, 100);
}

/**
 * Calculate available delegation capacity
 */
export function calculateAvailableCapacity(
  selfStake: number,
  delegated: number,
  delegationRatio: number
): number {
  const maxDelegation = selfStake * delegationRatio;
  return Math.max(maxDelegation - delegated, 0);
}

/**
 * Format timestamp to relative time
 */
export function formatRelativeTime(timestamp: number): string {
  const now = Date.now() / 1000;
  const diff = now - timestamp;

  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;

  return new Date(timestamp * 1000).toLocaleDateString();
}

/**
 * Format large numbers with commas
 */
export function formatNumber(num: number): string {
  return new Intl.NumberFormat('en-US').format(num);
}
