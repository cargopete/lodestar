import postgres from 'postgres';

/**
 * Server-only Postgres client — never import from client components.
 * Uses postgres.js for direct connections (no ORM, no REST layer).
 *
 * Returns null if DATABASE_URL is not configured.
 */
function createDb(): postgres.Sql | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;

  return postgres(url, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });
}

export const db = createDb();

export type DbClient = postgres.Sql;

export function hasDbAccess(): boolean {
  return db !== null;
}

/**
 * Read the ingestion cursor for a given data type.
 */
export async function getIngestionState(
  sql: DbClient,
  key: string
): Promise<{ last_epoch: number | null; last_block: number | null; last_id: string | null }> {
  const rows = await sql`
    SELECT last_epoch, last_block, last_id
    FROM ingestion_state
    WHERE key = ${key}
  `;

  if (rows.length === 0) return { last_epoch: null, last_block: null, last_id: null };
  return rows[0] as { last_epoch: number | null; last_block: number | null; last_id: string | null };
}

/**
 * Update the ingestion cursor after a successful ingest.
 */
export async function updateIngestionState(
  sql: DbClient,
  key: string,
  state: { last_epoch?: number; last_block?: number; last_id?: string }
): Promise<void> {
  await sql`
    UPDATE ingestion_state
    SET ${sql({
      ...state,
      updated_at: new Date().toISOString(),
    })}
    WHERE key = ${key}
  `;
}
