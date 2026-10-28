import { Redis } from 'ioredis';
import type { Kysely } from 'kysely';
import pg from 'pg';
import { createDatabase } from '../../src/db/database.js';
import { migrateToLatest } from '../../src/db/migrate.js';
import type { Database } from '../../src/db/schema.js';

/** Postgres URL for integration tests (a dedicated database, created if missing). */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:fleetdev@127.0.0.1:55432/thumbs_test';
/** Redis URL for integration tests. */
export const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:56379/5';

async function ensureDatabase(): Promise<boolean> {
  const url = new URL(TEST_DATABASE_URL);
  const name = url.pathname.slice(1);
  url.pathname = '/postgres';
  const client = new pg.Client({ connectionString: url.toString(), connectionTimeoutMillis: 2_000 });
  try {
    await client.connect();
    const exists = await client.query('select 1 from pg_database where datname = $1', [name]);
    if (exists.rowCount === 0) await client.query(`create database "${name.replaceAll('"', '""')}"`);
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** True when the local Postgres is reachable (and the test DB exists). */
export const postgresAvailable = await ensureDatabase();

/** True when the local Redis is reachable. */
export const redisAvailable = await (async () => {
  const redis = new Redis(TEST_REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 0, retryStrategy: () => null });
  try {
    await redis.connect();
    await redis.ping();
    return true;
  } catch {
    return false;
  } finally {
    redis.disconnect();
  }
})();

/** Opens the test database, migrated and emptied. */
export async function openTestDatabase(): Promise<Kysely<Database>> {
  const db = createDatabase(TEST_DATABASE_URL, 5);
  await migrateToLatest(db);
  await db.deleteFrom('images').execute();
  return db;
}
