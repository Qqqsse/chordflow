import { AUDIO_FORMATS, AUDIO_UPLOAD_STATUSES } from '@chordflow/chart-schema';
import { sql } from 'drizzle-orm';
import { bigint, bigserial, check, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { authUsers } from './auth-schema';
import { sourceReferences } from './schema';

/*
 * Private user audio uploads (ADR-003). Each upload is a `user_upload` source
 * reference plus its stored file; the rights declaration that authorised it is
 * append-only (trigger-enforced) and outlives the upload and the account.
 */

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const inList = (column: string, values: readonly string[]) =>
  sql.raw(`${column} in (${values.map((v) => `'${v}'`).join(', ')})`);

/** One per upload. Deleting the account only anonymises it (user -> NULL). */
export const audioRightsDeclarations = pgTable(
  'audio_rights_declarations',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: text('user_id').references(() => authUsers.id, { onDelete: 'set null' }),
    sourceId: text('source_id')
      .notNull()
      .unique()
      .references(() => sourceReferences.id),
    version: text('version').notNull(),
    /** SHA-256 of the exact declaration text shown for `version`. */
    textSha256: text('text_sha256').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [check('audio_rights_declarations_sha256', sql`${t.textSha256} ~ '^[0-9a-f]{64}$'`)],
);

export const audioUploads = pgTable(
  'audio_uploads',
  {
    id: text('id').primaryKey(),
    sourceId: text('source_id')
      .notNull()
      .unique()
      .references(() => sourceReferences.id),
    /** Deleting the account removes the rows; the maintenance sweep then deletes the files. */
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    artist: text('artist'),
    format: text('format').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    sha256: text('sha256').notNull(),
    /** Relative to AUDIO_UPLOAD_DIR: `uploads/<source id>/<sha256>.<format>`. Never served. */
    storagePath: text('storage_path').notNull(),
    status: text('status').notNull().default('active'),
    declarationId: bigint('declaration_id', { mode: 'number' })
      .notNull()
      .references(() => audioRightsDeclarations.id),
    createdAt: ts('created_at').notNull().defaultNow(),
    endedAt: ts('ended_at'),
    fileDeletedAt: ts('file_deleted_at'),
  },
  (t) => [
    index('audio_uploads_owner').on(t.ownerUserId, t.createdAt),
    index('audio_uploads_status').on(t.status),
    check('audio_uploads_format', inList('format', AUDIO_FORMATS)),
    check('audio_uploads_status', inList('status', AUDIO_UPLOAD_STATUSES)),
    check('audio_uploads_size', sql`${t.sizeBytes} > 0`),
    check('audio_uploads_sha256', sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
    check('audio_uploads_ended', sql`(${t.status} = 'active') = (${t.endedAt} is null)`),
  ],
);

/** Accounts an administrator stopped from uploading (existing uploads are unaffected). */
export const audioUploadBlocks = pgTable('audio_upload_blocks', {
  userId: text('user_id')
    .primaryKey()
    .references(() => authUsers.id, { onDelete: 'cascade' }),
  blockedBy: text('blocked_by').references(() => authUsers.id, { onDelete: 'set null' }),
  createdAt: ts('created_at').notNull().defaultNow(),
});
