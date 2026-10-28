import { createServer, type Server } from 'node:http';
import { sql } from 'kysely';
import { bootstrap, onShutdown } from './bootstrap.js';
import { loadConfig } from './config.js';
import { createDatabase } from './db/database.js';
import { createQueue } from './jobs/queue.js';
import { createRedis } from './jobs/redis.js';
import { startWorker } from './jobs/worker.js';
import { errorMessage, logger } from './logger.js';

/**
 * Worker-only process: no HTTP server, just the BullMQ worker. If
 * WORKER_HEALTH_PORT is set, a tiny health endpoint is served on that port
 * (any path; 200 when the worker, Redis and Postgres are fine).
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const db = createDatabase(config.DATABASE_URL, Math.max(4, config.WORKER_CONCURRENCY + 2));
  const redis = createRedis(config.REDIS_URL);
  const queue = createQueue(redis);

  await bootstrap({ db, queue, retentionDays: config.RETENTION_DAYS, seed: false });

  const workerRedis = createRedis(config.REDIS_URL);
  const worker = startWorker({ db, connection: workerRedis, concurrency: config.WORKER_CONCURRENCY });
  logger.info('worker started', { concurrency: config.WORKER_CONCURRENCY, healthPort: config.WORKER_HEALTH_PORT ?? null });

  let health: Server | undefined;
  if (config.WORKER_HEALTH_PORT) {
    health = createServer((req, res) => {
      void (async () => {
        const checks: Record<string, string> = { worker: worker.isRunning() ? 'ok' : 'stopped' };
        try {
          await sql`select 1`.execute(db);
          checks.database = 'ok';
        } catch (error) {
          checks.database = errorMessage(error);
        }
        try {
          await redis.ping();
          checks.redis = 'ok';
        } catch (error) {
          checks.redis = errorMessage(error);
        }
        const ok = Object.values(checks).every((value) => value === 'ok');
        res.writeHead(ok ? 200 : 503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: ok ? 'ok' : 'error', role: 'worker', checks }));
      })();
      req.resume();
    });
    health.listen(config.WORKER_HEALTH_PORT, '0.0.0.0', () => {
      logger.info('worker health server listening', { port: config.WORKER_HEALTH_PORT });
    });
  }

  onShutdown(async () => {
    if (health) await new Promise<void>((resolve) => health.close(() => resolve()));
    // Waits for active jobs to finish; no new jobs are picked up.
    await worker.close();
    await queue.close();
    await Promise.all([redis.quit(), workerRedis.quit()]);
    await db.destroy();
  });
}

main().catch((error: unknown) => {
  logger.error('failed to start worker process', { error: errorMessage(error) });
  process.exit(1);
});
