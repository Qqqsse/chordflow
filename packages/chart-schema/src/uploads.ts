import { z } from 'zod';
import { OpaqueIdSchema, UtcTimestampSchema } from './primitives';

/*
 * User audio uploads (ADR-003, docs/audio-sources.md). Uploaded audio is
 * private: only its uploader and administrators can list or analyse it, it is
 * never reachable by URL, and it is deleted when withdrawn or after retention.
 * Every upload carries a versioned, append-only rights declaration.
 */

export const AUDIO_FORMATS = ['wav', 'flac', 'mp3', 'ogg', 'm4a'] as const;
export const AudioFormatSchema = z.enum(AUDIO_FORMATS);
export type AudioFormat = z.infer<typeof AudioFormatSchema>;

/** `withdrawn`: deleted by the uploader or an administrator; `expired`: past retention. */
export const AUDIO_UPLOAD_STATUSES = ['active', 'withdrawn', 'expired'] as const;
export const AudioUploadStatusSchema = z.enum(AUDIO_UPLOAD_STATUSES);
export type AudioUploadStatus = z.infer<typeof AudioUploadStatusSchema>;

/** Identifies the exact declaration text the uploader agreed to. */
export const RightsDeclarationVersionSchema = z.string().regex(/^audio-upload-v[1-9][0-9]*$/);

/** Form fields sent with the file (multipart/form-data `POST /audio-uploads`). */
export const AudioUploadMetadataSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  artist: z.string().trim().min(1).max(200).nullable(),
  /** Must equal the server's current declaration version. */
  declarationVersion: RightsDeclarationVersionSchema,
  declarationAccepted: z.literal(true),
});
export type AudioUploadMetadata = z.infer<typeof AudioUploadMetadataSchema>;

export const AudioUploadSchema = z.strictObject({
  id: OpaqueIdSchema,
  /** `user_upload` source for `source_reference` generation jobs. */
  sourceReferenceId: OpaqueIdSchema,
  title: z.string(),
  artist: z.string().nullable(),
  format: AudioFormatSchema,
  sizeBytes: z.int().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  status: AudioUploadStatusSchema,
  declarationVersion: RightsDeclarationVersionSchema,
  owner: z.strictObject({ id: OpaqueIdSchema, name: z.string() }),
  uploadedAt: UtcTimestampSchema,
  /** Scheduled deletion; `null` while a job still needs the audio, or once it has ended. */
  expiresAt: UtcTimestampSchema.nullable(),
  endedAt: UtcTimestampSchema.nullable(),
});
export type AudioUpload = z.infer<typeof AudioUploadSchema>;

export const UPLOAD_DENIAL_REASONS = [
  'role_not_allowed',
  'blocked',
  'storage_not_configured',
] as const;

export const AudioUploadPolicySchema = z.strictObject({
  canUpload: z.boolean(),
  reason: z.enum(UPLOAD_DENIAL_REASONS).nullable(),
  maxBytes: z.int().min(1),
  /** Checked by the worker when it decodes the audio. */
  maxDurationSeconds: z.int().min(1),
  quotaBytes: z.int().min(1),
  /** Total size of the caller's active uploads. */
  usedBytes: z.int().min(0),
  retentionDays: z.int().min(1),
  declarationVersion: RightsDeclarationVersionSchema,
  formats: z.array(AudioFormatSchema),
});
export type AudioUploadPolicy = z.infer<typeof AudioUploadPolicySchema>;

export const AudioUploadBlockSchema = z.strictObject({
  userId: OpaqueIdSchema,
  name: z.string(),
  blockedAt: UtcTimestampSchema,
});

export const AudioUploadListDataSchema = z.strictObject({
  policy: AudioUploadPolicySchema,
  /** The caller's uploads; administrators see every upload. Newest first. */
  items: z.array(AudioUploadSchema),
  /** Accounts whose upload permission is disabled (administrators only; empty otherwise). */
  blockedUsers: z.array(AudioUploadBlockSchema),
});
export type AudioUploadListData = z.infer<typeof AudioUploadListDataSchema>;

export const AudioUploadDataSchema = z.strictObject({ upload: AudioUploadSchema });

export const AudioUploadBlockDataSchema = z.strictObject({
  userId: OpaqueIdSchema,
  blocked: z.boolean(),
});
