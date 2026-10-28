import { sql, type Kysely } from 'kysely';
import type { Database, ImageStatus } from '../db/schema.js';
import type { TransformResult } from './transform.js';

/** Image fields shown in lists and the API (no binary data). */
export interface ImageSummary {
  id: string;
  originalName: string;
  mimeType: string;
  originalBytes: number;
  width: number | null;
  height: number | null;
  dominantColor: string | null;
  status: ImageStatus;
  attempts: number;
  error: string | null;
  createdAt: Date;
  processedAt: Date | null;
}

/** Variant fields without the binary data. */
export interface VariantSummary {
  size: number;
  width: number;
  height: number;
  bytes: number;
}

const summaryColumns = [
  'id',
  'original_name as originalName',
  'mime_type as mimeType',
  'original_bytes as originalBytes',
  'width',
  'height',
  'dominant_color as dominantColor',
  'status',
  'attempts',
  'error',
  'created_at as createdAt',
  'processed_at as processedAt',
] as const;

/**
 * Stores a new upload with status `queued`.
 *
 * @returns The new image id
 */
export async function insertImage(
  db: Kysely<Database>,
  input: { originalName: string; mimeType: string; data: Buffer; createdAt?: Date },
): Promise<string> {
  const row = await db
    .insertInto('images')
    .values({
      original_name: input.originalName,
      mime_type: input.mimeType,
      original: input.data,
      original_bytes: input.data.length,
      ...(input.createdAt ? { created_at: input.createdAt } : {}),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

/** Lists the most recent images, newest first. */
export async function listImages(db: Kysely<Database>, limit = 60): Promise<ImageSummary[]> {
  return db.selectFrom('images').select(summaryColumns).orderBy('created_at', 'desc').limit(limit).execute();
}

/** Fetches status rows for a set of ids (used by the gallery poller). */
export async function getStatuses(db: Kysely<Database>, ids: string[]): Promise<ImageSummary[]> {
  if (ids.length === 0) return [];
  return db.selectFrom('images').select(summaryColumns).where('id', 'in', ids).execute();
}

/** Fetches one image's metadata, or undefined. */
export async function getImage(db: Kysely<Database>, id: string): Promise<ImageSummary | undefined> {
  return db.selectFrom('images').select(summaryColumns).where('id', '=', id).executeTakeFirst();
}

/** Lists an image's variants (metadata only), smallest first. */
export async function listVariants(db: Kysely<Database>, imageId: string): Promise<VariantSummary[]> {
  return db
    .selectFrom('variants')
    .select(['size', 'width', 'height', 'bytes'])
    .where('image_id', '=', imageId)
    .orderBy('size')
    .execute();
}

/** Fetches one variant including its bytes, or undefined. */
export async function getVariant(
  db: Kysely<Database>,
  imageId: string,
  size: number,
): Promise<{ data: Buffer; etag: string } | undefined> {
  return db
    .selectFrom('variants')
    .select(['data', 'etag'])
    .where('image_id', '=', imageId)
    .where('size', '=', size)
    .executeTakeFirst();
}

/** Loads the original bytes for processing, or undefined if the image was deleted. */
export async function getOriginal(db: Kysely<Database>, id: string): Promise<Buffer | undefined> {
  const row = await db.selectFrom('images').select('original').where('id', '=', id).executeTakeFirst();
  return row?.original;
}

/** Marks an image as being processed and records the attempt number (1-based). */
export async function markProcessing(db: Kysely<Database>, id: string, attempt: number): Promise<void> {
  await db.updateTable('images').set({ status: 'processing', attempts: attempt }).where('id', '=', id).execute();
}

/** Saves the variants and metadata and marks the image `ready`, atomically. */
export async function saveResult(db: Kysely<Database>, id: string, result: TransformResult): Promise<void> {
  await db.transaction().execute(async (trx) => {
    await trx.deleteFrom('variants').where('image_id', '=', id).execute();
    await trx
      .insertInto('variants')
      .values(
        result.variants.map((v) => ({
          image_id: id,
          size: v.size,
          width: v.width,
          height: v.height,
          bytes: v.bytes,
          etag: v.etag,
          data: v.data,
        })),
      )
      .execute();
    await trx
      .updateTable('images')
      .set({
        status: 'ready',
        width: result.width,
        height: result.height,
        dominant_color: result.dominantColor,
        error: null,
        processed_at: new Date(),
      })
      .where('id', '=', id)
      .execute();
  });
}

/**
 * Records a failed attempt. When `final` is true the image is marked `failed`;
 * otherwise it stays `processing` (a retry is scheduled) with the last error visible.
 */
export async function recordFailure(
  db: Kysely<Database>,
  id: string,
  input: { attempt: number; error: string; final: boolean },
): Promise<void> {
  await db
    .updateTable('images')
    .set({
      status: input.final ? 'failed' : 'processing',
      attempts: input.attempt,
      error: input.error.slice(0, 2000),
      ...(input.final ? { processed_at: new Date() } : {}),
    })
    .where('id', '=', id)
    .execute();
}

/** Ids of images still waiting for processing (used to re-enqueue after a crash). */
export async function pendingImageIds(db: Kysely<Database>): Promise<string[]> {
  const rows = await db.selectFrom('images').select('id').where('status', 'in', ['queued', 'processing']).execute();
  return rows.map((r) => r.id);
}

/**
 * Deletes images (and, by cascade, their variants) created before `now - days`.
 *
 * @param db - Database handle
 * @param days - Age threshold in days (images strictly older are deleted)
 * @param now - Reference time (injectable for tests)
 * @returns Number of images deleted
 */
export async function purgeOlderThan(db: Kysely<Database>, days: number, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const result = await db.deleteFrom('images').where('created_at', '<', cutoff).executeTakeFirst();
  return Number(result.numDeletedRows);
}

/** Total number of images and the sum of original and variant bytes. */
export async function storageTotals(
  db: Kysely<Database>,
): Promise<{ images: number; originalBytes: number; variantBytes: number }> {
  const images = await db
    .selectFrom('images')
    .select([sql<number>`count(*)::int`.as('count'), sql<number>`coalesce(sum(original_bytes), 0)::bigint`.as('bytes')])
    .executeTakeFirstOrThrow();
  const variants = await db
    .selectFrom('variants')
    .select(sql<number>`coalesce(sum(bytes), 0)::bigint`.as('bytes'))
    .executeTakeFirstOrThrow();
  return { images: images.count, originalBytes: images.bytes, variantBytes: variants.bytes };
}
