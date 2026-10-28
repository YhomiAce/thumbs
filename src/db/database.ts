import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { Database } from './schema.js';

// Return BIGINT (count(*)) as a JS number; our counts stay far below 2^53.
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));

/**
 * Creates a Kysely instance backed by a pg connection pool.
 *
 * @param connectionString - Postgres URL
 * @param max - Maximum pool size
 * @returns The database handle (call `destroy()` on shutdown)
 */
export function createDatabase(connectionString: string, max = 10): Kysely<Database> {
  const pool = new pg.Pool({ connectionString, max, connectionTimeoutMillis: 5_000 });
  pool.on('error', () => {
    // Idle client errors (e.g. DB restart) are surfaced on the next query instead.
  });
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}
