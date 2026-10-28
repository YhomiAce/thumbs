import type { ColumnType, Generated, Insertable, Selectable } from 'kysely';

/** Lifecycle of an uploaded image. */
export type ImageStatus = 'queued' | 'processing' | 'ready' | 'failed';

/** `images` table: one row per upload, original bytes included. */
export interface ImagesTable {
  id: Generated<string>;
  original_name: string;
  mime_type: string;
  original: Buffer;
  original_bytes: number;
  width: number | null;
  height: number | null;
  dominant_color: string | null;
  status: ColumnType<ImageStatus, ImageStatus | undefined, ImageStatus>;
  attempts: ColumnType<number, number | undefined, number>;
  error: string | null;
  created_at: ColumnType<Date, Date | undefined, Date>;
  processed_at: Date | null;
}

/** `variants` table: one WebP thumbnail per (image, size). */
export interface VariantsTable {
  image_id: string;
  size: number;
  width: number;
  height: number;
  bytes: number;
  etag: string;
  data: Buffer;
  created_at: ColumnType<Date, Date | undefined, never>;
}

/** `app_meta` table: small key/value store (e.g. "seeded"). */
export interface AppMetaTable {
  key: string;
  value: string;
}

/** Kysely database interface. */
export interface Database {
  images: ImagesTable;
  variants: VariantsTable;
  app_meta: AppMetaTable;
}

export type ImageRow = Selectable<ImagesTable>;
export type NewImage = Insertable<ImagesTable>;
export type VariantRow = Selectable<VariantsTable>;
