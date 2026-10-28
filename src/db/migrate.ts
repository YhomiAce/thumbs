import { sql, type Kysely } from 'kysely';
import { Migrator, type Migration, type MigrationProvider } from 'kysely/migration';
import * as initial from './migrations/001_initial.js';
import type { Database } from './schema.js';

/**
 * Migrations are imported statically (rather than read from a folder at runtime)
 * so they are compiled into `dist/` along with everything else.
 */
const migrations: Record<string, Migration> = {
  '001_initial': initial,
};

const provider: MigrationProvider = {
  getMigrations: async () => migrations,
};

/** Arbitrary 64-bit key shared by every thumbs process for the startup advisory lock. */
const STARTUP_LOCK_KEY = 7_311_420_514n;

/**
 * Runs `fn` while holding a session-level Postgres advisory lock, so that web and
 * worker processes starting at the same time don't race on migrations or seeding.
 *
 * @param db - Database handle
 * @param fn - Work to do while holding the lock
 * @returns Whatever `fn` returns
 */
export async function withStartupLock<T>(db: Kysely<Database>, fn: () => Promise<T>): Promise<T> {
  return db.connection().execute(async (conn) => {
    await sql`select pg_advisory_lock(${STARTUP_LOCK_KEY})`.execute(conn);
    try {
      return await fn();
    } finally {
      await sql`select pg_advisory_unlock(${STARTUP_LOCK_KEY})`.execute(conn);
    }
  });
}

/**
 * Applies pending migrations. Idempotent; safe to call on every start.
 *
 * @param db - Database handle
 * @returns Names of the migrations that were applied
 * @throws {Error} If a migration fails
 */
export async function migrateToLatest(db: Kysely<Database>): Promise<string[]> {
  const migrator = new Migrator({ db, provider, migrationTableName: 'thumbs_migrations' });
  const { error, results } = await migrator.migrateToLatest();
  if (error) throw error instanceof Error ? error : new Error(String(error));
  return (results ?? []).filter((r) => r.status === 'Success').map((r) => r.migrationName);
}
