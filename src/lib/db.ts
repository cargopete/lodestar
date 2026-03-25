import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Server-only Supabase client — never import from client components.
 * Uses the service role key to bypass RLS (all writes are from cron).
 *
 * Untyped client — row types live in database.types.ts for use in
 * ingestion code. Full Supabase type binding regenerable via pnpm db:types
 * once the DB is live.
 *
 * Returns null if Supabase is not configured (dev without DB).
 */
function createDb(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  return createClient(url, key, {
    auth: { persistSession: false },
  });
}

export const db = createDb();

export type DbClient = SupabaseClient;

export function hasDbAccess(): boolean {
  return db !== null;
}

/**
 * Read the ingestion cursor for a given data type.
 */
export async function getIngestionState(
  client: DbClient,
  key: string
): Promise<{ last_epoch: number | null; last_block: number | null; last_id: string | null }> {
  const { data, error } = await client
    .from('ingestion_state')
    .select('last_epoch, last_block, last_id')
    .eq('key', key)
    .single();

  if (error || !data) return { last_epoch: null, last_block: null, last_id: null };
  return data;
}

/**
 * Update the ingestion cursor after a successful ingest.
 */
export async function updateIngestionState(
  client: DbClient,
  key: string,
  state: { last_epoch?: number; last_block?: number; last_id?: string }
): Promise<void> {
  await client
    .from('ingestion_state')
    .update({ ...state, updated_at: new Date().toISOString() })
    .eq('key', key);
}
