/**
 * GET /api/horizon/debug
 *
 * Temporary diagnostic endpoint — returns the most recent 10 raw logs
 * from the HorizonStaking contract (no topic0 filter) so we can verify
 * the contract address is correct and see what topic0 values are actually
 * being emitted.
 *
 * Remove this once the activity feed is confirmed working.
 */

import { NextResponse } from 'next/server';
import {
  ampQuery,
  hasAmpAccess,
  AmpError,
  HORIZON_STAKING,
  AMP_DATASET,
  hexLit,
} from '@/lib/amp';

export async function GET() {
  if (!hasAmpAccess()) {
    return NextResponse.json({ error: 'Amp not configured' }, { status: 503 });
  }

  try {
    // Broad query — no topic0 filter, just check if the address has any logs
    const rows = await ampQuery<{
      block_num: number;
      tx_hash: string;
      log_index: number;
      topic0: string;
      topic1: string;
    }>(`
      SELECT
        block_num,
        tx_hash,
        log_index,
        topic0,
        topic1
      FROM ${AMP_DATASET}.logs
      WHERE address = ${hexLit(HORIZON_STAKING)}
      ORDER BY block_num DESC
      LIMIT 10
    `);

    return NextResponse.json({
      contractAddress: HORIZON_STAKING,
      dataset: AMP_DATASET,
      rowCount: rows.length,
      rows,
    });
  } catch (error) {
    if (error instanceof AmpError) {
      return NextResponse.json({ error: 'Amp query failed', detail: error.message }, { status: 502 });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
