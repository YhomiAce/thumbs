import { randomUUID } from 'node:crypto';
import { Queue, QueueEvents, Worker } from 'bullmq';
import type { Kysely } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../src/db/schema.js';
import { getImage, insertImage, listVariants, purgeOlderThan } from '../src/images/repository.js';
import { processImage } from '../src/jobs/processor.js';
import { enqueueImage } from '../src/jobs/queue.js';
import { createRedis } from '../src/jobs/redis.js';
import { startWorker } from '../src/jobs/worker.js';
import { corruptJpeg, phonePhoto } from './support/images.js';
import { openTestDatabase, postgresAvailable, redisAvailable, TEST_REDIS_URL } from './support/services.js';

describe.skipIf(!postgresAvailable)('with Postgres', () => {
  let db: Kysely<Database>;

  beforeAll(async () => {
    db = await openTestDatabase();
  });
  beforeEach(async () => {
    await db.deleteFrom('images').execute();
  });
  afterAll(async () => {
    await db?.destroy();
  });

  describe('processImage', () => {
    it('creates three WebP variants and marks the image ready', async () => {
      const original = await phonePhoto();
      const id = await insertImage(db, { originalName: 'phone.jpg', mimeType: 'image/jpeg', data: original });

      await expect(processImage(db, id, 1, 4)).resolves.toEqual({ status: 'ready', variants: 3 });

      const image = await getImage(db, id);
      expect(image).toMatchObject({ status: 'ready', width: 1000, height: 2000, attempts: 1, error: null });
      expect(image?.dominantColor).toMatch(/^#[0-9a-f]{6}$/);
      const variants = await listVariants(db, id);
      expect(variants.map((v) => v.size)).toEqual([160, 480, 1280]);
      expect(variants.every((v) => v.bytes < original.length)).toBe(true);
    });

    it('records each failed attempt and marks the image failed on the last one', async () => {
      const id = await insertImage(db, { originalName: 'broken.jpg', mimeType: 'image/jpeg', data: corruptJpeg() });

      await expect(processImage(db, id, 1, 3)).rejects.toThrow();
      expect(await getImage(db, id)).toMatchObject({ status: 'processing', attempts: 1, error: expect.any(String) });

      await expect(processImage(db, id, 3, 3)).rejects.toThrow();
      const image = await getImage(db, id);
      expect(image).toMatchObject({ status: 'failed', attempts: 3 });
      expect(image?.error).toBeTruthy();
      expect(image?.processedAt).toBeInstanceOf(Date);
    });

    it('skips images that were deleted before the job ran', async () => {
      await expect(processImage(db, randomUUID(), 1, 4)).resolves.toMatchObject({ status: 'skipped' });
    });
  });

  describe('purgeOlderThan', () => {
    it('deletes only images older than N days, with their variants', async () => {
      const now = new Date('2026-06-30T12:00:00Z');
      const day = 24 * 60 * 60 * 1000;
      const data = Buffer.from([0xff, 0xd8, 0xff]);
      const old = await insertImage(db, { originalName: 'old', mimeType: 'image/jpeg', data, createdAt: new Date(now.getTime() - 31 * day) });
      const edge = await insertImage(db, { originalName: 'edge', mimeType: 'image/jpeg', data, createdAt: new Date(now.getTime() - 30 * day + 1000) });
      const fresh = await insertImage(db, { originalName: 'fresh', mimeType: 'image/jpeg', data, createdAt: now });
      await db
        .insertInto('variants')
        .values({ image_id: old, size: 160, width: 1, height: 1, bytes: 1, etag: '"x"', data })
        .execute();

      expect(await purgeOlderThan(db, 30, now)).toBe(1);
      expect(await getImage(db, old)).toBeUndefined();
      expect(await getImage(db, edge)).toBeDefined();
      expect(await getImage(db, fresh)).toBeDefined();
      expect(await db.selectFrom('variants').selectAll().where('image_id', '=', old).execute()).toEqual([]);

      expect(await purgeOlderThan(db, 0, new Date(now.getTime() + 1000))).toBe(2);
    });
  });

  describe.skipIf(!redisAvailable)('BullMQ retries (real Redis)', () => {
    it('retries a failing job and records the final failure with its error', async () => {
      const queueName = `thumbs-test-${randomUUID()}`;
      const producer = createRedis(TEST_REDIS_URL);
      const consumer = createRedis(TEST_REDIS_URL);
      const queue = new Queue(queueName, { connection: producer });
      const eventsRedis = createRedis(TEST_REDIS_URL);
      const events = new QueueEvents(queueName, { connection: eventsRedis });
      let worker: Worker | undefined;
      try {
        await events.waitUntilReady();
        worker = startWorker({ db, connection: consumer, concurrency: 1, queueName });
        const id = await insertImage(db, { originalName: 'broken.jpg', mimeType: 'image/jpeg', data: corruptJpeg() });
        let attemptFailures = 0;
        worker.on('failed', () => attemptFailures++);

        const done = new Promise<void>((resolve) => {
          events.on('failed', ({ jobId }) => {
            void queue.getJob(jobId).then((job) => {
              if (job && job.attemptsMade >= 3) resolve();
            });
          });
        });
        await enqueueImage(queue, id, { attempts: 3, backoff: { type: 'fixed', delay: 50 } });
        await done;

        expect(attemptFailures).toBe(3);
        const job = await queue.getJob(id);
        expect(job?.attemptsMade).toBe(3);
        expect(await job?.getState()).toBe('failed');
        const image = await getImage(db, id);
        expect(image).toMatchObject({ status: 'failed', attempts: 3 });
        expect(image?.error).toBe(job?.failedReason);
      } finally {
        await worker?.close();
        await events.close();
        await queue.obliterate({ force: true });
        await queue.close();
        producer.disconnect();
        consumer.disconnect();
        eventsRedis.disconnect();
      }
    }, 20_000);
  });
});
