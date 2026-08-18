/**
 * Live check of the x402 challenge path against the real Graph gateways.
 *
 * Costs nothing: it only exercises the unpaid 402 branch, which is where all
 * our policy checks live. Run with:
 *   npx tsx scripts/x402-live-check.ts
 */
import {
  CHALLENGE_HEADER,
  X402_CHAINS,
  assertChallengeIsExpected,
  decodeChallenge,
  formatUsdc,
  type X402Network,
} from '../src/lib/x402';

const SUBGRAPH = '5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV';

async function check(network: X402Network) {
  const chain = X402_CHAINS[network];
  const url = `${chain.gateway}/api/x402/subgraphs/id/${SUBGRAPH}`;
  process.stdout.write(`\n${network}  ${chain.gateway}\n`);

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: '{_meta{block{number}}}' }),
    signal: AbortSignal.timeout(20_000),
  });

  console.log(`  status              ${res.status}${res.status === 402 ? ' (expected)' : ' <-- UNEXPECTED'}`);

  const raw = res.headers.get(CHALLENGE_HEADER);
  if (!raw) return console.log('  challenge           MISSING <-- FAIL');

  const challenge = decodeChallenge(raw);
  if (!challenge) return console.log('  challenge           UNDECODABLE <-- FAIL');
  console.log(`  gateway message     ${challenge.error}`);

  const verdict = assertChallengeIsExpected(challenge, chain);
  if (!verdict.ok) return console.log(`  policy              REJECTED: ${verdict.reason} <-- FAIL`);

  console.log(`  policy              accepted`);
  console.log(`  network             ${verdict.tag.network}`);
  console.log(`  payTo               ${verdict.tag.payTo}`);
  console.log(`  asset               ${verdict.tag.asset}`);
  console.log(`  price               ${verdict.tag.amount} base units = ${formatUsdc(verdict.tag.amount)} USDC`);
  console.log(`  transfer method     ${(verdict.tag.extra as Record<string, unknown>)?.assetTransferMethod}`);
}

async function main() {
  await check('mainnet');
  await check('testnet');
  console.log();
}

void main();
