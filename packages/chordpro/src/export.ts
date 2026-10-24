import type { ChartDocument, ChartLine, ChartSection } from '@chordflow/chart-schema';
import { renderLyricLine } from './lyric-line';

/*
 * ChordPro exporter (SPEC §6). Writes readable ChordPro with explicit section
 * markers. Deliberately lossy — see `EXPORT_LOSSES` and docs/chordpro.md.
 */

export const EXPORT_LOSSES = [
  'chart, arrangement and occurrence ids (regenerated on import)',
  'voicingPolicy (default difficulty, symbol defaults, occurrence overrides)',
  'extensions and importMetadata (including previously unhandled directives)',
  'instrument tuning',
  'RecordingSync timing, AI provenance and per-player viewer settings (never part of the chart)',
] as const;

export interface ExportOptions {
  /** Song metadata that lives in the catalog rather than the chart document. */
  artists?: readonly string[];
  subtitles?: readonly string[];
}

export interface ExportWarning {
  code: 'UNANCHORED_CHORDS_MOVED';
  lineId: string;
  message: string;
}

export interface ExportResult {
  text: string;
  warnings: ExportWarning[];
}

function directiveValue(value: string): string {
  // Directive values end at the closing brace; braces inside cannot be represented.
  return value.replace(/[{}]/g, '');
}

function renderLine(line: ChartLine, warnings: ExportWarning[]): string {
  const anchored = line.chords.filter((c) => c.anchor !== null);
  const unanchored = line.chords.filter((c) => c.anchor === null);
  if (line.text === '' && anchored.length === 0) {
    return unanchored.map((c) => `[${c.symbol}]`).join(' ');
  }
  if (unanchored.length > 0) {
    warnings.push({
      code: 'UNANCHORED_CHORDS_MOVED',
      lineId: line.id,
      message: 'chords without a lyric position were written at the start of the line',
    });
  }
  const marks = [
    ...unanchored.map((c) => ({ symbol: c.symbol, offset: 0 })),
    ...anchored.map((c) => ({ symbol: c.symbol, offset: c.anchor?.graphemeOffset ?? 0 })),
  ];
  return line.text === '' && marks.length === 0 ? '' : renderLyricLine(line.text, marks);
}

function renderSection(section: ChartSection, warnings: ExportWarning[]): string[] {
  const label = section.label === undefined ? '' : `: ${directiveValue(section.label)}`;
  return [
    `{start_of_${section.kind}${label}}`,
    ...section.lines.map((line) => renderLine(line, warnings)),
    `{end_of_${section.kind}}`,
  ];
}

export function exportChordPro(doc: ChartDocument, options: ExportOptions = {}): ExportResult {
  const warnings: ExportWarning[] = [];
  const header = [`{title: ${directiveValue(doc.title)}}`];
  for (const subtitle of options.subtitles ?? [])
    header.push(`{subtitle: ${directiveValue(subtitle)}}`);
  for (const artist of options.artists ?? []) header.push(`{artist: ${directiveValue(artist)}}`);
  if (doc.concertKey !== null) header.push(`{key: ${doc.concertKey}}`);
  if (doc.timeSignature !== null) header.push(`{time: ${doc.timeSignature}}`);
  if (doc.defaultBpm !== null) header.push(`{tempo: ${doc.defaultBpm}}`);

  const body = doc.sections.flatMap((section, index) => [
    ...(index === 0 ? [] : ['']),
    ...renderSection(section, warnings),
  ]);
  return { text: `${[...header, '', ...body].join('\n')}\n`, warnings };
}
