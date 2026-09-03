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
