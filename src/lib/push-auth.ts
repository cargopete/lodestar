import { verifyMessage } from 'viem';

// Shared opt-in proof for push notifications. The user signs this exact message
// with their wallet; both /api/push/subscribe and /api/push/register-device
// verify against it, so a caller can only bind a subscription or device token to
// a wallet whose key they control. Keep the wording stable — changing it
// invalidates every client signature.

export const ETH_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export function subscribeMessage(address: string): string {
  return `Subscribe to Lodestar notifications\n\nAddress: ${address.toLowerCase()}`;
}

/** Verifies an EIP-191 personal-sign of the subscribe message for `address`. */
export async function verifySubscribeSignature(
  address: string,
  signature: string,
): Promise<boolean> {
  if (!ETH_ADDRESS_RE.test(address) || !signature) return false;
  const normalised = address.toLowerCase() as `0x${string}`;
  try {
    return await verifyMessage({
      address: normalised,
      message: subscribeMessage(normalised),
      signature: signature as `0x${string}`,
    });
  } catch {
    return false;
  }
}
