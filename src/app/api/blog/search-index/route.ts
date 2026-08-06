import { NextResponse } from 'next/server';
import { getSearchIndex } from '@/lib/blog';

// Posts are files in the repo, so the index only changes on deploy.
export const dynamic = 'force-static';

/**
 * Lowercased post bodies keyed by slug, for the blog index's full-text search.
 *
 * Split out of the listing payload: embedding it cost every visitor ~160KB
 * compressed, when only the ones who type in the search box ever need it.
 */
export function GET() {
  return NextResponse.json(getSearchIndex(), {
    headers: {
      // Immutable per deploy; the URL changes when the build does.
      'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
    },
  });
}
