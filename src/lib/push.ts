/**
 * Server-side Push Protocol helper.
 * Sends targeted notifications to delegator wallet addresses.
 *
 * Requires env vars:
 *   PUSH_CHANNEL_PRIVATE_KEY — channel wallet private key (0x-prefixed or raw hex)
 *   PUSH_CHANNEL_ADDRESS     — public address of the channel wallet
 *   PUSH_ENV                 — 'staging' (default) | 'prod'
 */

import { PushAPI, CONSTANTS } from '@pushprotocol/restapi';
import { Wallet } from 'ethers';

function getEnv() {
  return process.env.PUSH_ENV === 'prod' ? CONSTANTS.ENV.PROD : CONSTANTS.ENV.STAGING;
}

function getChannelSigner(): Wallet {
  const pk = process.env.PUSH_CHANNEL_PRIVATE_KEY;
  if (!pk) throw new Error('PUSH_CHANNEL_PRIVATE_KEY not set');
  return new Wallet(pk.startsWith('0x') ? pk : `0x${pk}`);
}

/**
 * Send a targeted Push notification to one or more wallet addresses.
 * Recipients do not need to be subscribed to the channel to receive it.
 */
export async function sendPushNotification(
  recipients: string[],
  title: string,
  body: string,
  cta?: string
): Promise<void> {
  if (recipients.length === 0) return;

  const signer = getChannelSigner();
  const channel = await PushAPI.initialize(signer, { env: getEnv() });

  // CAIP-10 format — target Ethereum mainnet addresses
  const caipRecipients = recipients.map((addr) => `eip155:1:${addr}`);

  await channel.channel.send(caipRecipients, {
    notification: { title, body },
    ...(cta ? { payload: { cta } } : {}),
  });
}
