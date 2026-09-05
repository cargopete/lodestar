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

/**
 * The subgraph's `indexers(...)` list from `graph-allocations-nest`'s `lodestar_indexers` view
 * (nuthatch#1160). The view folds stake, the delegation pool, cuts, rewards, fees and the service
 * registry from events, and was measured exact against `HorizonStaking.getServiceProvider` and
 * `getDelegationPool` on every indexer with stake. `orderBy` is one of the subgraph's field names and
 * is mapped here to a column; the caller validates it against `INDEXERS_ORDER_BY` first, so nothing
 * unvalidated reaches the SQL. `first`/`skip` are clamped ints. The one excluded address is the one
 * the gateway query excludes today, kept so the two lists agree.
 */
export const INDEXERS_ORDER_BY: Record<string, string> = {
  stakedTokens: 'staked_tokens',
  delegatedTokens: 'delegated_tokens',
  allocatedTokens: 'allocated_tokens',
  id: 'id',
  createdAt: 'created_at',
  queryFeesCollected: 'query_fees_collected',
  rewardsEarned: 'rewards_earned',
};
export const INDEXERS_EXCLUDED = '0xb43b2cccceada5292732a8c58ae134adefce09bb';

export function indexersSql(first: number, skip: number, orderBy: string, orderDirection: 'asc' | 'desc'): string {
  const col = INDEXERS_ORDER_BY[orderBy] ?? 'staked_tokens';
  return (
    `SELECT id, CAST(staked_tokens AS VARCHAR) AS staked_tokens, CAST(locked_tokens AS VARCHAR) AS locked_tokens, ` +
    `CAST(delegated_tokens AS VARCHAR) AS delegated_tokens, CAST(allocated_tokens AS VARCHAR) AS allocated_tokens, ` +
    `allocation_count, indexing_reward_cut, query_fee_cut, last_delegation_parameter_update, ` +
    `CAST(rewards_earned AS VARCHAR) AS rewards_earned, CAST(query_fees_collected AS VARCHAR) AS query_fees_collected, ` +
    `CAST(delegator_shares AS VARCHAR) AS delegator_shares, url, geohash, created_at ` +
    `FROM lodestar_indexers WHERE staked_tokens > 0 AND id <> '${INDEXERS_EXCLUDED}' ` +
    `ORDER BY ${col} ${orderDirection === 'asc' ? 'ASC' : 'DESC'}, id ASC LIMIT ${first} OFFSET ${skip}`
  );
}

/** One row of `indexersSql`, as the nest returns it: wei as decimal strings, counts as numbers. */
export interface NestIndexerRow {
  id: string;
  staked_tokens: string;
  locked_tokens: string;
  delegated_tokens: string;
  allocated_tokens: string;
  allocation_count: number;
  indexing_reward_cut: number | string | null;
  query_fee_cut: number | string | null;
  last_delegation_parameter_update: number | null;
  rewards_earned: string;
  query_fees_collected: string;
  delegator_shares: string;
  url: string | null;
  geohash: string | null;
  created_at: number;
}

/**
 * The subgraph's `curators(orderBy: totalSignalledTokens, where: {totalSignalledTokens_gt: 0,
 * activeSignalCount_gt: 0})` from `lodestar_curators` (nuthatch#1160). The GNS contract appears as a
 * Curation-level curator on L2 because name signal is routed through it; the view flags that row and
 * this query drops it, which is what the gateway list effectively shows. `realized_rewards` is the
 * subgraph's own unimplemented zero, carried so the page's column keeps its meaning.
 */
export function curatorsSql(first: number, skip: number): string {
  return (
    `SELECT id, CAST(total_signalled_tokens AS VARCHAR) AS total_signalled_tokens, ` +
    `CAST(total_unsignalled_tokens AS VARCHAR) AS total_unsignalled_tokens, ` +
    `CAST(realized_rewards AS VARCHAR) AS realized_rewards, signal_count, active_signal_count ` +
    `FROM lodestar_curators WHERE total_signalled_tokens > 0 AND active_signal_count > 0 AND NOT is_gns ` +
    `ORDER BY total_signalled_tokens DESC, id ASC LIMIT ${first} OFFSET ${skip}`
  );
}

export interface NestCuratorRow {
  id: string;
  total_signalled_tokens: string;
  total_unsignalled_tokens: string;
  realized_rewards: string;
  signal_count: number;
  active_signal_count: number;
}

/**
 * The `graphNetwork` singleton from `lodestar_network` (one row) and the parameters beside it from
 * `lodestar_network_params` (one row; nuthatch#1160). Two queries because they are two views with
 * two cadences: the aggregates fold every event, the parameters are pinned samples and the epoch
 * manager's last update.
 */
export const networkSql = () =>
  `SELECT CAST(total_tokens_staked AS VARCHAR) AS total_tokens_staked, CAST(total_delegated_tokens AS VARCHAR) AS total_delegated_tokens, ` +
  `CAST(total_tokens_signalled AS VARCHAR) AS total_tokens_signalled, CAST(total_tokens_allocated AS VARCHAR) AS total_tokens_allocated, ` +
  `CAST(total_indexing_rewards AS VARCHAR) AS total_indexing_rewards, CAST(total_query_fees AS VARCHAR) AS total_query_fees, ` +
  `CAST(total_supply AS VARCHAR) AS total_supply, CAST(issuance_per_block AS VARCHAR) AS issuance_per_block, ` +
  `CAST(bridge_minted AS VARCHAR) AS bridge_minted, CAST(bridge_burned AS VARCHAR) AS bridge_burned, ` +
  `indexer_count, staked_indexers_count, delegator_count, active_delegator_count, curator_count, active_curator_count, ` +
  `subgraph_count, active_subgraph_count, current_epoch FROM lodestar_network`;

export const networkParamsSql = () =>
  `SELECT delegation_ratio, curation_tax_percentage, protocol_payment_cut, max_thawing_period_seconds, ` +
  `epoch_length, last_length_update_epoch, last_length_update_block, ` +
  `CAST(total_curation_tax AS VARCHAR) AS total_curation_tax, CAST(total_protocol_tax AS VARCHAR) AS total_protocol_tax ` +
  `FROM lodestar_network_params`;

export interface NestNetworkRow {
  total_tokens_staked: string; total_delegated_tokens: string; total_tokens_signalled: string; total_tokens_allocated: string;
  total_indexing_rewards: string; total_query_fees: string; total_supply: string | null; issuance_per_block: string | null;
  bridge_minted: string | null; bridge_burned: string | null;
  indexer_count: number; staked_indexers_count: number; delegator_count: number; active_delegator_count: number;
  curator_count: number; active_curator_count: number; subgraph_count: number; active_subgraph_count: number; current_epoch: number;
}
export interface NestNetworkParamsRow {
  delegation_ratio: number | string | null; curation_tax_percentage: number | string | null; protocol_payment_cut: number | string | null;
  max_thawing_period_seconds: number | string | null; epoch_length: number | string | null;
  last_length_update_epoch: number | string | null; last_length_update_block: number | null;
  total_curation_tax: string | null; total_protocol_tax: string | null;
}

/**
 * The subgraph's `epoches(orderBy: startBlock, orderDirection: desc)` from `lodestar_epochs`, newest
 * first, with the columns both `api/epochs` and `lib/ingest/epochs.ts` read. `since_epoch` is the
 * ingest cursor (epochs strictly after it, ascending); `first` is a clamped int.
 */
export function epochsSql(first: number, sinceEpoch: number | null = null): string {
  const where = sinceEpoch === null ? '' : `WHERE id > ${sinceEpoch} `;
  const order = sinceEpoch === null ? 'ORDER BY id DESC' : 'ORDER BY id ASC';
  return (
    `SELECT id, start_block, end_block, CAST(signalled_tokens AS VARCHAR) AS signalled_tokens, ` +
    `CAST(stake_deposited AS VARCHAR) AS stake_deposited, CAST(total_rewards AS VARCHAR) AS total_rewards, ` +
    `CAST(total_indexer_rewards AS VARCHAR) AS total_indexer_rewards, CAST(total_delegator_rewards AS VARCHAR) AS total_delegator_rewards, ` +
    `CAST(query_fees_collected AS VARCHAR) AS query_fees_collected, CAST(curator_query_fees AS VARCHAR) AS curator_query_fees, ` +
    `CAST(taxed_query_fees AS VARCHAR) AS taxed_query_fees ` +
    `FROM lodestar_epochs ${where}${order} LIMIT ${first}`
  );
}
export interface NestEpochRow {
  id: number | string; start_block: number; end_block: number | string;
  signalled_tokens: string; stake_deposited: string; total_rewards: string; total_indexer_rewards: string;
  total_delegator_rewards: string; query_fees_collected: string; curator_query_fees: string; taxed_query_fees: string;
}
/** Gross query fees, the subgraph's `totalQueryFees`: the view's collected figure is net of curators and the protocol cut. */
export function epochTotalQueryFees(r: NestEpochRow): string {
  return (BigInt(r.query_fees_collected) + BigInt(r.curator_query_fees) + BigInt(r.taxed_query_fees)).toString();
}

/** `api/indexer/[address]`: the indexer's own row (nuthatch#1160). `addr` is a validated lower-case address. */
export function indexerDetailSql(addr: string): string {
  return (
    `SELECT id, CAST(staked_tokens AS VARCHAR) AS staked_tokens, CAST(locked_tokens AS VARCHAR) AS locked_tokens, locked_until, ` +
    `CAST(delegated_tokens AS VARCHAR) AS delegated_tokens, CAST(delegated_thawing_tokens AS VARCHAR) AS delegated_thawing_tokens, ` +
    `CAST(allocated_tokens AS VARCHAR) AS allocated_tokens, allocation_count, indexing_reward_cut, query_fee_cut, ` +
    `last_delegation_parameter_update, CAST(rewards_earned AS VARCHAR) AS rewards_earned, ` +
    `CAST(query_fees_collected AS VARCHAR) AS query_fees_collected, CAST(delegator_shares AS VARCHAR) AS delegator_shares, ` +
    `CAST(provisioned_tokens AS VARCHAR) AS provisioned_tokens, url, geohash, created_at ` +
    `FROM lodestar_indexers WHERE id = '${addr}'`
  );
}
/** Operators the indexer currently allows: the newest `allowed` per operator across both eras' events. */
export function indexerOperatorsSql(addr: string): string {
  return (
    `SELECT operator FROM (SELECT LOWER(operator) AS operator, allowed, ` +
    `ROW_NUMBER() OVER (PARTITION BY LOWER(operator) ORDER BY block_number DESC, log_index DESC) AS rn FROM (` +
    `SELECT operator, allowed, block_number, log_index FROM staking__operator_set WHERE LOWER("serviceProvider") = '${addr}' ` +
    `UNION ALL SELECT operator, allowed, block_number, log_index FROM staking_legacy__set_operator WHERE LOWER(indexer) = '${addr}')) ` +
    `WHERE rn = 1 AND allowed ORDER BY operator`
  );
}
/** The indexer's delegators, largest first: the subgraph's `indexer.delegators(orderBy: stakedTokens)`. */
export function indexerDelegatorsSql(addr: string, first: number): string {
  return (
    `SELECT id, delegator, CAST(staked_tokens AS VARCHAR) AS staked_tokens, CAST(share_amount AS VARCHAR) AS share_amount ` +
    `FROM lodestar_delegator_stakes WHERE indexer = '${addr}' AND active ORDER BY share_amount DESC, delegator ASC LIMIT ${first}`
  );
}
/**
 * Active allocations with the deployment's live signal and total active stake beside each, which is
 * what the subgraph's `subgraphDeployment { signalledTokens stakedTokens }` carried.
 */
export function indexerActiveAllocationsSql(addr: string): string {
  return (
    `SELECT a.id, CAST(a.allocated_tokens AS VARCHAR) AS allocated_tokens, a.created_at_epoch, a.subgraph_deployment, ` +
    `CAST(a.signalled_tokens AS VARCHAR) AS signalled_tokens, ` +
    `CAST((SELECT SUM(allocated_tokens) FROM lodestar_allocations d WHERE d.subgraph_deployment = a.subgraph_deployment AND d.status = 'Active') AS VARCHAR) AS deployment_staked_tokens ` +
    `FROM lodestar_allocations a WHERE LOWER(a.indexer) = '${addr}' AND a.status = 'Active' ORDER BY a.id`
  );
}
/** The newest closed allocations, capped as the gateway path caps them. */
export function indexerClosedAllocationsSql(addr: string, first: number): string {
  return (
    `SELECT id, CAST(allocated_tokens AS VARCHAR) AS allocated_tokens, created_at_epoch, closed_at_epoch, closed_at, ` +
    `CAST(indexing_rewards AS VARCHAR) AS indexing_rewards, CAST(query_fees_collected AS VARCHAR) AS query_fees_collected, poi, force_closed, subgraph_deployment ` +
    `FROM lodestar_allocations WHERE LOWER(indexer) = '${addr}' AND status = 'Closed' ORDER BY closed_at DESC, id LIMIT ${first}`
  );
}
export const delegationRatioSql = () => `SELECT delegation_ratio FROM lodestar_network_params`;

export interface NestIndexerDetailRow extends NestIndexerRow {
  locked_until: number | string | null; delegated_thawing_tokens: string; provisioned_tokens: string;
}
export interface NestDelegatorRow { id: string; delegator: string; staked_tokens: string; share_amount: string }
export interface NestActiveAllocationRow {
  id: string; allocated_tokens: string; created_at_epoch: number | string; subgraph_deployment: string;
  signalled_tokens: string; deployment_staked_tokens: string | null;
}
export interface NestClosedAllocationRow {
  id: string; allocated_tokens: string; created_at_epoch: number | string; closed_at_epoch: number | string | null;
  closed_at: number | null; indexing_rewards: string; query_fees_collected: string; poi: string | null;
  force_closed: boolean | null; subgraph_deployment: string;
}

/**
 * `api/provisions` (nuthatch#1160): an indexer's provisions across every data service, or a data
 * service's provisions with the indexer's stake beside each, from `lodestar_provisions` and
 * `lodestar_indexers`. Allocation figures are null in the view for any verifier but the subgraph
 * service and read as 0 here, which is also what the subgraph reports for them.
 */
const PROVISION_COLS =
  `p.id, p.indexer, p.data_service, CAST(p.tokens_provisioned AS VARCHAR) AS tokens_provisioned, ` +
  `CAST(COALESCE(p.tokens_allocated, 0) AS VARCHAR) AS tokens_allocated, CAST(p.tokens_thawing AS VARCHAR) AS tokens_thawing, ` +
  `p.max_verifier_cut, p.thawing_period, p.created_at, COALESCE(p.allocation_count, 0) AS allocation_count, ` +
  `CAST(COALESCE(p.rewards_earned, 0) AS VARCHAR) AS rewards_earned, CAST(COALESCE(p.query_fees_collected, 0) AS VARCHAR) AS query_fees_collected`;
export function provisionsByIndexerSql(addr: string): string {
  return `SELECT ${PROVISION_COLS} FROM lodestar_provisions p WHERE p.indexer = '${addr}' AND p.tokens_provisioned > 0 ORDER BY p.tokens_provisioned DESC, p.data_service`;
}
export function provisionsByServiceSql(addr: string, first: number, skip: number): string {
  return (
    `SELECT ${PROVISION_COLS}, CAST(i.staked_tokens AS VARCHAR) AS indexer_staked_tokens, CAST(i.delegated_tokens AS VARCHAR) AS indexer_delegated_tokens ` +
    `FROM lodestar_provisions p LEFT JOIN lodestar_indexers i ON i.id = p.indexer ` +
    `WHERE p.data_service = '${addr}' AND p.tokens_provisioned > 0 ORDER BY p.tokens_provisioned DESC, p.indexer LIMIT ${first} OFFSET ${skip}`
  );
}
/** The data service's totals the subgraph carried on `dataService { totalTokensProvisioned totalTokensAllocated }`. */
export function dataServiceTotalsSql(addrs: string[]): string {
  const list = addrs.map((a) => `'${a}'`).join(', ');
  return (
    `SELECT data_service, CAST(SUM(tokens_provisioned) AS VARCHAR) AS total_tokens_provisioned, ` +
    `CAST(SUM(COALESCE(tokens_allocated, 0)) AS VARCHAR) AS total_tokens_allocated FROM lodestar_provisions ` +
    `WHERE data_service IN (${list}) GROUP BY 1`
  );
}
export interface NestProvisionRow {
  id: string; indexer: string; data_service: string; tokens_provisioned: string; tokens_allocated: string; tokens_thawing: string;
  max_verifier_cut: number | string | null; thawing_period: number | string | null; created_at: number | null;
  allocation_count: number; rewards_earned: string; query_fees_collected: string;
  indexer_staked_tokens?: string | null; indexer_delegated_tokens?: string | null;
}
export interface NestDataServiceTotalsRow { data_service: string; total_tokens_provisioned: string; total_tokens_allocated: string }

/**
 * The delegator portfolio (nuthatch#1160): the subgraph's `Delegator` from `lodestar_delegators`, its
 * `stakes` from `lodestar_delegator_stakes` with the indexer's figures beside each, and the curator
 * portfolio from `lodestar_curators` and `lodestar_curator_signals`. `addr` is a validated address.
 */
export const delegatorSql = (addr: string) =>
  `SELECT id, CAST(total_staked_tokens AS VARCHAR) AS total_staked_tokens, CAST(total_unstaked_tokens AS VARCHAR) AS total_unstaked_tokens, ` +
  `CAST(total_realized_rewards AS VARCHAR) AS total_realized_rewards, stakes_count, active_stakes_count FROM lodestar_delegators WHERE id = '${addr}'`;
export const delegatorStakesSql = (addr: string, first: number, activeOnly = false) =>
  `SELECT s.id, s.indexer, CAST(s.staked_tokens AS VARCHAR) AS staked_tokens, CAST(s.share_amount AS VARCHAR) AS share_amount, ` +
  `CAST(s.locked_tokens AS VARCHAR) AS locked_tokens, s.locked_until, CAST(s.realized_rewards AS VARCHAR) AS realized_rewards, ` +
  `CAST(s.total_undelegated_tokens AS VARCHAR) AS unstaked_tokens, s.created_at, s.last_undelegated_at, s.active, ` +
  `CAST(i.staked_tokens AS VARCHAR) AS indexer_staked_tokens, CAST(i.delegated_tokens AS VARCHAR) AS indexer_delegated_tokens, ` +
  `CAST(i.delegated_thawing_tokens AS VARCHAR) AS indexer_delegated_thawing_tokens, CAST(i.delegator_shares AS VARCHAR) AS indexer_delegator_shares, ` +
  `i.indexing_reward_cut, i.query_fee_cut, i.allocation_count, i.url, i.geohash ` +
  `FROM lodestar_delegator_stakes s LEFT JOIN lodestar_indexers i ON i.id = s.indexer ` +
  `WHERE s.delegator = '${addr}'${activeOnly ? ' AND s.active' : ''} ORDER BY s.staked_tokens DESC, s.indexer LIMIT ${first}`;
export const curatorSql = (addr: string) =>
  `SELECT id, CAST(total_signalled_tokens AS VARCHAR) AS total_signalled_tokens, CAST(total_unsignalled_tokens AS VARCHAR) AS total_unsignalled_tokens, ` +
  `CAST(realized_rewards AS VARCHAR) AS realized_rewards, signal_count, active_signal_count FROM lodestar_curators WHERE id = '${addr}'`;
export const curatorSignalsSql = (addr: string, first: number) =>
  `SELECT id, subgraph_deployment, CAST(signalled_tokens AS VARCHAR) AS signalled_tokens, CAST(unsignalled_tokens AS VARCHAR) AS unsignalled_tokens, ` +
  `CAST(signal AS VARCHAR) AS signal, last_signal_change, CAST(realized_rewards AS VARCHAR) AS realized_rewards, ` +
  `CAST(deployment_signalled_tokens AS VARCHAR) AS deployment_signalled_tokens, CAST(deployment_query_fees_amount AS VARCHAR) AS deployment_query_fees_amount, ` +
  `CAST(deployment_staked_tokens AS VARCHAR) AS deployment_staked_tokens ` +
  `FROM lodestar_curator_signals WHERE curator = '${addr}' ORDER BY signalled_tokens DESC, subgraph_deployment LIMIT ${first}`;

export interface NestDelegatorTotalsRow { id: string; total_staked_tokens: string; total_unstaked_tokens: string; total_realized_rewards: string; stakes_count: number; active_stakes_count: number }
export interface NestDelegatorStakeRow {
  id: string; indexer: string; staked_tokens: string; share_amount: string; locked_tokens: string; locked_until: number | string | null;
  realized_rewards: string; unstaked_tokens: string; created_at: number | null; last_undelegated_at: number | null; active: boolean;
  indexer_staked_tokens: string | null; indexer_delegated_tokens: string | null; indexer_delegated_thawing_tokens: string | null;
  indexer_delegator_shares: string | null; indexing_reward_cut: number | string | null; query_fee_cut: number | string | null;
  allocation_count: number | null; url: string | null; geohash: string | null;
}
export interface NestCuratorTotalsRow { id: string; total_signalled_tokens: string; total_unsignalled_tokens: string; realized_rewards: string; signal_count: number; active_signal_count: number }
export interface NestCuratorSignalRow {
  id: string; subgraph_deployment: string; signalled_tokens: string; unsignalled_tokens: string; signal: string; last_signal_change: number | null;
  realized_rewards: string; deployment_signalled_tokens: string; deployment_query_fees_amount: string; deployment_staked_tokens: string;
}

/**
 * `api/indexer-stake-history` (nuthatch#1160): own stake and delegation pool as of each of a list of
 * Unix times, summed from `lodestar_indexer_ledger`. The gateway path asked the subgraph for 27
 * block-pinned snapshots; here the ledger is summed up to each cutoff in one query. `cutoffs` are
 * integers the caller computed; `addr` is a validated address.
 */
export function indexerStakeHistorySql(addr: string, cutoffs: number[]): string {
  const values = cutoffs.map((c) => `(${Math.floor(c)})`).join(', ');
  return (
    `SELECT c.cutoff, ` +
    `CAST(COALESCE((SELECT SUM(stake_delta) FROM lodestar_indexer_ledger l WHERE l.indexer = '${addr}' AND l.ts <= c.cutoff), 0) AS VARCHAR) AS staked_tokens, ` +
    `CAST(COALESCE((SELECT SUM(pool_delta) FROM lodestar_indexer_ledger l WHERE l.indexer = '${addr}' AND l.ts <= c.cutoff), 0) AS VARCHAR) AS delegated_tokens ` +
    `FROM (VALUES ${values}) AS c(cutoff) ORDER BY c.cutoff`
  );
}
export interface NestStakeHistoryRow { cutoff: number | string; staked_tokens: string; delegated_tokens: string }

/** `api/indexing-status` (nuthatch#1160): a deployment's live figures and its active allocations, largest first. `depId` is a bytes32 id. */
export const deploymentSql = (depId: string) =>
  `SELECT subgraph_deployment, CAST(MAX(signalled_tokens) AS VARCHAR) AS signalled_tokens, ` +
  `CAST(SUM(allocated_tokens) FILTER (WHERE status = 'Active') AS VARCHAR) AS staked_tokens, COUNT(*) AS allocations ` +
  `FROM lodestar_allocations WHERE LOWER(subgraph_deployment) = '${depId.toLowerCase()}' GROUP BY 1`;
export const allocationsByDeploymentSql = (depId: string, first: number) =>
  `SELECT LOWER(a.indexer) AS indexer, i.url, CAST(a.allocated_tokens AS VARCHAR) AS allocated_tokens ` +
  `FROM lodestar_allocations a LEFT JOIN lodestar_indexers i ON i.id = LOWER(a.indexer) ` +
  `WHERE LOWER(a.subgraph_deployment) = '${depId.toLowerCase()}' AND a.status = 'Active' ORDER BY a.allocated_tokens DESC, a.indexer LIMIT ${first}`;
export interface NestDeploymentRow { subgraph_deployment: string; signalled_tokens: string | null; staked_tokens: string | null; allocations: number }
export interface NestDeploymentAllocationRow { indexer: string; url: string | null; allocated_tokens: string }
