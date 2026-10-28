import { Queue, type JobsOptions } from 'bullmq';
import type { Redis } from 'ioredis';

/** Queue name shared by producer and worker. */
export const QUEUE_NAME = 'thumbs';

/** Job that creates the variants for one image. */
export const PROCESS_JOB = 'process-image';
/** Repeatable job that deletes old images. */
export const PURGE_JOB = 'purge-old-images';
/** Job scheduler id for the daily purge. */
export const PURGE_SCHEDULER_ID = 'daily-purge';

/** Initial attempt plus 3 retries. */
export const MAX_ATTEMPTS = 4;

/** Payload of {@link PROCESS_JOB}. */
export interface ProcessJobData {
  imageId: string;
}

/** Payload of {@link PURGE_JOB}. */
export interface PurgeJobData {
  days: number;
}

/** Default options for image jobs: 4 attempts with exponential backoff (2 s, 4 s, 8 s). */
export const processJobOptions: JobsOptions = {
  attempts: MAX_ATTEMPTS,
  backoff: { type: 'exponential', delay: 2_000 },
  removeOnComplete: { count: 1_000 },
  removeOnFail: { count: 1_000 },
};

/**
 * Creates the producer-side queue handle.
 *
 * @param connection - Redis connection
 * @param name - Queue name (overridable for tests)
 * @returns The queue
 */
export function createQueue(connection: Redis, name = QUEUE_NAME): Queue {
  return new Queue(name, { connection });
}

/**
 * Enqueues processing for an image. The job id is the image id, so enqueueing
 * the same image twice while its job exists is a no-op.
 *
 * @param queue - Producer queue
 * @param imageId - Image to process
 * @param options - Override job options (tests use short backoffs)
 */
export async function enqueueImage(queue: Queue, imageId: string, options: JobsOptions = processJobOptions): Promise<void> {
  const data: ProcessJobData = { imageId };
  await queue.add(PROCESS_JOB, data, { ...options, jobId: imageId });
}

/**
 * Registers (or updates) the daily purge as a BullMQ job scheduler. Idempotent:
 * every process can call it on start.
 *
 * @param queue - Queue to schedule on
 * @param retentionDays - Images older than this are deleted
 */
export async function scheduleDailyPurge(queue: Queue, retentionDays: number): Promise<void> {
  const data: PurgeJobData = { days: retentionDays };
  await queue.upsertJobScheduler(
    PURGE_SCHEDULER_ID,
    { pattern: '15 3 * * *', tz: 'UTC' },
    { name: PURGE_JOB, data, opts: { removeOnComplete: { count: 30 }, removeOnFail: { count: 30 } } },
  );
}

/** Queue counts shown on the /status page. */
export interface QueueCounts {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

/**
 * Reads the current job counts.
 *
 * @param queue - Queue to inspect
 * @returns Counts by state
 */
export async function getQueueCounts(queue: Queue): Promise<QueueCounts> {
  const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed', 'prioritized');
  return {
    waiting: (counts.waiting ?? 0) + (counts.prioritized ?? 0),
    active: counts.active ?? 0,
    completed: counts.completed ?? 0,
    failed: counts.failed ?? 0,
    delayed: counts.delayed ?? 0,
  };
}
