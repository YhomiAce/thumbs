import { Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Kysely } from 'kysely';
import sharp from 'sharp';
import type { Database } from '../db/schema.js';
import { errorMessage, logger } from '../logger.js';
import { createProcessor } from './processor.js';
import { QUEUE_NAME } from './queue.js';

/**
 * Starts the BullMQ worker that processes image and purge jobs.
 *
 * @param options.db - Database handle
 * @param options.connection - Redis connection dedicated to the worker
 * @param options.concurrency - Jobs processed in parallel
 * @param options.queueName - Queue name (overridable for tests)
 * @returns The running worker; call `close()` to finish active jobs and stop
 */
export function startWorker(options: {
  db: Kysely<Database>;
  connection: Redis;
  concurrency: number;
  queueName?: string;
}): Worker {
  // Keep libvips' memory bounded: no operation cache, and one libvips thread per job
  // (parallelism comes from BullMQ concurrency instead).
  sharp.cache(false);
  sharp.concurrency(1);

  const worker = new Worker(options.queueName ?? QUEUE_NAME, createProcessor(options.db), {
    connection: options.connection,
    concurrency: options.concurrency,
  });
  worker.on('completed', (job) => logger.info('job completed', { jobId: job.id, name: job.name }));
  worker.on('failed', (job, error) =>
    logger.warn('job attempt failed', { jobId: job?.id, name: job?.name, attemptsMade: job?.attemptsMade, error: error.message }),
  );
  worker.on('error', (error) => logger.error('worker error', { error: errorMessage(error) }));
  return worker;
}
