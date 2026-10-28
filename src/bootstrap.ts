import type { Queue } from 'bullmq';
import type { Kysely } from 'kysely';
import { migrateToLatest, withStartupLock } from './db/migrate.js';
import type { Database } from './db/schema.js';
import { pendingImageIds } from './images/repository.js';
import { enqueueImage, scheduleDailyPurge } from './jobs/queue.js';
import { logger } from './logger.js';
import { seedIfEmpty } from './seed/seed.js';

/**
 * Startup work shared by the web and worker processes, done under one Postgres
 * advisory lock so concurrent starts don't race:
 *
 * 1. apply pending migrations
 * 2. optionally seed sample images (first start only)
 * 3. re-enqueue images left `queued`/`processing` (e.g. Redis was flushed); job ids
 *    are image ids, so this is a no-op for jobs that still exist
 * 4. register the daily purge scheduler
 *
 * @param options.db - Database handle
 * @param options.queue - Producer queue
 * @param options.retentionDays - Retention for the daily purge
 * @param options.seed - Whether to seed sample images
 */
export async function bootstrap(options: {
  db: Kysely<Database>;
  queue: Queue;
  retentionDays: number;
  seed: boolean;
}): Promise<void> {
  const { db, queue } = options;
  await withStartupLock(db, async () => {
    const applied = await migrateToLatest(db);
    logger.info('migrations up to date', { applied });
    if (options.seed) await seedIfEmpty(db, queue);
    const pending = await pendingImageIds(db);
    for (const id of pending) await enqueueImage(queue, id);
    if (pending.length) logger.info('ensured pending images are queued', { count: pending.length });
  });
  await scheduleDailyPurge(queue, options.retentionDays);
}

/**
 * Registers SIGTERM/SIGINT handlers that run `close` once, then exit. If closing
 * takes longer than `timeoutMs`, the process exits with code 1.
 *
 * @param close - Async clean-up
 * @param timeoutMs - Hard deadline
 */
export function onShutdown(close: () => Promise<void>, timeoutMs = 25_000): void {
  let closing = false;
  const handler = (signal: NodeJS.Signals) => {
    if (closing) return;
    closing = true;
    logger.info('shutting down', { signal });
    const timer = setTimeout(() => {
      logger.error('shutdown timed out, forcing exit');
      process.exit(1);
    }, timeoutMs);
    timer.unref();
    close()
      .then(() => {
        logger.info('shutdown complete');
        process.exit(0);
      })
      .catch((error: unknown) => {
        logger.error('error during shutdown', { error: String(error) });
        process.exit(1);
      });
  };
  process.on('SIGTERM', handler);
  process.on('SIGINT', handler);
}
