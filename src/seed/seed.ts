import type { Queue } from 'bullmq';
import type { Kysely } from 'kysely';
import type { Database } from '../db/schema.js';
import { insertImage } from '../images/repository.js';
import { enqueueImage } from '../jobs/queue.js';
import { logger } from '../logger.js';
import { generateSamples } from './samples.js';

const SEEDED_KEY = 'seeded_at';

/**
 * On first start with an empty database, stores three generated sample images
 * and queues them for processing. Runs once: a marker row in `app_meta` stops it
 * from re-seeding later (e.g. after everything was purged). Call it while
 * holding the startup advisory lock.
 *
 * @param db - Database handle
 * @param queue - Producer queue
 * @returns Number of images seeded (0 if skipped)
 */
export async function seedIfEmpty(db: Kysely<Database>, queue: Queue): Promise<number> {
  const marker = await db.selectFrom('app_meta').select('value').where('key', '=', SEEDED_KEY).executeTakeFirst();
  if (marker) return 0;
  const existing = await db.selectFrom('images').select('id').limit(1).executeTakeFirst();
  if (!existing) {
    const samples = await generateSamples();
    for (const sample of samples) {
      const id = await insertImage(db, { originalName: sample.name, mimeType: sample.mimeType, data: sample.data });
      await enqueueImage(queue, id);
    }
    logger.info('seeded sample images', { count: samples.length });
  }
  await db.insertInto('app_meta').values({ key: SEEDED_KEY, value: new Date().toISOString() }).execute();
  return existing ? 0 : 3;
}
