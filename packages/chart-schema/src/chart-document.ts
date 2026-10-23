import { z } from 'zod';
import { countGraphemes, hasControlCharacters, isNfc } from './graphemes';
import {
  ContractValidationError,
  failure,
  fromZodError,
  success,
  type ValidationIssue,
  type ValidationResult,
} from './issues';
import {
  ChordSymbolTextSchema,
  DifficultySchema,
  ExtensionsSchema,
  KeyNameSchema,
  LanguageTagSchema,
  OpaqueIdSchema,
  PitchNameSchema,
  SemVerSchema,
  TimeSignatureSchema,
} from './primitives';

/** Highest Chart Document version this package writes. Readers accept any `1.x.y`. */
export const CHART_DOCUMENT_SCHEMA_VERSION = '1.0.0';
export const SUPPORTED_CHART_MAJOR = 1;

export const SECTION_KINDS = [
  'intro',
  'verse',
  'pre_chorus',
  'chorus',
  'bridge',
  'instrumental',
  'interlude',
  'outro',
  'tag',
  'other',
] as const;
export const SectionKindSchema = z.enum(SECTION_KINDS);
export type SectionKind = z.infer<typeof SectionKindSchema>;

export const MAX_LINE_TEXT_LENGTH = 1_000;
export const MAX_SECTIONS = 200;
export const MAX_LINES_PER_SECTION = 400;
export const MAX_CHORDS_PER_LINE = 64;

export const ChordAnchorSchema = z.strictObject({
  /** Grapheme cluster offset into the NFC line text; 0 = before first, length = after last. */
  graphemeOffset: z.int().min(0),
});
export type ChordAnchor = z.infer<typeof ChordAnchorSchema>;

export const ChordEventSchema = z.strictObject({
  id: OpaqueIdSchema,
  symbol: ChordSymbolTextSchema,
  /** `null` for instrumental / time-only chords that have no lyric position. */
  anchor: ChordAnchorSchema.nullable(),
});
export type ChordEvent = z.infer<typeof ChordEventSchema>;

export const ChartLineSchema = z.strictObject({
  id: OpaqueIdSchema,
  /** Canonical lyric text (single source of truth). Empty for chord-only lines. */
  text: z.string().max(MAX_LINE_TEXT_LENGTH),
  chords: z.array(ChordEventSchema).max(MAX_CHORDS_PER_LINE),
});
export type ChartLine = z.infer<typeof ChartLineSchema>;

export const ChartSectionSchema = z.strictObject({
  id: OpaqueIdSchema,
  kind: SectionKindSchema,
  /** Optional display label, e.g. "副歌 2" or "Verse 1". */
  label: z.string().min(1).max(80).optional(),
  lines: z.array(ChartLineSchema).max(MAX_LINES_PER_SECTION),
});
export type ChartSection = z.infer<typeof ChartSectionSchema>;

export const InstrumentSchema = z.strictObject({
  type: z.literal('guitar'),
  /** Open-string pitches, lowest string first. Standard: E2 A2 D3 G3 B3 E4. */
  tuning: z.tuple([
    PitchNameSchema,
    PitchNameSchema,
    PitchNameSchema,
    PitchNameSchema,
    PitchNameSchema,
    PitchNameSchema,
  ]),
});
export type Instrument = z.infer<typeof InstrumentSchema>;

export const VOICING_POLICY_MODES = ['recommended', 'explicit'] as const;

export const VoicingPolicySchema = z.strictObject({
  /** `recommended`: ranked suggestions; `explicit`: use only listed voicings, fall back to recommended. */
  mode: z.enum(VOICING_POLICY_MODES),
  defaultDifficulty: DifficultySchema,
  /** Arrangement-level default voicing per chord symbol (ArrangementVoicingPreference). */
  symbolDefaults: z.record(ChordSymbolTextSchema, OpaqueIdSchema).optional(),
  /** Chord occurrence id → voicing id, for a specific chorus/line. */
  occurrenceOverrides: z.record(OpaqueIdSchema, OpaqueIdSchema),
});
export type VoicingPolicy = z.infer<typeof VoicingPolicySchema>;

export const IMPORT_FORMATS = ['native', 'chordpro', 'ai_draft'] as const;

export const UnhandledDirectiveSchema = z.strictObject({
  /** 1-based line number in the imported source. */
  line: z.int().min(1),
  name: z.string().min(1).max(64),
  value: z.string().max(MAX_LINE_TEXT_LENGTH).nullable(),
});
export type UnhandledDirective = z.infer<typeof UnhandledDirectiveSchema>;

export const ImportMetadataSchema = z.strictObject({
  format: z.enum(IMPORT_FORMATS),
  unhandledDirectives: z.array(UnhandledDirectiveSchema).max(500),
});
export type ImportMetadata = z.infer<typeof ImportMetadataSchema>;

export const ChartDocumentSchema = z.strictObject({
  schemaVersion: SemVerSchema,
  chartRevisionId: OpaqueIdSchema,
  arrangementId: OpaqueIdSchema,
  revision: z.int().min(1),
  language: LanguageTagSchema,
  title: z.string().min(1).max(200),
  /** Sounding (concert) key, or `null` when unknown — numbering modes then show "unavailable". */
  concertKey: KeyNameSchema.nullable(),
  timeSignature: TimeSignatureSchema.nullable(),
  defaultBpm: z.number().min(20).max(400).nullable(),
  instrument: InstrumentSchema,
  sections: z.array(ChartSectionSchema).min(1).max(MAX_SECTIONS),
  voicingPolicy: VoicingPolicySchema,
  importMetadata: ImportMetadataSchema,
  extensions: ExtensionsSchema.optional(),
});
export type ChartDocument = z.infer<typeof ChartDocumentSchema>;

function majorOf(version: string): number {
  return Number(version.split('.')[0]);
}

function checkText(text: string, path: (string | number)[], issues: ValidationIssue[]): void {
  if (!isNfc(text)) {
    issues.push({ code: 'TEXT_NOT_NFC', path, message: 'text must be Unicode NFC normalized' });
  }
  if (hasControlCharacters(text)) {
    issues.push({
      code: 'INVALID_TEXT_CHARACTER',
      path,
      message: 'text must not contain control characters (use separate lines for line breaks)',
    });
  }
}

/** Cross-field invariants that a structural (JSON Schema) check cannot express. */
export function checkChartDocumentSemantics(doc: ChartDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (majorOf(doc.schemaVersion) !== SUPPORTED_CHART_MAJOR) {
    issues.push({
      code: 'UNSUPPORTED_SCHEMA_VERSION',
      path: ['schemaVersion'],
      message: `unsupported chart schema major version (supported: ${SUPPORTED_CHART_MAJOR}.x.y)`,
    });
    return issues;
  }

  checkText(doc.title, ['title'], issues);
  doc.sections.forEach((section, s) => {
    if (section.label !== undefined) {
      checkText(section.label, ['sections', s, 'label'], issues);
    }
  });

  // Section, line and chord ids share one namespace so any id resolves unambiguously.
  const seen = new Map<string, string>();
  const claim = (id: string, path: (string | number)[]) => {
    const previous = seen.get(id);
    if (previous !== undefined) {
      issues.push({
        code: 'DUPLICATE_ID',
        path,
        message: `id "${id}" already used at ${previous}`,
      });
    } else {
      seen.set(id, path.join('.'));
    }
  };

  const chordIds = new Set<string>();
  doc.sections.forEach((section, s) => {
    claim(section.id, ['sections', s, 'id']);
    section.lines.forEach((line, l) => {
      const linePath = ['sections', s, 'lines', l];
      claim(line.id, [...linePath, 'id']);
      checkText(line.text, [...linePath, 'text'], issues);
      const length = countGraphemes(line.text);
      line.chords.forEach((chord, c) => {
        const chordPath = [...linePath, 'chords', c];
        claim(chord.id, [...chordPath, 'id']);
        chordIds.add(chord.id);
        if (chord.anchor !== null && chord.anchor.graphemeOffset > length) {
          issues.push({
            code: 'ANCHOR_OUT_OF_BOUNDS',
            path: [...chordPath, 'anchor', 'graphemeOffset'],
            message: `offset ${chord.anchor.graphemeOffset} exceeds line length ${length} graphemes`,
          });
        }
      });
    });
  });

  for (const occurrenceId of Object.keys(doc.voicingPolicy.occurrenceOverrides)) {
    if (!chordIds.has(occurrenceId)) {
      issues.push({
        code: 'UNKNOWN_REFERENCE',
        path: ['voicingPolicy', 'occurrenceOverrides', occurrenceId],
        message: `override references unknown chord occurrence "${occurrenceId}"`,
      });
    }
  }

  return issues;
}

export function validateChartDocument(input: unknown): ValidationResult<ChartDocument> {
  const parsed = ChartDocumentSchema.safeParse(input);
  if (!parsed.success) {
    return failure(fromZodError(parsed.error));
  }
  const issues = checkChartDocumentSemantics(parsed.data);
  return issues.length > 0 ? failure(issues) : success(parsed.data);
}

export function parseChartDocument(input: unknown): ChartDocument {
  const result = validateChartDocument(input);
  if (!result.ok) {
    throw new ContractValidationError('Chart document', result.issues);
  }
  return result.value;
}

/** Flat lookup of every chord occurrence with its line, in document order. */
export function listChordOccurrences(
  doc: ChartDocument,
): { sectionId: string; line: ChartLine; chord: ChordEvent }[] {
  return doc.sections.flatMap((section) =>
    section.lines.flatMap((line) =>
      line.chords.map((chord) => ({ sectionId: section.id, line, chord })),
    ),
  );
}
