import { z } from 'zod';
import { ArtifactManifestEntrySchema, ARTIFACT_DEPENDENCIES } from './artifacts';
import { NewArrangementRequestSchema } from './api';
import { ChartRevisionSchema } from './domain';
import { ChartDocumentSchema, type ChartDocument } from './chart-document';
import type { ValidationIssue } from './issues';
import { JobErrorCodeSchema, ExternalJobStatusSchema, JobStateSchema } from './jobs';
import {
  ChordSymbolTextSchema,
  KeyNameSchema,
  LanguageTagSchema,
  OpaqueIdSchema,
  SemVerSchema,
  UtcTimestampSchema,
} from './primitives';

/*
 * Generation job + worker contract v1 (SPEC §10, §11). The worker is a
 * separate (Python) process that only speaks this HTTP contract; Pydantic
 * models in services/ai-worker mirror these schemas and both sides validate
 * the shared fixtures in fixtures/contracts/worker/.
 */

/** Bumped on any change to the worker-facing schemas; the worker refuses other majors. */
export const GENERATION_CONTRACT_VERSION = '1.0.0';

export const MAX_REFERENCE_LYRICS_LENGTH = 5_000;
export const MAX_REFERENCE_LYRICS_LINES = 200;

// --- submission ----------------------------------------------------------------

export const GenerationInputSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    /** Lyrics the submitter has rights to (self-written, public domain, licensed). No audio. */
    kind: z.literal('reference_lyrics'),
    lyrics: z
      .string()
      .min(1)
      .max(MAX_REFERENCE_LYRICS_LENGTH)
      .refine((text) => text.split('\n').length <= MAX_REFERENCE_LYRICS_LINES, {
        message: `at most ${String(MAX_REFERENCE_LYRICS_LINES)} lines`,
      }),
    language: LanguageTagSchema,
    /** Concert key hint for the processor; `null` lets it choose. */
    concertKey: KeyNameSchema.nullable().default(null),
    seed: z.int().min(0).max(2_147_483_647).default(0),
  }),
  z.strictObject({
    /** Analysis of a catalog source; requires an explicit audio-analysis grant. */
    kind: z.literal('source_reference'),
    sourceReferenceId: OpaqueIdSchema,
  }),
]);
export type GenerationInput = z.infer<typeof GenerationInputSchema>;

export const PROCESSOR_MODES = ['mock'] as const;
export type ProcessorMode = (typeof PROCESSOR_MODES)[number];
export const LLM_REVIEW_PROVIDERS = ['disabled', 'fake'] as const;

export const GenerationOptionsSchema = z.strictObject({
  /** `mock` is the CPU synthetic processor chain; GPU adapters arrive in M8. */
  processor: z.enum(PROCESSOR_MODES).default('mock'),
  /** Optional structured reviewer. Paid providers are not available in v1. */
  llmReview: z.enum(LLM_REVIEW_PROVIDERS).default('disabled'),
});
export type GenerationOptions = z.infer<typeof GenerationOptionsSchema>;

/** Lyric rights under which reference-lyrics generation may run; `unknown` and `not_permitted` refuse. */
export const LYRICS_RIGHTS_FOR_GENERATION = [
  'synthetic',
  'owner_original',
  'licensed',
  'permission_granted',
  'public_domain',
] as const;

export const IdempotencyKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{8,100}$/, 'must be 8-100 characters of [A-Za-z0-9_-]');

export const GenerationJobCreateRequestSchema = z.strictObject({
  /** Client-generated; the same key from the same user always returns the same job. */
  idempotencyKey: IdempotencyKeySchema,
  input: GenerationInputSchema,
  options: GenerationOptionsSchema.default({ processor: 'mock', llmReview: 'disabled' }),
  /** Work + arrangement the draft is filed under (created when the draft arrives). */
  target: NewArrangementRequestSchema,
});
export type GenerationJobCreateRequest = z.infer<typeof GenerationJobCreateRequestSchema>;

// --- progress and quality --------------------------------------------------------

export const PIPELINE_STAGES = [
  'resolve_source',
  'decode_and_probe_audio',
  'chord_recognition',
  'lyric_alignment',
  'fusion',
  'rule_validator',
  'llm_reviewer',
  'draft_producer',
] as const;
export const PipelineStageSchema = z.enum(PIPELINE_STAGES);
export type PipelineStage = z.infer<typeof PipelineStageSchema>;

export const JobProgressSchema = z.strictObject({
  stage: PipelineStageSchema,
  /** Completed fraction of the whole job, 0–1. */
  fraction: z.number().min(0).max(1),
});
export type JobProgress = z.infer<typeof JobProgressSchema>;

export const ProcessorIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/);
export const ProcessorVersionSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9._+-]+$/);

export const DraftTargetSchema = z.strictObject({
  sectionId: OpaqueIdSchema,
  lineId: OpaqueIdSchema.nullable(),
  chordId: OpaqueIdSchema.nullable(),
});
export type DraftTarget = z.infer<typeof DraftTargetSchema>;

export const UNCERTAINTY_REASONS = [
  /** No lyric position could be established for this span. */
  'unaligned',
  /** A measured model reported low confidence (never set by the mock chain). */
  'low_confidence',
  /** Chord falls outside the declared or estimated key. */
  'non_diatonic',
  /** A repeated section could match more than one place. */
  'ambiguous_section',
  /** Produced without audio evidence (synthetic/mock processors). */
  'synthetic_output',
] as const;

export const QualitySpanSchema = z.strictObject({
  target: DraftTargetSchema,
  reason: z.enum(UNCERTAINTY_REASONS),
  message: z.string().min(1).max(300),
  source: z.enum(['processor', 'rule_validator', 'llm_reviewer']),
});
export type QualitySpan = z.infer<typeof QualitySpanSchema>;

/** A suggestion is advice for the reviewer; it is never applied to the draft automatically. */
export const ReviewSuggestionSchema = z.strictObject({
  target: DraftTargetSchema,
  kind: z.enum(['replace_chord', 'note']),
  proposedSymbol: ChordSymbolTextSchema.nullable(),
  rationale: z.string().min(1).max(500),
  evidence: z.array(z.string().min(1).max(200)).max(8),
  provider: z.enum(LLM_REVIEW_PROVIDERS).exclude(['disabled']),
});
export type ReviewSuggestion = z.infer<typeof ReviewSuggestionSchema>;

export const StageReportSchema = z.strictObject({
  stage: PipelineStageSchema,
  processorId: ProcessorIdSchema,
  processorVersion: ProcessorVersionSchema,
  status: z.enum(['ok', 'skipped']),
  note: z.string().max(300).nullable(),
});

export const QualityReportSchema = z
  .strictObject({
    /** What the draft is based on. `synthetic_mock` drafts carry no acoustic evidence. */
    analysis: z.enum(['synthetic_mock', 'audio']),
    /** Measured/calibrated confidence, or `null` when nothing measured it. Never invented. */
    overallConfidence: z.number().min(0).max(1).nullable(),
    spans: z.array(QualitySpanSchema).max(2_000),
    suggestions: z.array(ReviewSuggestionSchema).max(200),
    stages: z.array(StageReportSchema).max(PIPELINE_STAGES.length * 2),
    llm: z.strictObject({
      provider: z.enum(LLM_REVIEW_PROVIDERS),
      calls: z.int().min(0),
      maxCalls: z.int().min(0),
      budgetExceeded: z.boolean(),
    }),
  })
  .refine((report) => report.analysis !== 'synthetic_mock' || report.overallConfidence === null, {
    path: ['overallConfidence'],
    message: 'synthetic drafts have no measured confidence; use null',
  })
  .refine((report) => report.llm.calls <= report.llm.maxCalls, {
    path: ['llm', 'calls'],
    message: 'calls exceed the per-job maximum',
  });
export type QualityReport = z.infer<typeof QualityReportSchema>;

/** The worker submits content only; ids, revision number are assigned by the server. */
export const DraftDocumentSchema = ChartDocumentSchema.omit({
  chartRevisionId: true,
  arrangementId: true,
  revision: true,
});
export type DraftDocument = z.infer<typeof DraftDocumentSchema>;

// --- worker API ------------------------------------------------------------------

export const WorkerIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/);
export const LeaseTokenSchema = z.string().regex(/^lease_[0-9a-f]{32}$/);

export const WorkerClaimRequestSchema = z.strictObject({
  workerId: WorkerIdSchema,
  workerVersion: ProcessorVersionSchema,
  processors: z.array(z.enum(PROCESSOR_MODES)).min(1).max(PROCESSOR_MODES.length),
  leaseSeconds: z.int().min(10).max(600).default(60),
});

export const ClaimedJobSchema = z.strictObject({
  id: OpaqueIdSchema,
  contractVersion: SemVerSchema,
  attempt: z.int().min(1),
  maxAttempts: z.int().min(1),
  leaseToken: LeaseTokenSchema,
  leaseExpiresAt: UtcTimestampSchema,
  title: z.string().min(1).max(200),
  input: GenerationInputSchema,
  options: GenerationOptionsSchema,
});
export type ClaimedJob = z.infer<typeof ClaimedJobSchema>;

export const WorkerClaimDataSchema = z.strictObject({ job: ClaimedJobSchema.nullable() });

export const WorkerHeartbeatRequestSchema = z.strictObject({
  workerId: WorkerIdSchema,
  leaseToken: LeaseTokenSchema,
  progress: JobProgressSchema,
});

export const WorkerHeartbeatDataSchema = z.strictObject({ leaseExpiresAt: UtcTimestampSchema });

export const WorkerCompleteRequestSchema = z.strictObject({
  workerId: WorkerIdSchema,
  leaseToken: LeaseTokenSchema,
  processor: z.strictObject({ id: ProcessorIdSchema, version: ProcessorVersionSchema }),
  draft: z.strictObject({ document: DraftDocumentSchema, quality: QualityReportSchema }),
  artifacts: z.array(ArtifactManifestEntrySchema).min(1).max(64),
});
export type WorkerCompleteRequest = z.infer<typeof WorkerCompleteRequestSchema>;

export const WorkerCompleteDataSchema = z.strictObject({
  jobId: OpaqueIdSchema,
  arrangementId: OpaqueIdSchema,
  revisionId: OpaqueIdSchema,
  /** True when this exact completion had already been recorded (safe retry). */
  replayed: z.boolean(),
});

export const WorkerFailRequestSchema = z.strictObject({
  workerId: WorkerIdSchema,
  leaseToken: LeaseTokenSchema,
  error: z.strictObject({
    code: JobErrorCodeSchema,
    /** Sanitized; must not contain URLs, paths or credentials. */
    message: z.string().min(1).max(300),
    retryable: z.boolean(),
  }),
});

export const WorkerFailDataSchema = z.strictObject({
  state: z.enum(['queued', 'failed_terminal']),
  nextAttemptAt: UtcTimestampSchema.nullable(),
  replayed: z.boolean(),
});

// --- user-facing API ---------------------------------------------------------------

export const GenerationJobViewSchema = z.strictObject({
  id: OpaqueIdSchema,
  status: ExternalJobStatusSchema,
  /** Internal state machine position; administrators only (`null` for others). */
  internalState: JobStateSchema.nullable(),
  title: z.string(),
  inputKind: z.enum(['reference_lyrics', 'source_reference']),
  options: GenerationOptionsSchema,
  progress: JobProgressSchema.nullable(),
  attempt: z.int().min(0),
  maxAttempts: z.int().min(1),
  /** Last error; on a queued job this describes the previous attempt. */
  error: z
    .strictObject({ code: JobErrorCodeSchema, message: z.string(), retryable: z.boolean() })
    .nullable(),
  draft: z.strictObject({ arrangementId: OpaqueIdSchema, revisionId: OpaqueIdSchema }).nullable(),
  /** The failed or cancelled job this one retries, if any. */
  retryOfJobId: OpaqueIdSchema.nullable(),
  /** Whether the caller may start a retry (failed, or cancelled before a draft existed). */
  canRetry: z.boolean(),
  createdAt: UtcTimestampSchema,
  updatedAt: UtcTimestampSchema,
});
export type GenerationJobView = z.infer<typeof GenerationJobViewSchema>;

export const JobEventSchema = z.strictObject({
  from: JobStateSchema.nullable(),
  to: JobStateSchema,
  attempt: z.int().min(0),
  actor: z.enum(['user', 'worker', 'system', 'admin']),
  code: z.string().nullable(),
  at: UtcTimestampSchema,
});
export type JobEvent = z.infer<typeof JobEventSchema>;

export const GenerationJobDataSchema = z.strictObject({
  job: GenerationJobViewSchema,
  /** State transitions, administrators only (empty for others). */
  events: z.array(JobEventSchema),
});

export const GenerationJobCreatedDataSchema = z.strictObject({
  job: GenerationJobViewSchema,
  /** True when an existing job was returned (same idempotency key or equivalent request). */
  reused: z.boolean(),
});

export const GenerationJobListDataSchema = z.strictObject({
  items: z.array(GenerationJobViewSchema),
});

export const GenerationJobResultDataSchema = z.strictObject({
  job: GenerationJobViewSchema,
  events: z.array(JobEventSchema),
  /** The AI draft revision (status `needs_review` until reviewed). */
  revision: ChartRevisionSchema,
  quality: QualityReportSchema,
  processor: z.strictObject({ id: ProcessorIdSchema, version: ProcessorVersionSchema }),
  artifacts: z.array(ArtifactManifestEntrySchema),
});

/** A retry is a new job with the same request; the failed job stays as it was. */
export const GenerationJobRetryRequestSchema = z.strictObject({
  idempotencyKey: IdempotencyKeySchema,
});

export const WorkerStatusSchema = z.strictObject({
  workerId: z.string(),
  workerVersion: z.string(),
  lastSeenAt: UtcTimestampSchema,
  /** Seen within the presence window (60 s). */
  online: z.boolean(),
});

export const WorkerStatusListDataSchema = z.strictObject({
  workers: z.array(WorkerStatusSchema),
  presenceWindowSeconds: z.int().min(1),
});

export const GenerationJobReviewRequestSchema = z.discriminatedUnion('action', [
  /** Publish the AI draft or a human revision derived from it. */
  z.strictObject({ action: z.literal('publish'), revisionId: OpaqueIdSchema }),
  /** Reject the draft revision; the job is cancelled and history kept. */
  z.strictObject({ action: z.literal('reject') }),
]);

export const GenerationJobReviewDataSchema = z.strictObject({
  job: GenerationJobViewSchema,
  publishedRevisionId: OpaqueIdSchema.nullable(),
});

// --- semantic checks ---------------------------------------------------------------

/** Every quality span / suggestion must point at an existing section, line and chord. */
export function checkQualityTargets(
  document: Pick<ChartDocument, 'sections'>,
  report: QualityReport,
): ValidationIssue[] {
  const sections = new Map(
    document.sections.map((section) => [
      section.id,
      new Map(section.lines.map((line) => [line.id, new Set(line.chords.map((c) => c.id))])),
    ]),
  );
  const issues: ValidationIssue[] = [];
  const check = (target: DraftTarget, path: (string | number)[]) => {
    const lines = sections.get(target.sectionId);
    const chords = target.lineId === null ? undefined : lines?.get(target.lineId);
    const ok =
      lines !== undefined &&
      (target.lineId === null
        ? target.chordId === null
        : chords !== undefined && (target.chordId === null || chords.has(target.chordId)));
    if (!ok) {
      issues.push({
        code: 'UNKNOWN_REFERENCE',
        path: [...path, 'target'],
        message: 'target does not name an existing section/line/chord of the draft',
      });
    }
  };
  report.spans.forEach((span, i) => {
    check(span.target, ['spans', i]);
  });
  report.suggestions.forEach((suggestion, i) => {
    check(suggestion.target, ['suggestions', i]);
  });
  return issues;
}

/**
 * Manifest graph rules: unique ids, parents listed in the same manifest and of
 * a kind the child depends on, and exactly one `fusion_draft` (the draft).
 */
export function checkArtifactManifest(
  entries: readonly z.infer<typeof ArtifactManifestEntrySchema>[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const byId = new Map<string, (typeof entries)[number]>();
  entries.forEach((entry, i) => {
    if (byId.has(entry.id)) {
      issues.push({ code: 'DUPLICATE_ID', path: [i, 'id'], message: `duplicate id "${entry.id}"` });
    }
    byId.set(entry.id, entry);
  });
  entries.forEach((entry, i) => {
    entry.parentArtifactIds.forEach((parentId, p) => {
      const parent = byId.get(parentId);
      const allowed: readonly string[] = ARTIFACT_DEPENDENCIES[entry.kind];
      if (parent === undefined || !allowed.includes(parent.kind)) {
        issues.push({
          code: 'UNKNOWN_REFERENCE',
          path: [i, 'parentArtifactIds', p],
          message:
            parent === undefined
              ? `parent "${parentId}" is not in the manifest`
              : `"${entry.kind}" cannot depend on "${parent.kind}"`,
        });
      }
    });
  });
  if (entries.filter((entry) => entry.kind === 'fusion_draft').length !== 1) {
    issues.push({
      code: 'REFERENCE_MISMATCH',
      path: [],
      message: 'manifest must contain exactly one fusion_draft artifact',
    });
  }
  return issues;
}
