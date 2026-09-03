/**
 * SQL that more than one surface issues against a nest, kept in one place so two callers cannot
 * drift into asking the same question two different ways.
 */

/**
 * Reconstruct the community subgraph's `delegationEvents` feed from the `graph-staking-nest`
 * (RFC-0011 pilot): a UNION over the four HorizonStaking delegation-event tables, mapping each to the
 * subgraph's `eventType` vocabulary (TokensDelegated→"delegation", TokensUndelegated→"undelegation",
 * {DelegatedTokensWithdrawn, StakeDelegatedWithdrawn}→"withdrawal"). Same columns, same order, same
 * filters — a drop-in for the gateway query. `indexer`/`first`/`since` are pre-validated by the caller
 * (address regex, clamped int), so no injection surface reaches the SQL.
 */
export function delegationEventsSql(indexer: string | null, first: number, since: number): string {
  const row = (evType: string, table: string, indexerCol: string) =>
    `SELECT tx_hash || '-' || CAST(log_index AS VARCHAR) AS id, '${evType}' AS "eventType", ` +
    `LOWER(${indexerCol}) AS indexer, LOWER(delegator) AS delegator, CAST(tokens AS VARCHAR) AS tokens, ` +
    `block_timestamp AS ts, tx_hash AS "txHash" FROM "${table}"`;
  const union = [
    row('delegation', 'staking__tokens_delegated', '"serviceProvider"'),
    row('undelegation', 'staking__tokens_undelegated', '"serviceProvider"'),
    row('withdrawal', 'staking__delegated_tokens_withdrawn', '"serviceProvider"'),
    row('withdrawal', 'staking__stake_delegated_withdrawn', 'indexer'),
  ].join(' UNION ALL ');
  const where = [`ts > ${since}`, indexer ? `indexer = '${indexer}'` : null]
    .filter(Boolean)
    .join(' AND ');
  return (
    `SELECT id, "eventType", indexer, delegator, tokens, CAST(ts AS VARCHAR) AS "timestamp", "txHash" ` +
    `FROM (${union}) t WHERE ${where} ORDER BY ts DESC LIMIT ${first}`
  );
}

/**
 * The newest provisions from the horizon nest, which indexes HorizonStaking without an event
 * allowlist and so carries `ProvisionCreated`. The subgraph's `provisions(orderBy: createdAt,
 * orderDirection: desc)` in table form: one row per creation, newest first.
 */
export function newestProvisionsSql(first: number): string {
  return (
    `SELECT tx_hash, log_index, block_number, block_timestamp, LOWER("serviceProvider") AS indexer, ` +
    `LOWER(verifier) AS verifier, CAST(tokens AS VARCHAR) AS tokens FROM staking__provision_created ` +
    `ORDER BY block_number DESC, log_index DESC LIMIT ${first}`
  );
}

// ---------------------------------------------------------------------------------------------
// `api/payments` (nightswatchhq/nuthatch#1078). Three folds, two nests.
// ---------------------------------------------------------------------------------------------

const ADDR = /^0x[0-9a-f]{40}$/;

/** A receiver filter, or nothing. The caller validates the address; this refuses anything else. */
function receiverClause(column: string, receiver: string | null): string {
  if (!receiver) return '';
  if (!ADDR.test(receiver)) throw new Error(`not an address: ${receiver}`);
  return ` AND LOWER(${column}) = '${receiver}'`;
}

/**
 * The subgraph's `paymentsEscrowAccounts`, folded from the five PaymentsEscrow events. An account
 * is keyed by (payer, collector, receiver), which is also how the subgraph builds its id (the three
 * addresses concatenated). Balance is deposits less withdrawals less collections; the thawing
 * state is whatever the newest of Thaw / CancelThaw / Withdraw left behind, because a thaw
 * replaces rather than accumulates and either of the other two clears it. Measured against the
 * subgraph on every account with a positive balance: identical.
 */
export function escrowAccountsSql(receiver: string | null, first: number): string {
  const rc = receiverClause('receiver', receiver);
  return (
    `WITH mv AS (` +
    `SELECT LOWER(payer) p, LOWER(collector) c, LOWER(receiver) r, CAST(tokens AS HUGEINT) d FROM escrow__deposit WHERE 1=1${rc} ` +
    `UNION ALL SELECT LOWER(payer), LOWER(collector), LOWER(receiver), -CAST(tokens AS HUGEINT) FROM escrow__withdraw WHERE 1=1${rc} ` +
    `UNION ALL SELECT LOWER(payer), LOWER(collector), LOWER(receiver), -CAST(tokens AS HUGEINT) FROM escrow__escrow_collected WHERE 1=1${rc}` +
    `), th AS (` +
    `SELECT LOWER(payer) p, LOWER(collector) c, LOWER(receiver) r, block_number, log_index, CAST(tokens AS HUGEINT) t, CAST("thawEndTimestamp" AS HUGEINT) te FROM escrow__thaw WHERE 1=1${rc} ` +
    `UNION ALL SELECT LOWER(payer), LOWER(collector), LOWER(receiver), block_number, log_index, 0, 0 FROM escrow__cancel_thaw WHERE 1=1${rc} ` +
    `UNION ALL SELECT LOWER(payer), LOWER(collector), LOWER(receiver), block_number, log_index, 0, 0 FROM escrow__withdraw WHERE 1=1${rc}` +
    `), last_th AS (` +
    `SELECT p, c, r, t, te FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY p, c, r ORDER BY block_number DESC, log_index DESC) rn FROM th) WHERE rn = 1` +
    `) ` +
    `SELECT mv.p AS payer, mv.c AS collector, mv.r AS receiver, CAST(SUM(mv.d) AS VARCHAR) AS balance, ` +
    `CAST(COALESCE(MAX(lt.t), 0) AS VARCHAR) AS thawing, CAST(COALESCE(MAX(lt.te), 0) AS VARCHAR) AS thaw_end ` +
    `FROM mv LEFT JOIN last_th lt ON lt.p = mv.p AND lt.c = mv.c AND lt.r = mv.r ` +
    `GROUP BY 1, 2, 3 ` +
    (receiver ? '' : 'HAVING SUM(mv.d) > 0 ') +
    `ORDER BY SUM(mv.d) DESC LIMIT ${first}`
  );
}

/**
 * The subgraph's `paymentsEscrowTransactions`, newest first. Every escrow event is a row, typed
 * with the subgraph's vocabulary where it has one (`deposit`, `redeem`) and the event's own name
 * where it does not (`thaw`, `cancel_thaw`, `withdraw` - the subgraph does not model those three,
 * nuthatch#1114). A collection made by the GraphTallyCollector carries the allocation of the
 * SubgraphService fee event in the same transaction with the same payer, provider and amount.
 */
export function escrowTransactionsSql(receiver: string | null, first: number): string {
  const rc = receiverClause('receiver', receiver);
  const tally = '0x8f69f5c07477ac46fbc491b1e6d91e2bb0111a9e';
  const ev = (table: string, type: string) =>
    `SELECT tx_hash, log_index, block_timestamp, LOWER(payer) AS payer, LOWER(receiver) AS receiver, ` +
    `CAST(tokens AS VARCHAR) AS amount, '${type}' AS type, LOWER(collector) AS collector FROM ${table} WHERE 1=1${rc}`;
  const cancel =
    `SELECT tx_hash, log_index, block_timestamp, LOWER(payer), LOWER(receiver), CAST("tokensThawing" AS VARCHAR), 'cancel_thaw', LOWER(collector) FROM escrow__cancel_thaw WHERE 1=1${rc}`;
  return (
    `WITH ev AS (` +
    [ev('escrow__deposit', 'deposit'), ev('escrow__thaw', 'thaw'), cancel, ev('escrow__withdraw', 'withdraw'), ev('escrow__escrow_collected', 'redeem')].join(' UNION ALL ') +
    `), newest AS (SELECT * FROM ev ORDER BY block_timestamp DESC, tx_hash DESC, log_index DESC LIMIT ${first}), ` +
    `fees AS (` +
    `SELECT tx_hash, LOWER(payer) AS payer, LOWER("serviceProvider") AS receiver, CAST("tokensCollected" AS VARCHAR) AS amount, "allocationId" AS allocation_id, ` +
    `ROW_NUMBER() OVER (PARTITION BY tx_hash, LOWER(payer), LOWER("serviceProvider"), CAST("tokensCollected" AS VARCHAR) ORDER BY log_index) AS rn ` +
    `FROM subgraph_service__query_fees_collected WHERE tx_hash IN (SELECT tx_hash FROM newest)` +
    `), ranked AS (` +
    `SELECT n.*, ROW_NUMBER() OVER (PARTITION BY tx_hash, payer, receiver, amount ORDER BY log_index) AS rn FROM newest n WHERE type = 'redeem' AND collector = '${tally}'` +
    `) ` +
    `SELECT n.tx_hash, n.log_index, n.block_timestamp, n.payer, n.receiver, n.amount, n.type, f.allocation_id ` +
    `FROM newest n LEFT JOIN ranked r ON r.tx_hash = n.tx_hash AND r.log_index = n.log_index ` +
    `LEFT JOIN fees f ON f.tx_hash = r.tx_hash AND f.payer = r.payer AND f.receiver = r.receiver AND f.amount = r.amount AND f.rn = r.rn ` +
    `ORDER BY n.block_timestamp DESC, n.tx_hash DESC, n.log_index DESC`
  );
}

/**
 * The subgraph's `graphTallyTokensCollecteds`: tokens summed per (payer, receiver, collectionId)
 * over the GraphTallyCollector's `PaymentCollected`, which is also how the subgraph builds its id.
 * Lives on the horizon nest, which is the one indexing the collector today. Measured against the
 * subgraph on every group: identical.
 */
export function tallyCollectedSql(receiver: string | null, first: number): string {
  const rc = receiverClause('receiver', receiver);
  return (
    `SELECT LOWER(payer) AS payer, LOWER(receiver) AS receiver, "collectionId" AS collection_id, ` +
    `CAST(SUM(CAST(tokens AS HUGEINT)) AS VARCHAR) AS tokens FROM tally__payment_collected WHERE 1=1${rc} ` +
    `GROUP BY 1, 2, 3 ORDER BY SUM(CAST(tokens AS HUGEINT)) DESC LIMIT ${first}`
  );
}

// ---------------------------------------------------------------------------------------------
// `api/poi` (nightswatchhq/nuthatch#1078).
// ---------------------------------------------------------------------------------------------

const ZERO_POI = '0x0000000000000000000000000000000000000000000000000000000000000000';

/**
 * The subgraph's `allocations(where: { status: Closed, poi_not: 0x0 }, orderBy: closedAt desc)`,
 * as the POI consensus computation reads it: the allocation, its indexer, and its deployment's
 * current signal and stake. Stake is the sum of the deployment's active allocations, which is what
 * `subgraphDeployment.stakedTokens` is. Signal is the view's `signalled_tokens`, so it is only as
 * right as the view: its first fold was gross of curation tax and blind to fees collected into the
 * pool, and the correction (graph-allocations-nest#10) lands with the nest's redeploy.
 */
export function poiAllocationsSql(deployment: string | null, first: number): string {
  if (deployment && !/^0x[0-9a-f]{64}$/.test(deployment)) throw new Error(`not a deployment id: ${deployment}`);
  const dep = deployment ? ` AND a.subgraph_deployment = '${deployment}'` : '';
  return (
    `WITH staked AS (SELECT subgraph_deployment, CAST(SUM(CAST(allocated_tokens AS HUGEINT)) AS VARCHAR) AS staked ` +
    `FROM lodestar_allocations WHERE status = 'Active' GROUP BY 1) ` +
    `SELECT a.id, a.poi, a.indexer, CAST(a.allocated_tokens AS VARCHAR) AS allocated_tokens, a.closed_at_epoch, a.closed_at, ` +
    `a.subgraph_deployment, CAST(a.signalled_tokens AS VARCHAR) AS signalled_tokens, COALESCE(s.staked, '0') AS staked_tokens ` +
    `FROM lodestar_allocations a LEFT JOIN staked s ON s.subgraph_deployment = a.subgraph_deployment ` +
    `WHERE a.status = 'Closed' AND a.poi IS NOT NULL AND a.poi <> '${ZERO_POI}'${dep} ` +
    `ORDER BY a.closed_at DESC, a.id DESC LIMIT ${first}`
  );
}
