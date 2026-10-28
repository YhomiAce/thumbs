# thumbs

A small self-hosted image thumbnail and optimisation service. Upload a JPEG, PNG, WebP or AVIF and a background
job (BullMQ + sharp) turns it into privacy-safe WebP thumbnails at three sizes.

## Features

- **Upload** from a simple web page (drag and drop, no frontend build) or the API (`POST /api/images`, multipart field `image`).
  - Max 8 MB. JPEG, PNG, WebP and AVIF are accepted, **checked by magic bytes**, not the file name or `Content-Type`.
- **Background jobs** (BullMQ) process each upload with [sharp](https://sharp.pixelplumbing.com/):
  - WebP thumbnails 160, 480 and 1280 px wide (never enlarged)
  - EXIF orientation applied first, then **all metadata stripped** (EXIF, GPS, XMP)
  - original dimensions and dominant colour recorded
- **Retries:** a failing job is retried 3 times (4 attempts) with exponential backoff (2 s, 4 s, 8 s). The final failure is stored with its error message and shown in the UI.
- **Gallery** with live processing state (polls a status endpoint every 2 s), and a **detail page** with each size, its byte size, and how much smaller it is than the original.
- **Delivery:** `GET /i/:id/:size.webp` with `Cache-Control: public, max-age=31536000, immutable` and a strong `ETag` (`304` on `If-None-Match`).
- **Storage in Postgres** (`bytea`): originals and variants survive redeploys of containers without a persistent disk. The original is never served (it may contain GPS data).
- **Clean-up:** `POST /api/admin/purge` (bearer `ADMIN_TOKEN`) deletes images older than N days, and a BullMQ job scheduler purges images older than `RETENTION_DAYS` every day at 03:15 UTC.
- **Queue stats** on `/status` (waiting, active, completed, failed, delayed) and `/api/status`.
- **Seed data:** on the very first start with an empty database, three sample images are generated with sharp and queued.
- **Web and worker from one codebase**, runnable together or split (see [Process modes](#process-modes)).

Stack: Node 22, TypeScript, Express 5, BullMQ + ioredis, sharp, Postgres with Kysely (migrations run on start under an advisory lock), zod.

## API

| Method | Path                       | Description                                                                              |
| ------ | -------------------------- | ---------------------------------------------------------------------------------------- |
| GET    | `/health`                  | 200 when Postgres and Redis answer (503 otherwise)                                       |
| POST   | `/api/images`              | Upload (multipart field `image`). `202` with the queued image; `413` too big; `415` wrong type |
| GET    | `/api/images`              | 60 most recent images                                                                    |
| GET    | `/api/images/status?ids=…` | Status of up to 100 images (comma-separated ids), used by the gallery poller             |
| GET    | `/api/images/:id`          | One image with its variants, byte sizes and savings                                     |
| GET    | `/i/:id/:size.webp`        | A variant (`size` = 160, 480 or 1280)                                                     |
| GET    | `/api/status`              | Queue counts and storage totals                                                          |
| POST   | `/api/admin/purge`         | `Authorization: Bearer $ADMIN_TOKEN`, body `{"days": 7}` or `?days=7`. Returns `{deleted}` |

Pages: `/` (gallery + upload), `/images/:id` (detail), `/status` (queue).

```sh
curl -F image=@photo.jpg http://localhost:5115/api/images
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"days":30}' http://localhost:5115/api/admin/purge
```

## Local development

Requirements: Node 22.12+, Postgres 13+ and Redis 6.2+.

```sh
cp .env.example .env      # adjust DATABASE_URL / REDIS_URL
npm install
npm run dev               # web + in-process worker on http://localhost:5115, reloads on change
npm run dev:worker        # optional: a separate worker (set RUN_WORKER=false for the web)
```

Tests (`npm test`): unit tests (magic bytes, variant sizes, sharp processing with real images) run anywhere. The
integration tests (processing pipeline, retry/failure recording through real BullMQ, the purge query) use
`TEST_DATABASE_URL` (default `postgresql://postgres:fleetdev@127.0.0.1:55432/thumbs_test`, created if missing) and
`TEST_REDIS_URL` (default `redis://127.0.0.1:56379/5`), and are skipped when those aren't reachable.

```sh
npm test
npm run typecheck
```

## Environment variables

| Name                 | Required | Example                                         | Build / runtime | Notes                                                                       |
| -------------------- | -------- | ----------------------------------------------- | --------------- | --------------------------------------------------------------------------- |
| `DATABASE_URL`       | yes      | `postgresql://user:pass@db:5432/thumbs`         | runtime         | Postgres; originals and variants are stored here                            |
| `REDIS_URL`          | yes      | `redis://redis:6379/0`                          | runtime         | BullMQ queue. Use a persistent Redis (`noeviction` policy)                 |
| `ADMIN_TOKEN`        | no       | `a-long-random-string`                          | runtime         | 16+ chars. Enables `POST /api/admin/purge` (503 when unset)                |
| `PORT`               | no       | `5115`                                          | runtime         | Web HTTP port (default 5115). Ignored by the worker-only process           |
| `RUN_WORKER`         | no       | `true`                                          | runtime         | Run the worker inside the web process (default `true`)                     |
| `WORKER_CONCURRENCY` | no       | `2`                                             | runtime         | Jobs processed in parallel per worker (default 2)                          |
| `RETENTION_DAYS`     | no       | `30`                                            | runtime         | Daily purge deletes images older than this (default 30)                    |
| `WORKER_HEALTH_PORT` | no       | `3000`                                          | runtime         | Worker-only: serve a tiny health endpoint on this port (off when unset)    |

Nothing is needed at build time.

## Process modes

The same build runs in three ways:

1. **All in one (default).** `npm start` runs the HTTP server, the job producer and the worker in one process
   (`RUN_WORKER=true`). One deployment is enough.
2. **Split web and worker.** Run the web with `RUN_WORKER=false` (`npm start`), and one or more workers with
   `npm run start:worker`. The worker has **no HTTP server and listens on no port**; it only consumes jobs from Redis.
   On `SIGTERM` it stops taking new jobs, finishes the active ones, closes its connections and exits with code 0.
3. **Worker with a health port.** Same as 2, plus `WORKER_HEALTH_PORT=<port>`: the worker answers any path on that
   port with `200 {"status":"ok","role":"worker",…}` when the worker, Redis and Postgres are fine (503 otherwise). Use this
   when the platform insists on an open port or an HTTP health check.

Every process applies pending migrations on start under a Postgres advisory lock, so web and workers can start at
the same time. Only the web process seeds sample data. Both register the daily purge (idempotent).

## Deploying

- **Install:** `npm ci` (sharp downloads a prebuilt libvips for the platform, including `linux-musl` for Alpine; no compiler needed)
- **Build:** `npm run build` (tsc → `dist/`)
- **Start (web):** `npm start` → `node dist/web.js`; migrations run automatically before it listens
- **Start (worker-only):** `npm run start:worker` → `node dist/worker.js`
- **Port:** `PORT` (default 5115), listening on `0.0.0.0`. Health check: `GET /health`
- **Env vars:** all runtime (`DATABASE_URL` and `REDIS_URL` required). None at build time.

There is intentionally no `start:prod` script: `start` is the web process.

Resources: processing is memory-bound. With `WORKER_CONCURRENCY=2`, a process handling 24–48 megapixel photos peaked
at about 170–220 MB RSS on Alpine; budget roughly 80–100 MB per concurrent job on top of ~110 MB baseline. Lower
`WORKER_CONCURRENCY` on very small containers.

Postgres holds all bytes, so size the database accordingly (originals up to 8 MB each, plus about 10% for
variants) and keep `RETENTION_DAYS` sensible.

## License

MIT
