import { z } from 'zod';
import { ChartDocumentSchema } from './chart-document';
import type { ValidationIssue } from './issues';
import { KeyNameSchema, LanguageTagSchema, OpaqueIdSchema, UtcTimestampSchema } from './primitives';

/*
 * Catalog domain entities (SPEC §4). Song identity (Work), recorded
 * performance (Recording) and playable chart (Arrangement) are distinct.
 */

const ExternalIdsSchema = z.record(
  z.string().regex(/^[a-z][a-z0-9_]{1,31}$/),
  z.string().min(1).max(256),
);

const NameSchema = z.string().min(1).max(200);

const TimestampsShape = {
  createdAt: UtcTimestampSchema,
  updatedAt: UtcTimestampSchema,
};

// --- rights and visibility -------------------------------------------------

export const RIGHTS_STATUSES = [
  'unknown',
  'synthetic',
  'owner_original',
  'licensed',
  'permission_granted',
  'public_domain',
  'not_permitted',
] as const;
export const RightsStatusSchema = z.enum(RIGHTS_STATUSES);
export type RightsStatus = z.infer<typeof RightsStatusSchema>;

/** Rights that allow showing content beyond its owner. `unknown` fails closed. */
export const REDISTRIBUTABLE_RIGHTS: ReadonlySet<RightsStatus> = new Set([
  'synthetic',
  'owner_original',
  'licensed',
  'permission_granted',
  'public_domain',
]);

export const VISIBILITIES = ['private', 'shared', 'public'] as const;
export const VisibilitySchema = z.enum(VISIBILITIES);
export type Visibility = z.infer<typeof VisibilitySchema>;

/** Content permissions are per asset and independent of the software license. */
export const ContentRightsSchema = z.strictObject({
  lyrics: RightsStatusSchema,
  chart: RightsStatusSchema,
  audio: RightsStatusSchema,
  attribution: z.string().max(500).nullable(),
  notes: z.string().max(2000).nullable(),
});
export type ContentRights = z.infer<typeof ContentRightsSchema>;

/**
 * Whether a chart with these rights may be shown at `visibility`. Private
 * content is visible to its owner regardless; shared/public require explicit
 * lyric and chart redistribution rights.
 */
export function rightsAllowVisibility(rights: ContentRights, visibility: Visibility): boolean {
  if (visibility === 'private') {
    return true;
  }
  return REDISTRIBUTABLE_RIGHTS.has(rights.lyrics) && REDISTRIBUTABLE_RIGHTS.has(rights.chart);
}

// --- artists, works, recordings ---------------------------------------------

export const ArtistSchema = z.strictObject({
  id: OpaqueIdSchema,
  name: NameSchema,
  aliases: z.array(NameSchema).max(50),
  ...TimestampsShape,
});
export type Artist = z.infer<typeof ArtistSchema>;

export const WORK_CREDIT_ROLES = ['composer', 'lyricist', 'arranger', 'original_artist'] as const;

export const WorkSchema = z.strictObject({
  id: OpaqueIdSchema,
  title: NameSchema,
  /** Alternate titles incl. Traditional/Simplified and romanized forms. */
  titleAliases: z.array(NameSchema).max(50),
  language: LanguageTagSchema.nullable(),
  credits: z
    .array(z.strictObject({ artistId: OpaqueIdSchema, role: z.enum(WORK_CREDIT_ROLES) }))
    .max(50),
  externalIds: ExternalIdsSchema,
  ...TimestampsShape,
});
export type Work = z.infer<typeof WorkSchema>;

export const RECORDING_KINDS = ['studio', 'live', 'cover', 'acoustic', 'unknown'] as const;
export const RecordingKindSchema = z.enum(RECORDING_KINDS);

export const RecordingSchema = z.strictObject({
  id: OpaqueIdSchema,
  workId: OpaqueIdSchema,
  /** Version-specific title (e.g. "Live at ..."); `null` uses the Work title. */
  title: NameSchema.nullable(),
  artistCredits: z
    .array(z.strictObject({ artistId: OpaqueIdSchema, role: z.enum(['performer', 'featured']) }))
    .min(1)
    .max(20),
  kind: RecordingKindSchema,
  durationMs: z.int().min(1).nullable(),
  externalIds: ExternalIdsSchema,
  sourceReferenceIds: z.array(OpaqueIdSchema).max(50),
  ...TimestampsShape,
});
export type Recording = z.infer<typeof RecordingSchema>;

// --- arrangements and compatibility ------------------------------------------

export const ARRANGEMENT_VARIANTS = ['original', 'simplified', 'capo_friendly', 'other'] as const;

export const ArrangementSchema = z.strictObject({
  id: OpaqueIdSchema,
  workId: OpaqueIdSchema,
  name: NameSchema,
  variant: z.enum(ARRANGEMENT_VARIANTS),
  publishedRevisionId: OpaqueIdSchema.nullable(),
  visibility: VisibilitySchema,
  rights: ContentRightsSchema,
  ...TimestampsShape,
});
export type Arrangement = z.infer<typeof ArrangementSchema>;

export const COMPATIBILITY_PROVENANCES = [
  'exact_audio_match',
  'human_verified',
  'suggested',
  'unknown',
] as const;
export const CompatibilityProvenanceSchema = z.enum(COMPATIBILITY_PROVENANCES);
export type CompatibilityProvenance = z.infer<typeof CompatibilityProvenanceSchema>;

/** `suggested` and `unknown` are never treated as verified. */
export function isVerifiedCompatibility(provenance: CompatibilityProvenance): boolean {
  return provenance === 'exact_audio_match' || provenance === 'human_verified';
}

export const ArrangementRecordingCompatibilitySchema = z.strictObject({
  arrangementId: OpaqueIdSchema,
  recordingId: OpaqueIdSchema,
  provenance: CompatibilityProvenanceSchema,
  /** Key the recording actually sounds in, when known. */
  recordedKey: KeyNameSchema.nullable(),
  /** Semitones from the arrangement's concert key to the recording, when known. */
  transposeSemitones: z.int().min(-11).max(11).nullable(),
  /** An admin explicitly reviewed a mapping across different Works. */
  crossWorkReviewed: z.boolean(),
  ...TimestampsShape,
});
export type ArrangementRecordingCompatibility = z.infer<
  typeof ArrangementRecordingCompatibilitySchema
>;

export function checkCompatibility(
  arrangement: Arrangement,
  recording: Recording,
  compatibility: ArrangementRecordingCompatibility,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (compatibility.arrangementId !== arrangement.id) {
    issues.push({
      code: 'REFERENCE_MISMATCH',
      path: ['arrangementId'],
      message: 'compatibility references a different arrangement',
    });
  }
  if (compatibility.recordingId !== recording.id) {
    issues.push({
      code: 'REFERENCE_MISMATCH',
      path: ['recordingId'],
      message: 'compatibility references a different recording',
    });
  }
  if (arrangement.workId !== recording.workId && !compatibility.crossWorkReviewed) {
    issues.push({
      code: 'REFERENCE_MISMATCH',
      path: ['crossWorkReviewed'],
      message: 'arrangement and recording belong to different works without a reviewed exception',
    });
  }
  return issues;
}

// --- chart revisions ----------------------------------------------------------

export const REVISION_STATUSES = ['draft', 'needs_review', 'published', 'rejected'] as const;
export const RevisionStatusSchema = z.enum(REVISION_STATUSES);
export type RevisionStatus = z.infer<typeof RevisionStatusSchema>;

export const REVISION_ORIGINS = ['human', 'chordpro_import', 'ai_draft'] as const;

/** Immutable once created; edits append a new revision. */
export const ChartRevisionSchema = z.strictObject({
  id: OpaqueIdSchema,
  arrangementId: OpaqueIdSchema,
  revision: z.int().min(1),
  status: RevisionStatusSchema,
  origin: z.enum(REVISION_ORIGINS),
  /** Revision this one was derived from (edit history / AI draft review). */
  parentRevisionId: OpaqueIdSchema.nullable(),
  document: ChartDocumentSchema,
  createdBy: OpaqueIdSchema.nullable(),
  createdAt: UtcTimestampSchema,
});
export type ChartRevision = z.infer<typeof ChartRevisionSchema>;

export function checkRevisionDocumentConsistency(revision: ChartRevision): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (revision.document.chartRevisionId !== revision.id) {
    issues.push({
      code: 'REFERENCE_MISMATCH',
      path: ['document', 'chartRevisionId'],
      message: 'document chartRevisionId must equal the revision id',
    });
  }
  if (revision.document.arrangementId !== revision.arrangementId) {
    issues.push({
      code: 'REFERENCE_MISMATCH',
      path: ['document', 'arrangementId'],
      message: 'document arrangementId must equal the revision arrangementId',
    });
  }
  if (revision.document.revision !== revision.revision) {
    issues.push({
      code: 'REFERENCE_MISMATCH',
      path: ['document', 'revision'],
      message: 'document revision number must equal the revision number',
    });
  }
  return issues;
}

/**
 * Invariants for pointing `arrangement.publishedRevisionId` at `revision`
 * (SPEC §4). The service layer enforces these inside the publish transaction.
 */
export function checkPublishable(
  arrangement: Arrangement,
  revision: ChartRevision,
): ValidationIssue[] {
  const issues = checkRevisionDocumentConsistency(revision);
  if (revision.arrangementId !== arrangement.id) {
    issues.push({
      code: 'REFERENCE_MISMATCH',
      path: ['arrangementId'],
      message: 'revision belongs to a different arrangement',
    });
  }
  if (revision.status !== 'published') {
    issues.push({
      code: 'REFERENCE_MISMATCH',
      path: ['status'],
      message: `revision status must be "published", got "${revision.status}"`,
    });
  }
  if (!rightsAllowVisibility(arrangement.rights, arrangement.visibility)) {
    issues.push({
      code: 'REFERENCE_MISMATCH',
      path: ['rights'],
      message: `content rights do not permit "${arrangement.visibility}" visibility`,
    });
  }
  return issues;
}

// --- sources -------------------------------------------------------------------

export const SOURCE_PLATFORMS = [
  'youtube',
  'spotify',
  'apple_music',
  'musicbrainz',
  'user_upload',
  'other',
] as const;

export const SOURCE_PERMISSIONS = [
  'unknown',
  'discovery_only',
  'analysis_permitted',
  'denied',
] as const;

export const SOURCE_USES = [
  'metadata',
  'embed_playback',
  'audio_analysis',
  'lyrics_reference',
  'redistribution',
] as const;

/** Discovery links and analyzable audio are separate (SPEC §4, §11). URLs are untrusted. */
export const SourceReferenceSchema = z.strictObject({
  id: OpaqueIdSchema,
  platform: z.enum(SOURCE_PLATFORMS),
  platformSourceId: z.string().min(1).max(256).nullable(),
  url: z
    .url({ protocol: /^https$/ })
    .max(2048)
    .nullable(),
  metadata: z.strictObject({
    title: z.string().max(300).nullable(),
    artist: z.string().max(300).nullable(),
    durationMs: z.int().min(1).nullable(),
  }),
  permission: z.enum(SOURCE_PERMISSIONS),
  permittedUses: z.array(z.enum(SOURCE_USES)).max(SOURCE_USES.length),
  acquiredAt: UtcTimestampSchema,
});
export type SourceReference = z.infer<typeof SourceReferenceSchema>;

/** Audio analysis needs an explicit grant; a public URL alone never qualifies. */
export function canAnalyzeSource(source: SourceReference): boolean {
  return (
    source.permission === 'analysis_permitted' && source.permittedUses.includes('audio_analysis')
  );
}
