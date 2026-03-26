import { NextRequest, NextResponse } from 'next/server';
import { db, hasDbAccess } from '@/lib/db';
import { refreshIndexers } from '@/lib/refresh';

function isAuthorized(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return true;
  return request.headers.get('authorization') === `Bearer ${cronSecret}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await refreshIndexers({
      sql: hasDbAccess() ? db : null,
      writeToRedis: true,
    });

    return NextResponse.json({
      ok: true,
      count: result.count,
      durationMs: result.durationMs,
    });
  } catch (error) {
    console.error('Cron refresh failed:', error);
    return NextResponse.json(
      { error: 'Cron refresh failed', details: String(error) },
      { status: 500 }
    );
  }
}
