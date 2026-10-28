import type { Job } from 'bullmq';
import type { Kysely } from 'kysely';
import type { Database } from '../db/schema.js';
import { getOriginal, markProcessing, purgeOlderThan, recordFailure, saveResult } from '../images/repository.js';
import { transformImage } from '../images/transform.js';
import { errorMessage, logger } from '../logger.js';
import { PROCESS_JOB, PURGE_JOB, type ProcessJobData, type PurgeJobData } from './queue.js';

/** Outcome returned by a processing job (stored by BullMQ as the return value). */
export type ProcessOutcome = { status: 'ready'; variants: number } | { status: 'skipped'; reason: string };

/**
 * Processes one image: loads the original, creates the variants and saves them.
 * On error it records the attempt; on the last attempt the image is marked
 * `failed` with the error message. The error is rethrown so BullMQ retries.
 *
 * @param db - Database handle
 * @param imageId - Image to process
 * @param attempt - 1-based attempt number
 * @param maxAttempts - Total attempts allowed
 * @returns What happened
 * @throws {Error} The processing error (after recording it)
 */
export async function processImage(
  db: Kysely<Database>,
  imageId: string,
  attempt: number,
  maxAttempts: number,
): Promise<ProcessOutcome> {
  const original = await getOriginal(db, imageId);
  if (!original) return { status: 'skipped', reason: 'image no longer exists' };
  await markProcessing(db, imageId, attempt);
  try {
    const result = await transformImage(original);
    await saveResult(db, imageId, result);
    return { status: 'ready', variants: result.variants.length };
  } catch (error) {
    const final = attempt >= maxAttempts;
    await recordFailure(db, imageId, { attempt, error: errorMessage(error), final });
    logger.warn(final ? 'image processing failed permanently' : 'image processing failed, will retry', {
      imageId,
      attempt,
      maxAttempts,
      error: errorMessage(error),
    });
    throw error;
  }
}

/**
 * Builds the BullMQ processor function that dispatches on the job name.
 *
 * @param db - Database handle
 * @returns A processor for `new Worker(...)`
 */
export function createProcessor(db: Kysely<Database>): (job: Job) => Promise<unknown> {
  return async (job: Job) => {
    if (job.name === PROCESS_JOB) {
      const { imageId } = job.data as ProcessJobData;
      return processImage(db, imageId, job.attemptsMade + 1, job.opts.attempts ?? 1);
    }
    if (job.name === PURGE_JOB) {
      const { days } = job.data as PurgeJobData;
      const deleted = await purgeOlderThan(db, days);
      logger.info('purged old images', { days, deleted });
      return { deleted };
    }
    throw new Error(`Unknown job type: ${job.name}`);
  };
}
