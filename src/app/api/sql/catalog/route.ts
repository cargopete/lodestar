import { NextResponse } from 'next/server';
import { cached } from '@/lib/cache';
import { hasNuthatch, nuthatchTables } from '@/lib/nuthatch';
import { SQL_DATASETS } from '@/lib/sql-datasets';
import { log } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * The schema half of the public SQL surface: every table and column in every dataset we expose.
 *
 * This is the part that was actually missing. The nests have been serving Lodestar's own panels for
 * weeks and the data service has sat behind a working TAP paywall, but nobody outside could see
 * what a nest contains, so the only way to learn a table name was to ask us. A paywall in front of
 * an undocumented surface is not a product.
 *
 * A dataset whose nest is unreachable is reported with `available: false` and kept in the list
 * rather than dropped, because a catalogue that silently omits a broken dataset looks exactly like
 * a catalogue that never had it.
 */
export async function GET() {
  if (!hasNuthatch()) {
    return NextResponse.json(
      { available: false, reason: 'No nuthatch origin configured.', datasets: [] },
      { status: 503 }
    );
  }

  // Only the nest-derived half is cached. The labels, descriptions and sample queries are static
  // config in this repo, and baking them into a five-minute cache means a deploy that fixes a
  // wrong sample does not take effect for five minutes: the code is right, the page is wrong, and
  // nothing in either says why. Schema comes from the nest, so schema is what gets cached.
  const schemas = await cached('sql:catalog:schema:v1', 300, async () =>
    Promise.all(
      SQL_DATASETS.map(async (d) => {
        try {
          const tables = await nuthatchTables(d.basePath);
          return {
            id: d.id,
            available: true as const,
            tables: tables.map((t) => ({
              name: t.table,
              alias: t.alias,
              event: t.event,
              columns: t.columns.map((c) => ({
                name: c.name,
                type: c.sol_type === 'implicit' ? c.storage : c.sol_type,
                indexed: c.indexed,
              })),
            })),
          };
        } catch (e) {
          log.api.warn({ dataset: d.id, err: e }, 'sql catalog: dataset unreachable');
          return { id: d.id, available: false as const, tables: [] };
        }
      })
    )
  );

  const byId = new Map(schemas.map((s) => [s.id, s]));
  const datasets = SQL_DATASETS.map((d) => {
    const schema = byId.get(d.id);
    return {
      id: d.id,
      label: d.label,
      chain: d.chain,
      description: d.description,
      sample: d.sample,
      available: schema?.available ?? false,
      tableCount: schema?.tables.length ?? 0,
      tables: schema?.tables ?? [],
      ...(schema?.available ? {} : { error: 'This dataset is not answering right now.' }),
    };
  });

  return NextResponse.json({ available: true, datasets });
}
