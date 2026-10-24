import {
  CHART_DOCUMENT_SCHEMA_VERSION,
  MAX_LINE_TEXT_LENGTH,
  SECTION_KINDS,
  validateChartDocument,
  type ChartDocument,
  type ChartLine,
  type ChartSection,
  type SectionKind,
  type UnhandledDirective,
} from '@chordflow/chart-schema';
import {
  formatChord,
  formatKey,
  parseChord,
  parseKey,
  transposeChord,
  transposeKey,
  type KeyContext,
} from '@chordflow/music-theory';
import { parseLyricLine } from './lyric-line';

/*
 * Bounded ChordPro importer (SPEC §6). Produces a validated Chart Document
 * preview plus raw song metadata; it never persists anything itself.
 * See docs/chordpro.md for the supported subset.
 */

export const MAX_INPUT_LENGTH = 200_000;
export const MAX_INPUT_LINES = 5_000;

export type ImportIssueCode =
  | 'INPUT_TOO_LARGE'
  | 'EMPTY_DOCUMENT'
  | 'TITLE_MISSING'
  | 'MALFORMED_DIRECTIVE'
  | 'UNKNOWN_DIRECTIVE'
  | 'DUPLICATE_DIRECTIVE'
  | 'UNSUPPORTED_ENVIRONMENT'
  | 'SECTION_NOT_CLOSED'
  | 'SECTION_MISMATCH'
  | 'NESTED_SECTION'
  | 'INVALID_KEY'
  | 'INVALID_TEMPO'
  | 'INVALID_TIME'
  | 'INVALID_CAPO'
  | 'CAPO_INTERPRETATION_REQUIRED'
  | 'UNSUPPORTED_CHORD'
  | 'LINE_TOO_LONG'
  | 'BAD_ESCAPE'
  | 'MALFORMED_CHORD'
  | 'UNSUPPORTED_ANNOTATION'
  | 'UNEXPECTED_BRACKET'
  | 'UNEXPECTED_BRACE'
  | 'CHORD_INSIDE_GRAPHEME'
  | 'DOCUMENT_INVALID';

export interface ImportIssue {
  severity: 'error' | 'warning';
  code: ImportIssueCode;
  /** 1-based source line; 0 for whole-document issues. */
  line: number;
  column: number | null;
  message: string;
}

export interface ChordProMetadata {
  title: string | null;
  subtitles: string[];
  artists: string[];
  key: string | null;
  capo: number | null;
  tempo: number | null;
  time: string | null;
}

export interface ImportOptions {
  chartRevisionId: string;
  arrangementId: string;
  revision?: number;
  language?: string;
  /** Used when the source has no `{title}`. */
  defaultTitle?: string;
  /**
   * Required when the source declares `{capo: n}` with n > 0:
   * `concert` — chords (and `{key}`) are already the sounding chords;
   * `capo_shapes` — chords (and `{key}`) are capo shapes and are moved up by n.
   */
  chordsWrittenAs?: 'concert' | 'capo_shapes';
}

export type ImportResult =
  | { ok: true; document: ChartDocument; metadata: ChordProMetadata; issues: ImportIssue[] }
  | { ok: false; document: null; metadata: ChordProMetadata | null; issues: ImportIssue[] };

const DIRECTIVE_ALIASES: Readonly<Record<string, string>> = {
  t: 'title',
  st: 'subtitle',
  sov: 'start_of_verse',
  eov: 'end_of_verse',
  soc: 'start_of_chorus',
  eoc: 'end_of_chorus',
  sob: 'start_of_bridge',
  eob: 'end_of_bridge',
};

/** ChordPro environments whose content is not lyrics; importing them would corrupt text. */
const UNSUPPORTED_ENVIRONMENTS = new Set(['tab', 'grid', 'abc', 'ly', 'svg', 'textblock']);

const META_ONCE = new Set(['title', 'key', 'capo', 'tempo', 'time']);

interface DraftLine {
  sourceLine: number;
  text: string;
  chords: { symbol: string; offset: number | null }[];
}

interface DraftSection {
  kind: SectionKind;
  label: string | null;
  explicit: boolean;
  startLine: number;
  lines: DraftLine[];
}

function normalizeInput(source: string): string[] {
  return source
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[\t ]+$/u, ''));
}

function trimBlankEdges(lines: DraftLine[]): DraftLine[] {
  let start = 0;
  let end = lines.length;
  const blank = (l: DraftLine | undefined) => l?.text === '' && l.chords.length === 0;
  while (start < end && blank(lines[start])) start += 1;
  while (end > start && blank(lines[end - 1])) end -= 1;
  return lines.slice(start, end);
}

export function importChordPro(source: string, options: ImportOptions): ImportResult {
  const issues: ImportIssue[] = [];
  const error = (
    code: ImportIssueCode,
    line: number,
    message: string,
    column: number | null = null,
  ) => issues.push({ severity: 'error', code, line, column, message });
  const warn = (
    code: ImportIssueCode,
    line: number,
    message: string,
    column: number | null = null,
  ) => issues.push({ severity: 'warning', code, line, column, message });

  if (source.length > MAX_INPUT_LENGTH) {
    error('INPUT_TOO_LARGE', 0, `input exceeds ${MAX_INPUT_LENGTH} characters`);
    return { ok: false, document: null, metadata: null, issues };
  }
  const rawLines = normalizeInput(source);
  if (rawLines.length > MAX_INPUT_LINES) {
    error('INPUT_TOO_LARGE', 0, `input exceeds ${MAX_INPUT_LINES} lines`);
    return { ok: false, document: null, metadata: null, issues };
  }

  const metadata: ChordProMetadata = {
    title: null,
    subtitles: [],
    artists: [],
    key: null,
    capo: null,
    tempo: null,
    time: null,
  };
  const seenMeta = new Set<string>();
  const unhandled: UnhandledDirective[] = [];
  const sections: DraftSection[] = [];
  // Mutable parse state lives in one object so closures see current values.
  const state: { current: DraftSection | null; implicit: DraftSection | null } = {
    current: null,
    implicit: null,
  };

  const target = (lineNo: number): DraftSection => {
    if (state.current) return state.current;
    if (!state.implicit) {
      state.implicit = {
        kind: 'other',
        label: null,
        explicit: false,
        startLine: lineNo,
        lines: [],
      };
      sections.push(state.implicit);
    }
    return state.implicit;
  };

  rawLines.forEach((raw, index) => {
    const lineNo = index + 1;
    if (raw.startsWith('#')) return; // ChordPro comment line

    const trimmed = raw.trim();
    if (trimmed.startsWith('{')) {
      if (
        !trimmed.endsWith('}') ||
        trimmed.slice(1).includes('{') ||
        trimmed.indexOf('}') !== trimmed.length - 1
      ) {
        error(
          'MALFORMED_DIRECTIVE',
          lineNo,
          'a directive must be one {name} or {name: value} per line',
        );
        return;
      }
      const inner = trimmed.slice(1, -1);
      const colon = inner.indexOf(':');
      const rawName = (colon === -1 ? inner : inner.slice(0, colon)).trim();
      const value = colon === -1 ? null : inner.slice(colon + 1).trim();
      if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(rawName)) {
        error('MALFORMED_DIRECTIVE', lineNo, `invalid directive name "${rawName}"`);
        return;
      }
      const lower = rawName.toLowerCase();
      const name = DIRECTIVE_ALIASES[lower] ?? lower;

      if (META_ONCE.has(name)) {
        if (seenMeta.has(name)) {
          error('DUPLICATE_DIRECTIVE', lineNo, `{${name}} given more than once`);
          return;
        }
        seenMeta.add(name);
      }

      const env = /^(start|end)_of_(.+)$/.exec(name);
      if (env) {
        const [, edge, kindName = ''] = env;
        if (UNSUPPORTED_ENVIRONMENTS.has(kindName)) {
          error(
            'UNSUPPORTED_ENVIRONMENT',
            lineNo,
            `{${name}} content is not lyrics and is not supported`,
          );
          return;
        }
        if (!(SECTION_KINDS as readonly string[]).includes(kindName)) {
          error('UNSUPPORTED_ENVIRONMENT', lineNo, `unknown section environment "${kindName}"`);
          return;
        }
        const kind = kindName as SectionKind;
        if (edge === 'start') {
          if (state.current) {
            error(
              'NESTED_SECTION',
              lineNo,
              `{${name}} inside an open ${state.current.kind} section`,
            );
            return;
          }
          state.current = {
            kind,
            label: value === null || value === '' ? null : value.normalize('NFC'),
            explicit: true,
            startLine: lineNo,
            lines: [],
          };
          sections.push(state.current);
          state.implicit = null;
        } else {
          if (state.current?.kind !== kind) {
            error('SECTION_MISMATCH', lineNo, `{${name}} does not close the open section`);
            return;
          }
          state.current = null;
        }
        return;
      }

      switch (name) {
        case 'title':
          metadata.title = value?.normalize('NFC') ?? null;
          return;
        case 'subtitle':
          if (value) metadata.subtitles.push(value.normalize('NFC'));
          return;
        case 'artist':
          if (value) metadata.artists.push(value.normalize('NFC'));
          return;
        case 'key': {
          const key = value === null ? null : parseKey(value);
          if (key === null) error('INVALID_KEY', lineNo, `unsupported key "${value ?? ''}"`);
          else metadata.key = formatKey(key);
          return;
        }
        case 'capo': {
          const capo = value !== null && /^\d{1,2}$/.test(value) ? Number(value) : Number.NaN;
          if (!(capo >= 0 && capo <= 12)) error('INVALID_CAPO', lineNo, 'capo must be 0–12');
          else metadata.capo = capo;
          return;
        }
        case 'tempo': {
          const tempo =
            value !== null && /^\d{2,3}(\.\d+)?$/.test(value) ? Number(value) : Number.NaN;
          if (!(tempo >= 20 && tempo <= 400))
            error('INVALID_TEMPO', lineNo, 'tempo must be 20–400 BPM');
          else metadata.tempo = tempo;
          return;
        }
        case 'time':
          if (value === null || !/^([1-9]|[1-3]\d)\/(1|2|4|8|16|32)$/.test(value)) {
            error('INVALID_TIME', lineNo, `unsupported time signature "${value ?? ''}"`);
          } else {
            metadata.time = value;
          }
          return;
        default:
          unhandled.push({ line: lineNo, name: rawName, value });
          warn(
            'UNKNOWN_DIRECTIVE',
            lineNo,
            `{${rawName}} is not supported and was preserved as metadata`,
          );
          return;
      }
    }

    // Lyric / chord line (or blank line).
    if (raw.length > MAX_LINE_TEXT_LENGTH) {
      error('LINE_TOO_LONG', lineNo, `line exceeds ${MAX_LINE_TEXT_LENGTH} characters`);
      return;
    }
    const parsed = parseLyricLine(raw);
    if (!parsed.ok) {
      for (const e of parsed.errors) error(e.code, lineNo, e.message, e.column);
      return;
    }
    const chordOnly = parsed.line.text.trim() === '';
    const draft: DraftLine = {
      sourceLine: lineNo,
      text: chordOnly ? '' : parsed.line.text,
      chords: parsed.line.chords.map((c) => ({
        symbol: c.symbol,
        offset: chordOnly ? null : c.offset,
      })),
    };
    for (const chord of draft.chords) {
      const result = parseChord(chord.symbol);
      if (!result.ok) {
        warn(
          'UNSUPPORTED_CHORD',
          lineNo,
          `chord "${chord.symbol}" is kept as written (${result.error.code})`,
        );
      }
    }
    if (draft.text === '' && draft.chords.length === 0 && !state.current && !state.implicit) return;
    target(lineNo).lines.push(draft);
  });

  if (state.current !== null) {
    error(
      'SECTION_NOT_CLOSED',
      state.current.startLine,
      `${state.current.kind} section is never closed`,
    );
  }

  // Capo interpretation.
  let shiftUp = 0;
  if (metadata.capo !== null && metadata.capo > 0) {
    if (options.chordsWrittenAs === undefined) {
      error(
        'CAPO_INTERPRETATION_REQUIRED',
        0,
        'source declares a capo: choose whether chords are concert chords or capo shapes',
      );
    } else if (options.chordsWrittenAs === 'capo_shapes') {
      shiftUp = metadata.capo;
    }
  }

  const usable = sections
    .map((s) => ({ ...s, lines: trimBlankEdges(s.lines) }))
    .filter((s) => s.explicit || s.lines.length > 0);
  // Only reported when nothing else failed: rejected lines would otherwise look like "empty".
  if (usable.length === 0 && !issues.some((i) => i.severity === 'error')) {
    error('EMPTY_DOCUMENT', 0, 'no lyrics, chords or sections found');
  }

  const title = metadata.title ?? options.defaultTitle ?? null;
  if (title === null || title === '') error('TITLE_MISSING', 0, 'no {title} and no default title');

  if (issues.some((i) => i.severity === 'error')) {
    return { ok: false, document: null, metadata, issues };
  }

  const shapeKey: KeyContext | null = metadata.key === null ? null : parseKey(metadata.key);
  const concertKey =
    shapeKey === null ? null : shiftUp === 0 ? shapeKey : transposeKey(shapeKey, shiftUp).key;
  const shift = (symbol: string): string => {
    if (shiftUp === 0) return symbol;
    const parsed = parseChord(symbol);
    return parsed.ok
      ? formatChord(transposeChord(parsed.chord, shiftUp, { key: shapeKey }))
      : symbol;
  };
  if (shiftUp > 0) {
    for (const s of usable) {
      for (const l of s.lines) {
        for (const c of l.chords) {
          if (!parseChord(c.symbol).ok) {
            warn(
              'UNSUPPORTED_CHORD',
              l.sourceLine,
              `chord "${c.symbol}" could not be moved by the capo and is kept as written`,
            );
          }
        }
      }
    }
  }

  const chartSections: ChartSection[] = usable.map((s, si) => {
    const sectionId = `s${si + 1}`;
    const lines: ChartLine[] = s.lines.map((l, li) => {
      const lineId = `${sectionId}_l${li + 1}`;
      return {
        id: lineId,
        text: l.text,
        chords: l.chords.map((c, ci) => ({
          id: `${lineId}_c${ci + 1}`,
          symbol: shift(c.symbol),
          anchor: c.offset === null ? null : { graphemeOffset: c.offset },
        })),
      };
    });
    return { id: sectionId, kind: s.kind, ...(s.label === null ? {} : { label: s.label }), lines };
  });

  const candidate: ChartDocument = {
    schemaVersion: CHART_DOCUMENT_SCHEMA_VERSION,
    chartRevisionId: options.chartRevisionId,
    arrangementId: options.arrangementId,
    revision: options.revision ?? 1,
    language: options.language ?? 'zh-TW',
    title: (title ?? '').normalize('NFC'),
    concertKey: concertKey === null ? null : formatKey(concertKey),
    timeSignature: metadata.time,
    defaultBpm: metadata.tempo,
    instrument: { type: 'guitar', tuning: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'] },
    sections: chartSections,
    voicingPolicy: { mode: 'recommended', defaultDifficulty: 'easy', occurrenceOverrides: {} },
    importMetadata: { format: 'chordpro', unhandledDirectives: unhandled },
  };

  const validated = validateChartDocument(candidate);
  if (!validated.ok) {
    for (const issue of validated.issues) {
      error('DOCUMENT_INVALID', 0, `${issue.code} at ${issue.path.join('.')}: ${issue.message}`);
    }
    return { ok: false, document: null, metadata, issues };
  }
  return { ok: true, document: validated.value, metadata, issues };
}
