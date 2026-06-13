import { NextRequest, NextResponse } from 'next/server';
import { db, hasDbAccess } from '@/lib/db';

export interface ParameterChange {
  param_name: string;
  old_value: number | null;
  new_value: number;
  epoch: number | null;
  detected_at: string;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address } = await params;

  if (!hasDbAccess() || !db) {
    return NextResponse.json({ data: [] });
  }

  const addr = address.toLowerCase();

  const rows = await db`
    SELECT * FROM (
      SELECT DISTINCT ON (param_name, old_value, new_value, epoch)
        param_name, old_value, new_value, epoch, created_at
      FROM parameter_changes
      WHERE indexer_address = ${addr}
        AND old_value IS DISTINCT FROM new_value
      ORDER BY param_name, old_value, new_value, epoch, created_at DESC
    ) deduped
    ORDER BY created_at DESC
    LIMIT 100
  `;

  const data: ParameterChange[] = rows.map((r) => ({
    param_name: String(r.param_name),
    old_value: r.old_value != null ? Number(r.old_value) : null,
    new_value: Number(r.new_value),
    epoch: r.epoch != null ? Number(r.epoch) : null,
    detected_at: r.created_at instanceof Date
      ? r.created_at.toISOString()
      : String(r.created_at),
  }));

  return NextResponse.json(
    { data },
    { headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=1200' } },
  );
}
