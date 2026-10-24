import { z } from 'zod';
import {
  ArrangementSchema,
  ChartRevisionSchema,
  CompatibilityProvenanceSchema,
  RecordingSchema,
  RevisionStatusSchema,
  SOURCE_PLATFORMS,
  SourceReferenceSchema,
  WorkSchema,
} from './domain';
import { OpaqueIdSchema, SemVerSchema, UtcTimestampSchema } from './primitives';
import { RecordingSyncSchema } from './recording-sync';

/*
 * REST API contract v1 (SPEC §10). One envelope for every route; response
 * `data` schemas are shared with tests and published as OpenAPI/JSON Schema.
 */

/** 1.1.0: personal library routes (`/me/*`); 1.2.0: job retry and worker status. Both additive. */
export const API_VERSION = '1.2.0';

export const ApiMetaSchema = z.strictObject({
  requestId: z.string().min(1).max(100),
  schemaVersion: SemVerSchema,
});

export const ApiErrorSchema = z.strictObject({
  error: z.strictObject({
    code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    message: z.string(),
    details: z.json().nullable(),
    requestId: z.string().min(1).max(100),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export function envelopeOf<T extends z.ZodType>(data: T) {
  return z.strictObject({ data, meta: ApiMetaSchema });
}

export const API_ERROR_CODES = [
  'INVALID_REQUEST',
  'INVALID_QUERY',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'CSRF_REJECTED',
  'RATE_LIMITED',
  'NOT_FOUND',
  'WORK_NOT_FOUND',
  'RECORDING_NOT_FOUND',
  'ARRANGEMENT_NOT_FOUND',
  'CHART_NOT_FOUND',
  'SYNC_NOT_FOUND',
  'REVISION_CONFLICT',
  'VALIDATION_FAILED',
  'PUBLISH_REJECTED',
  'PAYLOAD_TOO_LARGE',
  'JOB_NOT_FOUND',
  'RESULT_NOT_AVAILABLE',
  'IDEMPOTENCY_CONFLICT',
  'QUOTA_EXCEEDED',
  'SOURCE_NOT_AUTHORIZED',
  'JOB_STATE_CONFLICT',
  'LEASE_LOST',
  'ARTIFACT_VALIDATION_FAILED',
  'CONFIGURATION_INVALID',
  'SERVICE_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export const HealthDataSchema = z.strictObject({
  status: z.literal('ok'),
  service: z.literal('web'),
  dataMode: z.enum(['demo', 'database']),
});

export const ReadinessDataSchema = z.strictObject({
  status: z.enum(['ready', 'not_ready']),
  checks: z.strictObject({ database: z.enum(['ok', 'unavailable', 'not_configured']) }),
});

export const ArtistRefSchema = z.strictObject({ id: OpaqueIdSchema, name: z.string() });

export const ArrangementSummarySchema = ArrangementSchema.pick({
  id: true,
  workId: true,
  name: true,
  variant: true,
  visibility: true,
  publishedRevisionId: true,
}).extend({
  hasPublishedChart: z.boolean(),
  attribution: z.string().nullable(),
});
export type ArrangementSummary = z.infer<typeof ArrangementSummarySchema>;

export const MappingSummarySchema = z.strictObject({
  arrangementId: OpaqueIdSchema,
  recordingId: OpaqueIdSchema,
  provenance: CompatibilityProvenanceSchema,
  verified: z.boolean(),
  recordedKey: z.string().nullable(),
  transposeSemitones: z.int().nullable(),
});

export const RecordingSummarySchema = z.strictObject({
  id: OpaqueIdSchema,
  workId: OpaqueIdSchema,
  title: z.string().nullable(),
  kind: RecordingSchema.shape.kind,
  performers: z.array(ArtistRefSchema),
  mappings: z.array(MappingSummarySchema),
});
export type RecordingSummary = z.infer<typeof RecordingSummarySchema>;

export const WorkSummarySchema = z.strictObject({
  id: OpaqueIdSchema,
  title: z.string(),
  titleAliases: z.array(z.string()),
  language: z.string().nullable(),
  credits: z.array(
    z.strictObject({ role: WorkSchema.shape.credits.element.shape.role, artist: ArtistRefSchema }),
  ),
});

export const SearchHitSchema = z.strictObject({
  work: WorkSummarySchema,
  recordings: z.array(RecordingSummarySchema),
  arrangements: z.array(ArrangementSummarySchema),
});
export type SearchHit = z.infer<typeof SearchHitSchema>;

export const SourceLookupSchema = z.strictObject({
  platform: z.enum(SOURCE_PLATFORMS),
  platformSourceId: z.string(),
  /** Known source in the catalog, if any. URLs are never fetched. */
  matchedSourceId: OpaqueIdSchema.nullable(),
});

export const SearchDataSchema = z.strictObject({
  query: z.string(),
  /** Present when the query was a supported source URL. */
  source: SourceLookupSchema.nullable(),
  items: z.array(SearchHitSchema),
  nextCursor: z.string().nullable(),
});
export type SearchData = z.infer<typeof SearchDataSchema>;

export const WorkDetailSchema = z.strictObject({
  work: WorkSummarySchema,
  recordings: z.array(RecordingSummarySchema),
  arrangements: z.array(ArrangementSummarySchema),
});

export const RecordingDetailSchema = z.strictObject({
  recording: RecordingSummarySchema,
  work: WorkSummarySchema,
  durationMs: z.int().nullable(),
  sources: z.array(
    SourceReferenceSchema.pick({
      id: true,
      platform: true,
      platformSourceId: true,
      url: true,
      permission: true,
      permittedUses: true,
    }),
  ),
  arrangements: z.array(ArrangementSummarySchema),
});

export const RevisionSummarySchema = z.strictObject({
  id: OpaqueIdSchema,
  revision: z.int().min(1),
  status: RevisionStatusSchema,
  origin: ChartRevisionSchema.shape.origin,
  createdAt: UtcTimestampSchema,
});

export const ArrangementDetailSchema = z.strictObject({
  arrangement: ArrangementSummarySchema,
  rights: ArrangementSchema.shape.rights,
  work: WorkSummarySchema,
  revisions: z.array(RevisionSummarySchema),
  mappings: z.array(MappingSummarySchema),
});

export const ChartRevisionDataSchema = ChartRevisionSchema;
export const RecordingSyncDataSchema = RecordingSyncSchema;

// --- write API (database mode; authenticated, same-origin) -----------------

export const ChordProImportRequestSchema = z.strictObject({
  source: z.string().max(200_000),
  title: z.string().trim().min(1).max(200).optional(),
  language: z.string().max(35).optional(),
  chordsWrittenAs: z.enum(['concert', 'capo_shapes']).optional(),
});

export const ImportIssueSchema = z.strictObject({
  severity: z.enum(['error', 'warning']),
  code: z.string(),
  line: z.int().min(0),
  column: z.int().nullable(),
  message: z.string(),
});

export const ChordProImportDataSchema = z.strictObject({
  ok: z.boolean(),
  document: ChartRevisionSchema.shape.document.nullable(),
  metadata: z
    .strictObject({
      title: z.string().nullable(),
      subtitles: z.array(z.string()),
      artists: z.array(z.string()),
      key: z.string().nullable(),
      capo: z.int().nullable(),
      tempo: z.number().nullable(),
      time: z.string().nullable(),
    })
    .nullable(),
  issues: z.array(ImportIssueSchema),
});

export const NewArrangementRequestSchema = z.strictObject({
  work: z.union([
    z.strictObject({ id: OpaqueIdSchema }),
    z.strictObject({
      title: z.string().trim().min(1).max(200),
      titleAliases: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
      language: z.string().max(35).nullable().default(null),
      artistName: z.string().trim().min(1).max(200).nullable().default(null),
    }),
  ]),
  name: z.string().trim().min(1).max(200),
  variant: ArrangementSchema.shape.variant.default('original'),
  visibility: ArrangementSchema.shape.visibility.default('private'),
  rights: ArrangementSchema.shape.rights,
});

export const NewArrangementDataSchema = z.strictObject({
  workId: OpaqueIdSchema,
  arrangementId: OpaqueIdSchema,
});

export const ArrangementSettingsRequestSchema = z.strictObject({
  visibility: ArrangementSchema.shape.visibility,
  rights: ArrangementSchema.shape.rights,
});

export const NewRevisionRequestSchema = z.strictObject({
  /** Chart content (ids, revision number and schema version are assigned by the server)… */
  document: z.record(z.string(), z.json()).optional(),
  /** …or ChordPro source. Exactly one must be given. */
  chordpro: ChordProImportRequestSchema.omit({ language: true }).optional(),
  parentRevisionId: OpaqueIdSchema.nullable().default(null),
  /** Optimistic concurrency: latest revision number the editor saw; mismatch → 409. */
  expectedLatestRevision: z.int().min(1).nullable().optional(),
});

export const NewRevisionDataSchema = z.strictObject({
  id: OpaqueIdSchema,
  revision: z.int().min(1),
  status: z.literal('draft'),
});

export const PublishRequestSchema = z.strictObject({ revisionId: OpaqueIdSchema });
export const PublishDataSchema = z.strictObject({
  publishedRevisionId: OpaqueIdSchema,
  changed: z.boolean(),
});

export const InvitationCreateRequestSchema = z.strictObject({
  role: z.enum(['member', 'admin']).default('member'),
  note: z.string().trim().max(200).nullable().default(null),
  ttlDays: z.int().min(1).max(30).default(7),
});

export const InvitationCreatedDataSchema = z.strictObject({
  id: OpaqueIdSchema,
  /** Shown once; only its SHA-256 hash is stored. */
  token: z.string(),
  acceptUrl: z.url(),
  expiresAt: UtcTimestampSchema,
});

export const InvitationAcceptRequestSchema = z.strictObject({
  token: z.string().min(1).max(200),
  email: z.string(),
  name: z.string(),
  password: z.string(),
});
