import { timingSafeEqual } from 'node:crypto';
import type { Queue } from 'bullmq';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { Redis } from 'ioredis';
import { sql, type Kysely } from 'kysely';
import multer from 'multer';
import { z } from 'zod';
import type { Database } from '../db/schema.js';
import { detectImageType, MIME_TYPES } from '../images/magic.js';
import {
  getImage,
  getStatuses,
  getVariant,
  insertImage,
  listImages,
  listVariants,
  purgeOlderThan,
  storageTotals,
  type ImageSummary,
} from '../images/repository.js';
import { isVariantSize, savingsPercent } from '../images/variants.js';
import { enqueueImage, getQueueCounts } from '../jobs/queue.js';
import { errorMessage, logger } from '../logger.js';
import { detailPage, errorPage, galleryPage, statusPage } from '../views/pages.js';
import { HttpError } from './errors.js';

/** Maximum upload size in bytes (8 MB). */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/** Everything the HTTP app needs. */
export interface AppDeps {
  db: Kysely<Database>;
  queue: Queue;
  redis: Redis;
  adminToken: string | undefined;
}

const IdSchema = z.uuid();
const IdsQuerySchema = z.object({
  ids: z
    .string()
    .max(40 * 100)
    .transform((value) => value.split(',').filter(Boolean))
    .pipe(z.array(z.uuid()).max(100)),
});
const PurgeSchema = z.object({ days: z.coerce.number().int().min(0).max(3650) });
const VariantParamsSchema = z.object({ id: z.uuid(), size: z.coerce.number().int() });

function toApi(image: ImageSummary): Record<string, unknown> {
  return {
    ...image,
    urls:
      image.status === 'ready'
        ? { 160: `/i/${image.id}/160.webp`, 480: `/i/${image.id}/480.webp`, 1280: `/i/${image.id}/1280.webp` }
        : null,
  };
}

async function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function tokensMatch(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Builds the Express application (web UI, JSON API, image delivery, health).
 *
 * @param deps - Database, queue, Redis and admin token
 * @returns The Express app
 */
export function createApp(deps: AppDeps): express.Express {
  const { db, queue, redis } = deps;
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.set('etag', false);

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5, parts: 6 },
  });

  app.get('/health', async (_req, res) => {
    const checks: Record<string, string> = {};
    let ok = true;
    try {
      await withTimeout(sql`select 1`.execute(db), 2_000, 'database');
      checks.database = 'ok';
    } catch (error) {
      ok = false;
      checks.database = errorMessage(error);
    }
    try {
      await withTimeout(redis.ping(), 2_000, 'redis');
      checks.redis = 'ok';
    } catch (error) {
      ok = false;
      checks.redis = errorMessage(error);
    }
    res.status(ok ? 200 : 503).json({ status: ok ? 'ok' : 'error', checks });
  });

  // ---- pages ----
  app.get('/', async (_req, res) => {
    res.type('html').send(galleryPage(await listImages(db)));
  });

  app.get('/images/:id', async (req, res) => {
    const id = IdSchema.safeParse(req.params.id);
    const image = id.success ? await getImage(db, id.data) : undefined;
    if (!image) throw new HttpError(404, 'not_found', 'Image not found.');
    res.type('html').send(detailPage(image, await listVariants(db, image.id)));
  });

  app.get('/status', async (_req, res) => {
    const [counts, totals] = await Promise.all([getQueueCounts(queue), storageTotals(db)]);
    res.type('html').send(statusPage(counts, totals));
  });

  // ---- API ----
  app.get('/api/status', async (_req, res) => {
    const [counts, totals] = await Promise.all([getQueueCounts(queue), storageTotals(db)]);
    res.json({ queue: counts, storage: totals });
  });

  app.post('/api/images', upload.single('image'), async (req, res) => {
    const file = req.file;
    if (!file) throw new HttpError(400, 'missing_file', 'Send the image as multipart field "image".');
    const type = detectImageType(file.buffer);
    if (!type) {
      throw new HttpError(415, 'unsupported_type', 'Only JPEG, PNG, WebP and AVIF images are accepted.');
    }
    const originalName = (file.originalname || `upload.${type}`).slice(0, 200);
    const id = await insertImage(db, { originalName, mimeType: MIME_TYPES[type], data: file.buffer });
    await enqueueImage(queue, id);
    const image = await getImage(db, id);
    res.status(202).location(`/api/images/${id}`).json({ image: image ? toApi(image) : { id } });
  });

  app.get('/api/images', async (_req, res) => {
    res.json({ images: (await listImages(db)).map(toApi) });
  });

  app.get('/api/images/status', async (req, res) => {
    const query = IdsQuerySchema.safeParse(req.query);
    if (!query.success) throw new HttpError(400, 'invalid_ids', 'Pass ?ids= with up to 100 comma-separated image ids.');
    res.json({ images: (await getStatuses(db, query.data.ids)).map(toApi) });
  });

  app.get('/api/images/:id', async (req, res) => {
    const id = IdSchema.safeParse(req.params.id);
    const image = id.success ? await getImage(db, id.data) : undefined;
    if (!image) throw new HttpError(404, 'not_found', 'Image not found.');
    const variants = (await listVariants(db, image.id)).map((v) => ({
      ...v,
      url: `/i/${image.id}/${v.size}.webp`,
      savingsPercent: savingsPercent(image.originalBytes, v.bytes),
    }));
    res.json({ image: toApi(image), variants });
  });

  app.post('/api/admin/purge', express.json({ limit: '1kb' }), async (req, res) => {
    if (!deps.adminToken) throw new HttpError(503, 'admin_disabled', 'Set ADMIN_TOKEN to enable admin endpoints.');
    const header = req.get('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!tokensMatch(token, deps.adminToken)) throw new HttpError(401, 'unauthorized', 'Invalid or missing admin token.');
    const input = PurgeSchema.safeParse({ ...(req.body as object | undefined), ...req.query });
    if (!input.success) throw new HttpError(400, 'invalid_days', 'Pass "days" as an integer between 0 and 3650.');
    const deleted = await purgeOlderThan(db, input.data.days);
    logger.info('admin purge', { days: input.data.days, deleted });
    res.json({ deleted, days: input.data.days });
  });

  // ---- delivery ----
  app.get('/i/:id/:size.webp', async (req, res) => {
    const params = VariantParamsSchema.safeParse(req.params);
    if (!params.success || !isVariantSize(params.data.size)) {
      throw new HttpError(404, 'not_found', 'Unknown image or size (use 160, 480 or 1280).');
    }
    const variant = await getVariant(db, params.data.id, params.data.size);
    if (!variant) throw new HttpError(404, 'not_found', 'Variant not found (it may still be processing).');
    res.set({
      'Cache-Control': 'public, max-age=31536000, immutable',
      ETag: variant.etag,
      'Content-Type': 'image/webp',
      'X-Content-Type-Options': 'nosniff',
    });
    const ifNoneMatch = req.get('if-none-match');
    if (ifNoneMatch && ifNoneMatch.split(',').some((tag) => tag.trim().replace(/^W\//, '') === variant.etag)) {
      res.status(304).end();
      return;
    }
    res.send(variant.data);
  });

  // ---- fallbacks ----
  app.use((req, _res, next) => {
    next(new HttpError(404, 'not_found', `No route for ${req.method} ${req.path}`));
  });

  app.use((error: unknown, req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(error);
    let httpError: HttpError;
    if (error instanceof HttpError) httpError = error;
    else if (error instanceof multer.MulterError) {
      httpError =
        error.code === 'LIMIT_FILE_SIZE'
          ? new HttpError(413, 'file_too_large', 'Images must be 8 MB or smaller.')
          : new HttpError(400, 'invalid_upload', `Invalid upload: ${error.message}.`);
    } else if (typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.parse.failed') {
      httpError = new HttpError(400, 'invalid_json', 'Request body is not valid JSON.');
    } else {
      logger.error('unhandled request error', { method: req.method, path: req.path, error: errorMessage(error) });
      httpError = new HttpError(500, 'internal_error', 'Something went wrong.');
    }
    const wantsJson = req.path.startsWith('/api/') || req.path.startsWith('/i/') || req.path === '/health' || !req.accepts('html');
    res.status(httpError.status);
    if (wantsJson) res.json({ error: { code: httpError.code, message: httpError.message } });
    else res.type('html').send(errorPage(httpError.status, httpError.message));
  });

  return app;
}
