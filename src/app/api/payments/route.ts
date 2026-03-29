import { NextRequest, NextResponse } from 'next/server';
import { cached } from '@/lib/cache';
import { subgraphQuery, hasSubgraphAccess } from '@/lib/subgraph';
import type {
  PaymentsEscrowAccountsResponse,
  PaymentsEscrowTransactionsResponse,
  GraphTallyTokensCollectedResponse,
  PaymentsOverview,
} from '@/lib/queries';

const ESCROW_ACCOUNTS_QUERY = `{
  paymentsEscrowAccounts(
    first: 100
    orderBy: balance
    orderDirection: desc
    where: { balance_gt: "0" }
  ) {
    id
    sender { id }
    receiver { id }
    balance
    totalAmountThawing
    thawEndTimestamp
  }
}`;

const RECENT_TRANSACTIONS_QUERY = `{
  paymentsEscrowTransactions(
    first: 50
    orderBy: timestamp
    orderDirection: desc
  ) {
    id
    type
    sender { id }
    receiver { id }
    amount
    timestamp
  }
}`;

const TOP_COLLECTORS_QUERY = `{
  graphTallyTokensCollecteds(
    first: 50
    orderBy: tokens
    orderDirection: desc
  ) {
    id
    sender { id }
    receiver { id }
    tokens
  }
}`;

function receiverQuery(receiver: string) {
  const addr = receiver.toLowerCase();
  return {
    escrow: `{
      paymentsEscrowAccounts(
        first: 100
        where: { receiver: "${addr}" }
        orderBy: balance
        orderDirection: desc
      ) {
        id
        sender { id }
        receiver { id }
        balance
        totalAmountThawing
        thawEndTimestamp
      }
    }`,
    transactions: `{
      paymentsEscrowTransactions(
        first: 100
        where: { receiver: "${addr}" }
        orderBy: timestamp
        orderDirection: desc
      ) {
        id
        type
        sender { id }
        receiver { id }
        amount
        timestamp
      }
    }`,
    collected: `{
      graphTallyTokensCollecteds(
        first: 50
        where: { receiver: "${addr}" }
        orderBy: tokens
        orderDirection: desc
      ) {
        id
        sender { id }
        receiver { id }
        tokens
      }
    }`,
  };
}

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
  const senders = new Set<string>();
  const receivers = new Set<string>();

  for (const acct of accounts) {
    totalBalance += BigInt(acct.balance);
    totalThawing += BigInt(acct.totalAmountThawing);
    senders.add(acct.sender.id);
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
    activeSenders: senders.size,
    activeReceivers: receivers.size,
    escrowAccounts: accounts,
    recentTransactions: transactions,
    topCollectors: collected,
  };
}

export async function GET(request: NextRequest) {
  if (!hasSubgraphAccess()) {
    return NextResponse.json({ error: 'No API key configured' }, { status: 503 });
  }

  const receiver = request.nextUrl.searchParams.get('receiver');

  try {
    if (receiver) {
      const queries = receiverQuery(receiver);
      const cacheKey = `lodestar:payments:receiver:${receiver.toLowerCase()}`;

      const data = await cached(cacheKey, 300, async () => {
        const [escrow, txns, collected] = await Promise.all([
          subgraphQuery<PaymentsEscrowAccountsResponse>(queries.escrow),
          subgraphQuery<PaymentsEscrowTransactionsResponse>(queries.transactions),
          subgraphQuery<GraphTallyTokensCollectedResponse>(queries.collected),
        ]);
        return aggregateOverview(escrow, txns, collected);
      });

      return NextResponse.json({ data }, {
        headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
      });
    }

    // Network-wide overview
    const data = await cached('lodestar:payments:overview', 300, async () => {
      const [escrow, txns, collectors] = await Promise.all([
        subgraphQuery<PaymentsEscrowAccountsResponse>(ESCROW_ACCOUNTS_QUERY),
        subgraphQuery<PaymentsEscrowTransactionsResponse>(RECENT_TRANSACTIONS_QUERY),
        subgraphQuery<GraphTallyTokensCollectedResponse>(TOP_COLLECTORS_QUERY),
      ]);
      return aggregateOverview(escrow, txns, collectors);
    });

    return NextResponse.json({ data }, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
    });
  } catch (error) {
    console.error('Payments API error:', error);
    return NextResponse.json({ error: 'Failed to fetch payment data' }, { status: 500 });
  }
}
