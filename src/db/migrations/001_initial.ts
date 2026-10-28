import { sql, type Kysely } from 'kysely';

/** Creates images, variants and app_meta. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('images')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('original_name', 'text', (col) => col.notNull())
    .addColumn('mime_type', 'text', (col) => col.notNull())
    .addColumn('original', 'bytea', (col) => col.notNull())
    .addColumn('original_bytes', 'integer', (col) => col.notNull())
    .addColumn('width', 'integer')
    .addColumn('height', 'integer')
    .addColumn('dominant_color', 'text')
    .addColumn('status', 'text', (col) =>
      col
        .notNull()
        .defaultTo('queued')
        .check(sql`status in ('queued', 'processing', 'ready', 'failed')`),
    )
    .addColumn('attempts', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('error', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('processed_at', 'timestamptz')
    .execute();
  await db.schema.createIndex('images_created_at_idx').on('images').column('created_at').execute();

  await db.schema
    .createTable('variants')
    .addColumn('image_id', 'uuid', (col) => col.notNull().references('images.id').onDelete('cascade'))
    .addColumn('size', 'integer', (col) => col.notNull())
    .addColumn('width', 'integer', (col) => col.notNull())
    .addColumn('height', 'integer', (col) => col.notNull())
    .addColumn('bytes', 'integer', (col) => col.notNull())
    .addColumn('etag', 'text', (col) => col.notNull())
    .addColumn('data', 'bytea', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint('variants_pkey', ['image_id', 'size'])
    .execute();

  await db.schema
    .createTable('app_meta')
    .addColumn('key', 'text', (col) => col.primaryKey())
    .addColumn('value', 'text', (col) => col.notNull())
    .execute();
}

/** Drops everything created by `up`. */
export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('variants').execute();
  await db.schema.dropTable('images').execute();
  await db.schema.dropTable('app_meta').execute();
}
