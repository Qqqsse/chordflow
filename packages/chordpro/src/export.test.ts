import { describe, expect, it } from 'vitest';
import { exportChordPro } from './export';
import { importChordPro } from './import';
import { readChart, readText, semantic } from './testing';

const CHARTS = [
  'charts/demo-basic.chart.json',
  'charts/demo-english.chart.json',
  'charts/demo-full-zh.chart.json',
  'charts/pd-songbie.chart.json',
  'charts/pd-amazing-grace.chart.json',
];

const OPTIONS = { chartRevisionId: 'rev_rt', arrangementId: 'arr_rt' };

describe('exportChordPro', () => {
  it.each(CHARTS)('%s survives export → import semantically', (path) => {
    const chart = readChart(path);
    const { text } = exportChordPro(chart);
    const back = importChordPro(text, { ...OPTIONS, language: chart.language });
    expect(back.issues.filter((i) => i.severity === 'error')).toEqual([]);
    if (!back.ok) return;
    expect(semantic(back.document)).toEqual(semantic(chart));
  });

  it('matches the golden ChordPro for 送別', () => {
    expect(
      exportChordPro(readChart('charts/pd-songbie.chart.json'), { artists: ['李叔同'] }).text,
    ).toBe(readText('chordpro/pd-songbie.golden.cho'));
  });

  it('export is stable: import → export → import → export', () => {
    const first = importChordPro(readText('chordpro/handwritten-songbie.cho'), OPTIONS);
    if (!first.ok) throw new Error('fixture import failed');
    const text1 = exportChordPro(first.document).text;
    const second = importChordPro(text1, OPTIONS);
    if (!second.ok) throw new Error('re-import failed');
    expect(exportChordPro(second.document).text).toBe(text1);
  });

  it('escapes lyric characters that ChordPro would interpret', () => {
    const chart = readChart('charts/demo-basic.chart.json');
    const line = chart.sections[1]?.lines[0];
    if (!line) throw new Error('fixture changed');
    line.text = '#1 [a] {b} c\\d';
    line.chords = [{ id: 'x1', symbol: 'C', anchor: { graphemeOffset: 0 } }];
    const { text } = exportChordPro(chart);
    expect(text).toContain('[C]#1 \\[a\\] \\{b\\} c\\\\d');
    const back = importChordPro(text, OPTIONS);
    expect(back.ok && back.document.sections[1]?.lines[0]?.text).toBe('#1 [a] {b} c\\d');
  });

  it('escapes a leading # that would otherwise become a comment', () => {
    const chart = readChart('charts/demo-basic.chart.json');
    const line = chart.sections[1]?.lines[0];
    if (!line) throw new Error('fixture changed');
    line.text = '#hashtag';
    line.chords = [];
    expect(exportChordPro(chart).text).toContain('\n\\#hashtag\n');
  });

  it('never writes a capo and warns when unanchored chords must move', () => {
    const chart = readChart('charts/demo-basic.chart.json');
    const line = chart.sections[1]?.lines[0];
    if (!line) throw new Error('fixture changed');
    line.chords.push({ id: 'free', symbol: 'F', anchor: null });
    const result = exportChordPro(chart);
    expect(result.text).not.toContain('{capo');
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: 'UNANCHORED_CHORDS_MOVED', lineId: 'line_verse_1' }),
    ]);
  });
});
