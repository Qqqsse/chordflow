import { z } from 'zod';
import { listChordOccurrences, type ChartDocument } from './chart-document';
import { countGraphemes } from './graphemes';
import {
  ContractValidationError,
  failure,
  fromZodError,
  success,
  type ValidationIssue,
  type ValidationResult,
} from './issues';
import { OpaqueIdSchema, SemVerSchema } from './primitives';

/**
 * RecordingSync: optional, recording-specific timing for one ChartRevision
 * (SPEC §4). Absolute timestamps live here, never in the reusable chart.
 */
export const RECORDING_SYNC_SCHEMA_VERSION = '1.0.0';
export const SUPPORTED_SYNC_MAJOR = 1;

export const ALIGNMENT_STATUSES = ['high_confidence', 'uncertain'] as const;
export const AlignmentStatusSchema = z.enum(ALIGNMENT_STATUSES);
export type AlignmentStatus = z.infer<typeof AlignmentStatusSchema>;

const MsSchema = z.int().min(0);

/** Model-specific score. Not a calibrated probability unless the model's evaluation says so. */
export const ModelConfidenceSchema = z.strictObject({
  value: z.number().min(0).max(1),
  model: z.string().min(1).max(128),
  calibrated: z.boolean(),
});

export const AlignedChordSchema = z.strictObject({
  chordOccurrenceId: OpaqueIdSchema,
  startMs: MsSchema,
  endMs: MsSchema,
  status: AlignmentStatusSchema,
  confidence: ModelConfidenceSchema.optional(),
});
export type AlignedChord = z.infer<typeof AlignedChordSchema>;

export const AlignedLyricSchema = z.strictObject({
  lineId: OpaqueIdSchema,
  /** Half-open grapheme range [fromGrapheme, toGrapheme) of the line's NFC text. */
  fromGrapheme: z.int().min(0),
  toGrapheme: z.int().min(1),
  startMs: MsSchema,
  endMs: MsSchema,
  status: AlignmentStatusSchema,
  confidence: ModelConfidenceSchema.optional(),
});
export type AlignedLyric = z.infer<typeof AlignedLyricSchema>;

export const UNMATCHED_REASONS = [
  'instrumental_or_unknown',
  'ad_lib',
  'backing_vocals',
  'low_confidence',
  'not_in_reference',
] as const;

export const UnmatchedIntervalSchema = z.strictObject({
  startMs: MsSchema,
  endMs: MsSchema,
  reason: z.enum(UNMATCHED_REASONS),
});

export const RecordingSyncSchema = z.strictObject({
  schemaVersion: SemVerSchema,
  recordingId: OpaqueIdSchema,
  chartRevisionId: OpaqueIdSchema,
  timebase: z.literal('recording_start_ms'),
  /** Offset added to every timestamp to map onto the recording's own timeline. */
  offsetMs: z.int(),
  recordingDurationMs: z.int().min(1).optional(),
  alignedChords: z.array(AlignedChordSchema).max(10_000),
  alignedLyrics: z.array(AlignedLyricSchema).max(20_000),
  unmatchedIntervals: z.array(UnmatchedIntervalSchema).max(10_000),
  /** Explicitly unaligned content: kept in the chart, no timing claimed. */
  unaligned: z
    .strictObject({
      chordOccurrenceIds: z.array(OpaqueIdSchema),
      lineIds: z.array(OpaqueIdSchema),
    })
    .optional(),
});
export type RecordingSync = z.infer<typeof RecordingSyncSchema>;

interface Interval {
  startMs: number;
  endMs: number;
}

function checkInterval(
  interval: Interval,
  path: (string | number)[],
  sync: RecordingSync,
  issues: ValidationIssue[],
): void {
  if (interval.endMs < interval.startMs) {
    issues.push({ code: 'INTERVAL_INVALID', path, message: 'endMs must be >= startMs' });
  }
  const duration = sync.recordingDurationMs;
  if (duration !== undefined) {
    const start = interval.startMs + sync.offsetMs;
    const end = interval.endMs + sync.offsetMs;
    if (start < 0 || end > duration) {
      issues.push({
        code: 'INTERVAL_OUT_OF_RANGE',
        path,
        message: `interval (with offset) must lie within 0..${duration} ms`,
      });
    }
  }
}

export interface RecordingSyncContext {
  /** When given, referenced ids and grapheme ranges are checked against this revision. */
  chart?: ChartDocument;
}

export function checkRecordingSyncSemantics(
  sync: RecordingSync,
  context: RecordingSyncContext = {},
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (Number(sync.schemaVersion.split('.')[0]) !== SUPPORTED_SYNC_MAJOR) {
    issues.push({
      code: 'UNSUPPORTED_SCHEMA_VERSION',
      path: ['schemaVersion'],
      message: `unsupported sync schema major version (supported: ${SUPPORTED_SYNC_MAJOR}.x.y)`,
    });
    return issues;
  }

  // Monotonicity is per track: chords by start time; lyrics by start time within each line.
  // Distinct tracks may overlap freely (SPEC §4).
  let previousChordStart = -Infinity;
  sync.alignedChords.forEach((chord, i) => {
    const path = ['alignedChords', i];
    checkInterval(chord, path, sync, issues);
    if (chord.startMs < previousChordStart) {
      issues.push({ code: 'NOT_MONOTONIC', path, message: 'chord startMs must be non-decreasing' });
    }
    previousChordStart = chord.startMs;
  });

  const lastLyricStartByLine = new Map<string, number>();
  sync.alignedLyrics.forEach((lyric, i) => {
    const path = ['alignedLyrics', i];
    checkInterval(lyric, path, sync, issues);
    if (lyric.toGrapheme <= lyric.fromGrapheme) {
      issues.push({
        code: 'GRAPHEME_RANGE_INVALID',
        path,
        message: 'toGrapheme must be greater than fromGrapheme',
      });
    }
    const previous = lastLyricStartByLine.get(lyric.lineId);
    if (previous !== undefined && lyric.startMs < previous) {
      issues.push({
        code: 'NOT_MONOTONIC',
        path,
        message: `lyric startMs must be non-decreasing within line "${lyric.lineId}"`,
      });
    }
    lastLyricStartByLine.set(lyric.lineId, lyric.startMs);
  });

  sync.unmatchedIntervals.forEach((interval, i) => {
    checkInterval(interval, ['unmatchedIntervals', i], sync, issues);
  });

  const chart = context.chart;
  if (chart !== undefined) {
    if (chart.chartRevisionId !== sync.chartRevisionId) {
      issues.push({
        code: 'REFERENCE_MISMATCH',
        path: ['chartRevisionId'],
        message: 'sync was aligned to a different chart revision',
      });
      return issues;
    }
    const chordIds = new Set(listChordOccurrences(chart).map(({ chord }) => chord.id));
    const lineLengths = new Map<string, number>();
    for (const section of chart.sections) {
      for (const line of section.lines) {
        lineLengths.set(line.id, countGraphemes(line.text));
      }
    }
    const checkChordRef = (id: string, path: (string | number)[]) => {
      if (!chordIds.has(id)) {
        issues.push({
          code: 'UNKNOWN_REFERENCE',
          path,
          message: `unknown chord occurrence "${id}"`,
        });
      }
    };
    const checkLineRef = (id: string, path: (string | number)[]) => {
      if (!lineLengths.has(id)) {
        issues.push({ code: 'UNKNOWN_REFERENCE', path, message: `unknown line "${id}"` });
      }
    };
    sync.alignedChords.forEach((chord, i) => {
      checkChordRef(chord.chordOccurrenceId, ['alignedChords', i, 'chordOccurrenceId']);
    });
    sync.alignedLyrics.forEach((lyric, i) => {
      const path = ['alignedLyrics', i];
      checkLineRef(lyric.lineId, [...path, 'lineId']);
      const length = lineLengths.get(lyric.lineId);
      if (length !== undefined && lyric.toGrapheme > length) {
        issues.push({
          code: 'GRAPHEME_RANGE_INVALID',
          path: [...path, 'toGrapheme'],
          message: `range end ${lyric.toGrapheme} exceeds line length ${length} graphemes`,
        });
      }
    });
    sync.unaligned?.chordOccurrenceIds.forEach((id, i) => {
      checkChordRef(id, ['unaligned', 'chordOccurrenceIds', i]);
    });
    sync.unaligned?.lineIds.forEach((id, i) => {
      checkLineRef(id, ['unaligned', 'lineIds', i]);
    });
  }

  return issues;
}

export function validateRecordingSync(
  input: unknown,
  context: RecordingSyncContext = {},
): ValidationResult<RecordingSync> {
  const parsed = RecordingSyncSchema.safeParse(input);
  if (!parsed.success) {
    return failure(fromZodError(parsed.error));
  }
  const issues = checkRecordingSyncSemantics(parsed.data, context);
  return issues.length > 0 ? failure(issues) : success(parsed.data);
}

export function parseRecordingSync(
  input: unknown,
  context: RecordingSyncContext = {},
): RecordingSync {
  const result = validateRecordingSync(input, context);
  if (!result.ok) {
    throw new ContractValidationError('Recording sync', result.issues);
  }
  return result.value;
}
