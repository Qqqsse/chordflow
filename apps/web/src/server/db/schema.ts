import type { ChartDocument, RecordingSync } from '@chordflow/chart-schema';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/*
 * Catalog schema (SPEC §4). Opaque text ids, UTC timestamps, normalized
 * relational metadata, and validated chart documents as versioned JSONB.
 * Invariants that span rows (immutable revisions, published pointer, same
 * Work mappings) are enforced by triggers in the SQL migrations as well as
 * in the service layer.
 */

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
};

const inList = (column: string, values: readonly string[]) =>
  sql.raw(`${column} in (${values.map((v) => `'${v}'`).join(', ')})`);

export const artists = pgTable('artists', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  aliases: text('aliases')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  ...timestamps,
});

export const works = pgTable(
  'works',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    titleAliases: text('title_aliases')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    language: text('language'),
    externalIds: jsonb('external_ids').$type<Record<string, string>>().notNull().default({}),
    /** Normalized title, aliases and credited/performing artist names for search. */
    searchText: text('search_text').notNull().default(''),
    ...timestamps,
  },
  (t) => [index('works_search_trgm').using('gin', sql`${t.searchText} gin_trgm_ops`)],
);

export const workCredits = pgTable(
  'work_credits',
  {
    workId: text('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    artistId: text('artist_id')
      .notNull()
      .references(() => artists.id),
    role: text('role').notNull(),
    position: integer('position').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.workId, t.artistId, t.role] }),
    check(
      'work_credits_role',
      inList('role', ['composer', 'lyricist', 'arranger', 'original_artist']),
    ),
  ],
);

export const recordings = pgTable(
  'recordings',
  {
    id: text('id').primaryKey(),
    workId: text('work_id')
      .notNull()
      .references(() => works.id),
    title: text('title'),
    kind: text('kind').notNull(),
    durationMs: integer('duration_ms'),
    externalIds: jsonb('external_ids').$type<Record<string, string>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [
    index('recordings_work').on(t.workId),
    check('recordings_kind', inList('kind', ['studio', 'live', 'cover', 'acoustic', 'unknown'])),
    check('recordings_duration', sql`${t.durationMs} is null or ${t.durationMs} > 0`),
  ],
);

export const recordingArtists = pgTable(
  'recording_artists',
  {
    recordingId: text('recording_id')
      .notNull()
      .references(() => recordings.id, { onDelete: 'cascade' }),
    artistId: text('artist_id')
      .notNull()
      .references(() => artists.id),
    role: text('role').notNull(),
    position: integer('position').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.recordingId, t.artistId, t.role] }),
    check('recording_artists_role', inList('role', ['performer', 'featured'])),
  ],
);

export const sourceReferences = pgTable(
  'source_references',
  {
    id: text('id').primaryKey(),
    platform: text('platform').notNull(),
    platformSourceId: text('platform_source_id'),
    url: text('url'),
    metadata: jsonb('metadata')
      .$type<{ title: string | null; artist: string | null; durationMs: number | null }>()
      .notNull(),
    permission: text('permission').notNull(),
    permittedUses: text('permitted_uses')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    acquiredAt: timestamp('acquired_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (t) => [
    uniqueIndex('source_platform_id')
      .on(t.platform, t.platformSourceId)
      .where(sql`${t.platformSourceId} is not null`),
    check(
      'source_platform',
      inList('platform', [
        'youtube',
        'spotify',
        'apple_music',
        'musicbrainz',
        'user_upload',
        'other',
      ]),
    ),
    check(
      'source_permission',
      inList('permission', ['unknown', 'discovery_only', 'analysis_permitted', 'denied']),
    ),
    check('source_url_https', sql`${t.url} is null or ${t.url} like 'https://%'`),
  ],
);

export const recordingSources = pgTable(
  'recording_sources',
  {
    recordingId: text('recording_id')
      .notNull()
      .references(() => recordings.id, { onDelete: 'cascade' }),
    sourceId: text('source_id')
      .notNull()
      .references(() => sourceReferences.id),
    position: integer('position').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.recordingId, t.sourceId] })],
);

const RIGHTS = [
  'unknown',
  'synthetic',
  'owner_original',
  'licensed',
  'permission_granted',
  'public_domain',
  'not_permitted',
];

export const arrangements = pgTable(
  'arrangements',
  {
    id: text('id').primaryKey(),
    workId: text('work_id')
      .notNull()
      .references(() => works.id),
    name: text('name').notNull(),
    variant: text('variant').notNull(),
    /** Points at a published revision of this arrangement (trigger-enforced). */
    publishedRevisionId: text('published_revision_id'),
    visibility: text('visibility').notNull().default('private'),
    ownerUserId: text('owner_user_id'),
    rightsLyrics: text('rights_lyrics').notNull().default('unknown'),
    rightsChart: text('rights_chart').notNull().default('unknown'),
    rightsAudio: text('rights_audio').notNull().default('unknown'),
    rightsAttribution: text('rights_attribution'),
    rightsNotes: text('rights_notes'),
    ...timestamps,
  },
  (t) => [
    index('arrangements_work').on(t.workId),
    check(
      'arrangements_variant',
      inList('variant', ['original', 'simplified', 'capo_friendly', 'other']),
    ),
    check('arrangements_visibility', inList('visibility', ['private', 'shared', 'public'])),
    check('arrangements_rights_lyrics', inList('rights_lyrics', RIGHTS)),
    check('arrangements_rights_chart', inList('rights_chart', RIGHTS)),
    check('arrangements_rights_audio', inList('rights_audio', RIGHTS)),
  ],
);

export const arrangementRecordings = pgTable(
  'arrangement_recordings',
  {
    arrangementId: text('arrangement_id')
      .notNull()
      .references(() => arrangements.id, { onDelete: 'cascade' }),
    recordingId: text('recording_id')
      .notNull()
      .references(() => recordings.id, { onDelete: 'cascade' }),
    provenance: text('provenance').notNull(),
    recordedKey: text('recorded_key'),
    transposeSemitones: integer('transpose_semitones'),
    crossWorkReviewed: boolean('cross_work_reviewed').notNull().default(false),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.arrangementId, t.recordingId] }),
    index('arrangement_recordings_recording').on(t.recordingId),
    check(
      'arrangement_recordings_provenance',
      inList('provenance', ['exact_audio_match', 'human_verified', 'suggested', 'unknown']),
    ),
    check(
      'arrangement_recordings_transpose',
      sql`${t.transposeSemitones} is null or ${t.transposeSemitones} between -11 and 11`,
    ),
  ],
);

export const chartRevisions = pgTable(
  'chart_revisions',
  {
    id: text('id').primaryKey(),
    arrangementId: text('arrangement_id')
      .notNull()
      .references(() => arrangements.id),
    revision: integer('revision').notNull(),
    status: text('status').notNull(),
    origin: text('origin').notNull(),
    parentRevisionId: text('parent_revision_id'),
    /** Validated Chart Document; immutable once inserted (trigger-enforced). */
    document: jsonb('document').$type<ChartDocument>().notNull(),
    schemaVersion: text('schema_version').notNull(),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('chart_revisions_number').on(t.arrangementId, t.revision),
    check(
      'chart_revisions_status',
      inList('status', ['draft', 'needs_review', 'published', 'rejected']),
    ),
    check('chart_revisions_origin', inList('origin', ['human', 'chordpro_import', 'ai_draft'])),
    check('chart_revisions_revision', sql`${t.revision} >= 1`),
  ],
);

export const recordingSyncs = pgTable(
  'recording_syncs',
  {
    recordingId: text('recording_id')
      .notNull()
      .references(() => recordings.id, { onDelete: 'cascade' }),
    chartRevisionId: text('chart_revision_id')
      .notNull()
      .references(() => chartRevisions.id),
    document: jsonb('document').$type<RecordingSync>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.recordingId, t.chartRevisionId] })],
);
