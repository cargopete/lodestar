import { NextRequest, NextResponse } from 'next/server';
import { cached } from '@/lib/cache';
import { hasNuthatch, nuthatchSqlReady } from '@/lib/nuthatch';
import { escrowAccountsSql, escrowTransactionsSql, tallyCollectedSql } from '@/lib/nest-queries';
import { subgraphEscrowTxId } from '@/lib/ingest/rav';
import type {
  PaymentsEscrowAccountsResponse,
  PaymentsEscrowTransactionsResponse,
  GraphTallyTokensCollectedResponse,
  PaymentsOverview,
} from '@/lib/queries';
import { log } from '@/lib/logger';
import { GATEWAY_CANONICAL } from '@/lib/utils';

function aggregateOverview(
  escrow: PaymentsEscrowAccountsResponse,
  txns: PaymentsEscrowTransactionsResponse,
  collectors: GraphTallyTokensCollectedResponse
): PaymentsOverview {
  const accounts = escrow.paymentsEscrowAccounts ?? [];
  const transactions = txns.paymentsEscrowTransactions ?? [];
  const collected = collectors.graphTallyTokensCollecteds ?? [];

  let totalBalance = BigInt(0);
  let totalThawing = BigInt(0);
  const payers = new Set<string>();
  const receivers = new Set<string>();

  for (const acct of accounts) {
    totalBalance += BigInt(acct.balance);
    totalThawing += BigInt(acct.totalAmountThawing);
    payers.add(GATEWAY_CANONICAL[acct.payer.id.toLowerCase()] ?? acct.payer.id.toLowerCase());
    receivers.add(acct.receiver.id);
  }

  let totalCollected = BigInt(0);
  for (const c of collected) {
    totalCollected += BigInt(c.tokens);
  }

  return {
    totalEscrowBalance: totalBalance.toString(),
    totalThawing: totalThawing.toString(),
    totalCollected: totalCollected.toString(),
    activePayers: payers.size,
    activeReceivers: receivers.size,
    escrowAccounts: accounts,
    recentTransactions: transactions,
    topCollectors: collected,
  };
}

/**
 * The nests carrying the folds. `/alloc` fronts graph-allocations-nest, which has carried the tally
 * tables as well since the separate horizon nest retired (2026-09-06). The second knob stays for an
 * operator who keeps the collector on its own nest.
 */
const ALLOC_BASE_PATH = process.env.NUTHATCH_PAYMENTS_BASE_PATH || '/alloc';
const HORIZON_BASE_PATH = process.env.NUTHATCH_HORIZON_BASE_PATH || '/alloc';

interface NestEscrowAccount { payer: string; collector: string; receiver: string; balance: string; thawing: string; thaw_end: string }
interface NestEscrowTx { tx_hash: string; log_index: number; block_timestamp: number; payer: string; receiver: string; amount: string; type: string; allocation_id: string | null }
interface NestTally { payer: string; receiver: string; collection_id: string; tokens: string }

/**
 * The same overview from two nests (nightswatchhq/nuthatch#1078). Every id is rebuilt in the
 * subgraph's own encoding so a consumer keyed on ids sees no change: an escrow account is the three
 * addresses concatenated, a tally row is payer, receiver and collection concatenated, and a
 * transaction is `txHash || LE32(log_index + 1)`.
 *
 * **Parity, measured at a pinned block.** Every escrow account with a positive balance (336 of 336)
 * agrees on balance, thawing amount and thaw end; every tally aggregate agrees on tokens; and the
 * newest transactions are the same rows. The one deliberate difference: the subgraph's transaction
 * type is only ever `deposit` or `redeem`, and this reports the three escrow events it does not
 * model (`thaw`, `cancel_thaw`, `withdraw`) under their own names. Two such rows exist in the
 * whole history (nuthatch#1114).
 */
async function overviewFromNests(receiver: string | null): Promise<PaymentsOverview> {
  const [accounts, txns, tally] = await Promise.all([
    nuthatchSqlReady<NestEscrowAccount>(escrowAccountsSql(receiver, 100), ALLOC_BASE_PATH),
    nuthatchSqlReady<NestEscrowTx>(escrowTransactionsSql(receiver, receiver ? 100 : 50), ALLOC_BASE_PATH),
    nuthatchSqlReady<NestTally>(tallyCollectedSql(receiver, 50), HORIZON_BASE_PATH),
  ]);
  for (const [name, r] of [['escrow accounts', accounts], ['escrow transactions', txns], ['tally collections', tally]] as const) {
    if (!r.ok) throw Object.assign(new Error(`${name}: ${r.error}`), { nest: r });
  }
  if (!accounts.ok || !txns.ok || !tally.ok) throw new Error('unreachable');

  const escrow: PaymentsEscrowAccountsResponse = {
    paymentsEscrowAccounts: accounts.data.rows.map((a) => ({
      id: `${a.payer}${a.collector.slice(2)}${a.receiver.slice(2)}`,
      payer: { id: a.payer },
      receiver: { id: a.receiver },
      balance: a.balance,
      totalAmountThawing: a.thawing,
      thawEndTimestamp: a.thaw_end,
    })),
  };
  const transactions: PaymentsEscrowTransactionsResponse = {
    paymentsEscrowTransactions: txns.data.rows.map((t) => ({
      id: subgraphEscrowTxId(t.tx_hash, t.log_index),
      type: t.type,
      payer: { id: t.payer },
      receiver: { id: t.receiver },
      allocationId: t.allocation_id ? t.allocation_id.toLowerCase() : null,
      amount: t.amount,
      timestamp: String(t.block_timestamp),
    })),
  };
  const collected: GraphTallyTokensCollectedResponse = {
    graphTallyTokensCollecteds: tally.data.rows.map((c) => ({
      id: `${c.payer}${c.receiver.slice(2)}${c.collection_id.toLowerCase().slice(2)}`,
      payer: { id: c.payer },
      receiver: { id: c.receiver },
      collectionId: c.collection_id.toLowerCase(),
      tokens: c.tokens,
    })),
  };
  return aggregateOverview(escrow, transactions, collected);
}

export async function GET(request: NextRequest) {
  const receiver = request.nextUrl.searchParams.get('receiver');

  if (receiver && !/^0x[0-9a-f]{40}$/.test(receiver.toLowerCase())) {
    return NextResponse.json({ error: 'Invalid receiver address format' }, { status: 400 });
  }

  // From the nest, always (nuthatch#1160). The gateway path this once fell back to left with the key.
  if (!hasNuthatch()) {
    return NextResponse.json({ error: 'Nuthatch is not configured' }, { status: 503 });
  }
  const addr = receiver ? receiver.toLowerCase() : null;
  const cacheKey = addr ? `lodestar:payments:receiver:${addr}:nuthatch:v1` : 'lodestar:payments:overview:nuthatch:v1';
  try {
    const data = await cached(cacheKey, 300, () => overviewFromNests(addr));
    return NextResponse.json({ data, source: 'nuthatch' }, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
    });
  } catch (error) {
    log.api.error({ err: error }, 'Payments from the nests failed');
    return NextResponse.json({ error: 'Failed to load payment data from Nuthatch' }, { status: 503 });
  }
}
