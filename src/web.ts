import type { Worker } from 'bullmq';
import { bootstrap, onShutdown } from './bootstrap.js';
import { loadConfig } from './config.js';
import { createDatabase } from './db/database.js';
import { createApp } from './http/app.js';
import { createQueue } from './jobs/queue.js';
import { createRedis } from './jobs/redis.js';
import { startWorker } from './jobs/worker.js';
import { errorMessage, logger } from './logger.js';

/** Web process: HTTP server + job producer, plus the worker unless RUN_WORKER=false. */
async function main(): Promise<void> {
  const config = loadConfig();
  const db = createDatabase(config.DATABASE_URL);
  const redis = createRedis(config.REDIS_URL);
  const queue = createQueue(redis);

  await bootstrap({ db, queue, retentionDays: config.RETENTION_DAYS, seed: true });

  let worker: Worker | undefined;
  let workerRedis: ReturnType<typeof createRedis> | undefined;
  if (config.RUN_WORKER) {
    workerRedis = createRedis(config.REDIS_URL);
    worker = startWorker({ db, connection: workerRedis, concurrency: config.WORKER_CONCURRENCY });
    logger.info('in-process worker started', { concurrency: config.WORKER_CONCURRENCY });
  } else {
    logger.info('RUN_WORKER=false: jobs will be processed by a separate worker process');
  }

  const app = createApp({ db, queue, redis, adminToken: config.ADMIN_TOKEN });
  const server = app.listen(config.PORT, '0.0.0.0', () => {
    logger.info('web listening', { port: config.PORT, runWorker: config.RUN_WORKER });
  });
  server.on('error', (error) => {
    logger.error('HTTP server error', { error: errorMessage(error) });
    process.exit(1);
  });

  onShutdown(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeIdleConnections();
    });
    await worker?.close();
    await queue.close();
    await Promise.all([redis.quit(), workerRedis?.quit()]);
    await db.destroy();
  });
}

main().catch((error: unknown) => {
  logger.error('failed to start web process', { error: errorMessage(error) });
  process.exit(1);
});
