import type { ChartLine } from '@chordflow/chart-schema';
import { describe, expect, it } from 'vitest';
import { layoutLine, splitTrailingFragment } from './line-layout';

function line(text: string, chords: [string, number | null][]): ChartLine {
  return {
    id: 'l1',
    text,
    chords: chords.map(([id, offset]) => ({
      id,
      symbol: 'C',
      anchor: offset === null ? null : { graphemeOffset: offset },
    })),
  };
}

function units(text: string, chords: [string, number | null][]) {
  const result = layoutLine(line(text, chords));
  if (result.kind !== 'lyrics') throw new Error(`expected lyrics, got ${result.kind}`);
  return result.units;
}

describe('splitTrailingFragment', () => {
  it.each<[string, string, string]>([
    ['How swe', 'How ', 'swe'],
    ['swe', '', 'swe'],
    ['go ', 'go ', ''],
    ['微風', '微風', ''],
    ["we're", '', "we're"],
  ])('%j → body %j, fragment %j', (text, body, fragment) => {
    expect(splitTrailingFragment(text)).toEqual({ body, fragment });
  });
});

describe('layoutLine', () => {
  it('classifies blank and chord-only lines', () => {
    expect(layoutLine(line('', []))).toEqual({ kind: 'blank', lineId: 'l1' });
    expect(
      layoutLine(
        line('', [
          ['a', null],
          ['b', null],
        ]),
      ),
    ).toEqual({
      kind: 'chords-only',
      lineId: 'l1',
      chordIds: ['a', 'b'],
    });
  });

  it('keeps whole Chinese segments under their chords (no glue between CJK)', () => {
    expect(
      units('微風帶我向前走', [
        ['c1', 0],
        ['c2', 4],
      ]),
    ).toEqual([
      { kind: 'chord', key: 'c1', chordId: 'c1', text: '微風帶我' },
      { kind: 'chord', key: 'c2', chordId: 'c2', text: '向前走' },
    ]);
  });

  it('keeps leading text without a chord as plain wrappable text', () => {
    expect(units('We go', [['c1', 3]])).toEqual([
      { kind: 'text', key: 'lead', text: 'We ' },
      { kind: 'chord', key: 'c1', chordId: 'c1', text: 'go' },
    ]);
  });

  it('glues only the word fragment when a chord splits a word', () => {
    expect(
      units('How sweet the', [
        ['c1', 0],
        ['c2', 7],
      ]),
    ).toEqual([
      { kind: 'chord', key: 'c1', chordId: 'c1', text: 'How ' },
      {
        kind: 'glue',
        key: 'g1',
        items: [
          { kind: 'text', key: 'c1-frag', text: 'swe' },
          { kind: 'chord', key: 'c2', chordId: 'c2', text: 'et the' },
        ],
      },
    ]);
  });

  it('glues consecutive mid-word chords and leading fragments', () => {
    expect(
      units('a sbcd', [
        ['c1', 3],
        ['c2', 4],
      ]),
    ).toEqual([
      { kind: 'text', key: 'lead', text: 'a ' },
      {
        kind: 'glue',
        key: 'g1',
        items: [
          { kind: 'text', key: 'lead-frag', text: 's' },
          { kind: 'chord', key: 'c1', chordId: 'c1', text: 'b' },
          { kind: 'chord', key: 'c2', chordId: 'c2', text: 'cd' },
        ],
      },
    ]);
  });

  it('keeps chords stacked at one offset in authored order', () => {
    expect(
      units('ab', [
        ['c2', 0],
        ['c1', 0],
      ]).map((u) => u.kind === 'chord' && [u.chordId, u.text]),
    ).toEqual([
      ['c2', ''],
      ['c1', 'ab'],
    ]);
  });

  it('supports a trailing chord after the last character', () => {
    expect(units('走', [['c1', 1]])).toEqual([
      { kind: 'text', key: 'lead', text: '走' },
      { kind: 'chord', key: 'c1', chordId: 'c1', text: '' },
    ]);
  });

  it('reports unanchored chords on a lyric line separately', () => {
    const result = layoutLine(
      line('走', [
        ['free', null],
        ['c1', 0],
      ]),
    );
    expect(result.kind === 'lyrics' && result.leadingChordIds).toEqual(['free']);
  });
});
