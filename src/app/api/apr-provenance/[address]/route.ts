import { NextRequest, NextResponse } from 'next/server';
import { cached } from '@/lib/cache';
import { db, hasDbAccess } from '@/lib/db';
import { subgraphQuery, ensQuery, hasSubgraphAccess } from '@/lib/subgraph';
import { reconcileDelegationPool, type PoolReconciliation } from '@/lib/staking-pool-contract';
import { log } from '@/lib/logger';

const ETH_ADDRESS_RE = /^0x[0-9a-f]{40}$/;

/** A single entry in the "why did my APR change" trail. */
export interface ProvenanceEvent {
  kind: 'delegation' | 'undelegation' | 'withdrawal' | 'reward_cut' | 'query_fee_cut';
  timestamp: string; // ISO
  /** GRT amount for delegation/undelegation/withdrawal events */
  tokensGRT?: number;
  /** Delegator address (lowercase) for delegation events */
  delegator?: string;
  /** Resolved ENS name for the delegator, if any */
  delegatorName?: string | null;
  /** PPM values for parameter-change events */
  oldValue?: number | null;
  newValue?: number;
}

export interface AprProvenanceResponse {
  reconcile: PoolReconciliation | null;
  events: ProvenanceEvent[];
}

const EVENT_TYPE_MAP: Record<string, ProvenanceEvent['kind']> = {
  delegation: 'delegation',
  undelegation: 'undelegation',
  withdrawal: 'withdrawal',
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address } = await params;
  const addr = address.toLowerCase();

  if (!ETH_ADDRESS_RE.test(addr)) {
    return NextResponse.json({ error: 'Invalid address format' }, { status: 400 });
  }

  try {
    const data = await cached<AprProvenanceResponse>(`lodestar:apr-provenance:${addr}`, 120, async () => {
      // 1. On-chain reconcile — needs the current subgraph pool figures as the
      //    comparison baseline. Degrades gracefully if either side is missing.
      let reconcile: PoolReconciliation | null = null;
      if (hasSubgraphAccess()) {
        try {
          const sg = await subgraphQuery<{ indexer: { delegatedTokens: string; delegatedThawingTokens: string } | null }>(`{
            indexer(id: "${addr}") {
              delegatedTokens
              delegatedThawingTokens
            }
          }`);
          if (sg.indexer) {
            reconcile = await reconcileDelegationPool(
              addr,
              sg.indexer.delegatedTokens,
              sg.indexer.delegatedThawingTokens ?? '0',
            );
          }
        } catch (e) {
          log.api.warn({ err: e }, 'apr-provenance reconcile failed (non-critical)');
        }
      }

      // 2. Event trail — full history from our own DB (delegation_events +
      //    parameter_changes), so we can explain jumps older than the 7-day
      //    subgraph window everyone else is limited to.
      const events: ProvenanceEvent[] = [];
      if (hasDbAccess() && db) {
        const [delegationRows, paramRows] = await Promise.all([
          db`
            SELECT event_type, delegator, tokens_grt, timestamp
            FROM delegation_events
            WHERE indexer = ${addr}
            ORDER BY timestamp DESC
            LIMIT 30
          `,
          db`
            SELECT DISTINCT ON (param_name, old_value, new_value, epoch)
              param_name, old_value, new_value, detected_at
            FROM parameter_changes
            WHERE indexer_address = ${addr}
            ORDER BY param_name, old_value, new_value, epoch, detected_at DESC
          `,
        ]);

        for (const r of delegationRows) {
          const kind = EVENT_TYPE_MAP[String(r.event_type)];
          if (!kind) continue;
          events.push({
            kind,
            timestamp: r.timestamp instanceof Date ? r.timestamp.toISOString() : String(r.timestamp),
            tokensGRT: r.tokens_grt != null ? Number(r.tokens_grt) : undefined,
            delegator: r.delegator ? String(r.delegator).toLowerCase() : undefined,
            delegatorName: null,
          });
        }

        for (const r of paramRows) {
          const name = String(r.param_name);
          const kind: ProvenanceEvent['kind'] | null =
            name === 'reward_cut' ? 'reward_cut' : name === 'query_fee_cut' ? 'query_fee_cut' : null;
          if (!kind) continue;
          events.push({
            kind,
            timestamp: r.detected_at instanceof Date ? r.detected_at.toISOString() : String(r.detected_at),
            oldValue: r.old_value != null ? Number(r.old_value) : null,
            newValue: Number(r.new_value),
          });
        }
      }

      // 3. Best-effort ENS for the delegators in the trail (so "e&n.eth
      //    undelegated 7.5M" reads like a cause, not a hex string).
      const delegators = Array.from(
        new Set(events.map((e) => e.delegator).filter((d): d is string => !!d)),
      );
      if (delegators.length > 0 && hasSubgraphAccess()) {
        try {
          const idList = delegators.map((d) => `"${d}"`).join(', ');
          const ensResult = await ensQuery<{ domains: Array<{ name: string; resolvedAddress: { id: string } }> }>(`{
            domains(first: 1000, where: { resolvedAddress_in: [${idList}], name_not: null }) {
              name
              resolvedAddress { id }
            }
          }`);
          const names: Record<string, string> = {};
          for (const dom of ensResult.domains) {
            const a = dom.resolvedAddress.id.toLowerCase();
            if (!names[a] || dom.name.length < names[a].length) names[a] = dom.name;
          }
          for (const e of events) {
            if (e.delegator && names[e.delegator]) e.delegatorName = names[e.delegator];
          }
        } catch (e) {
          log.api.warn({ err: e }, 'apr-provenance ENS lookup failed (non-critical)');
        }
      }

      // Sort the merged trail newest-first.
      events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      return { reconcile, events: events.slice(0, 40) };
    });

    return NextResponse.json({ data }, {
      headers: { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=600' },
    });
  } catch (error) {
    log.api.error({ err: error }, 'apr-provenance error');
    return NextResponse.json({ error: 'Failed to compute provenance' }, { status: 500 });
  }
}
