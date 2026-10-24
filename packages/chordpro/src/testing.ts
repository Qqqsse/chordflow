import { readFileSync } from 'node:fs';
import type { ChartDocument } from '@chordflow/chart-schema';

/** Test-only helpers (not exported from the package). */
const FIXTURES = new URL('../../../fixtures/', import.meta.url);

export function readText(path: string): string {
  return readFileSync(new URL(path, FIXTURES), 'utf8');
}

export function readChart(path: string): ChartDocument {
  return JSON.parse(readText(path)) as ChartDocument;
}

/** Structure that must survive a ChordPro round trip (ids, policy and metadata excluded). */
export function semantic(doc: ChartDocument) {
  return {
    title: doc.title,
    concertKey: doc.concertKey,
    timeSignature: doc.timeSignature,
    defaultBpm: doc.defaultBpm,
    sections: doc.sections.map((s) => ({
      kind: s.kind,
      label: s.label ?? null,
      lines: s.lines.map((l) => ({
        text: l.text,
        chords: l.chords.map((c) => ({ symbol: c.symbol, anchor: c.anchor })),
      })),
    })),
  };
}
