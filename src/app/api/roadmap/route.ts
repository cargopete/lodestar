import { NextResponse } from 'next/server';
import { ROADMAP_ITEMS } from '@/lib/roadmap-data';

export async function GET() {
  return NextResponse.json({ items: ROADMAP_ITEMS }, {
    headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
  });
}
