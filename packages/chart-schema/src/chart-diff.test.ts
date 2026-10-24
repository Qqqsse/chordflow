import { describe, expect, it } from 'vitest';
import { diffCharts, type DiffableChart } from './chart-diff';

const chart = (sections: DiffableChart['sections'], extra: Partial<DiffableChart> = {}) => ({
  title: '晨光小路',
  concertKey: 'C',
  timeSignature: null,
  defaultBpm: null,
  language: 'zh-TW',
  sections,
  ...extra,
});

const verse = (id: string, lines: DiffableChart['sections'][number]['lines']) => ({
  id,
  kind: 'verse' as const,
  lines,
});
const line = (id: string, text: string, chords: [string, string, number | null][]) => ({
  id,
  text,
  chords: chords.map(([cid, symbol, offset]) => ({
    id: cid,
    symbol,
    anchor: offset === null ? null : { graphemeOffset: offset },
  })),
});

describe('diffCharts', () => {
  it('reports nothing for identical charts', () => {
    const a = chart([verse('s1', [line('l1', '清晨的風', [['c1', 'C', 0]])])]);
    expect(diffCharts(a, structuredClone(a))).toEqual([]);
  });

  it('detects changed, moved, added and removed chords on a line', () => {
    const before = chart([
      verse('s1', [
        line('l1', '清晨的風吹過小路', [
          ['c1', 'C', 0],
          ['c2', 'D', 4],
          ['c3', 'Am', 6],
        ]),
      ]),
    ]);
    const after = chart([
      verse('s1', [
        line('l1', '清晨的風吹過小路', [
          ['c1', 'C', 0],
          ['c2', 'Dm', 4],
          ['c4', 'G', 7],
        ]),
      ]),
    ]);
    expect(diffCharts(before, after)).toEqual([
      { kind: 'chord_changed', path: [0, 0], offset: 4, from: 'D', to: 'Dm' },
      { kind: 'chord_removed', path: [0, 0], offset: 6, symbol: 'Am' },
      { kind: 'chord_added', path: [0, 0], offset: 7, symbol: 'G' },
    ]);
  });

  it('treats the same chord at a new position as a move', () => {
    const before = chart([verse('s1', [line('l1', 'walk along the road', [['c1', 'G', 5]])])]);
    const after = chart([verse('s1', [line('l1', 'walk along the road', [['c1', 'G', 11]])])]);
    expect(diffCharts(before, after)).toEqual([
      { kind: 'chord_moved', path: [0, 0], symbol: 'G', fromOffset: 5, toOffset: 11 },
    ]);
  });

  it('aligns re-imported charts with fresh ids by content', () => {
    const before = chart([
      verse('sec_1', [
        line('line_1_1', '清晨的風', [['ch_1', 'C', 0]]),
        line('line_1_2', '陽光落下', [['ch_2', 'D', 0]]),
      ]),
    ]);
    // The same content after a ChordPro round trip, with every id regenerated and one edit.
    const after = chart([
      verse('x9', [
        line('y1', '清晨的風', [['z1', 'C', 0]]),
        line('y2', '陽光落下', [['z2', 'Dm', 0]]),
      ]),
    ]);
    expect(diffCharts(before, after)).toEqual([
      { kind: 'chord_changed', path: [0, 1], offset: 0, from: 'D', to: 'Dm' },
    ]);
  });

  it('detects inserted, removed and edited lyric lines', () => {
    const before = chart([
      verse('s1', [line('a', '第一行', []), line('b', '第二行', []), line('c', '第三行', [])]),
    ]);
    const after = chart([
      verse('s1', [
        line('a', '第一行', []),
        line('n', '新加的一行', []),
        line('c', '第三行（改）', []),
      ]),
    ]);
    expect(diffCharts(before, after)).toEqual([
      { kind: 'lyrics_changed', path: [0, 1], from: '第二行', to: '新加的一行' },
      { kind: 'lyrics_changed', path: [0, 2], from: '第三行', to: '第三行（改）' },
    ]);
    const shorter = chart([verse('s1', [line('a', '第一行', []), line('c', '第三行', [])])]);
    expect(diffCharts(before, shorter)).toEqual([
      { kind: 'line_removed', path: [0, 1], text: '第二行' },
    ]);
    expect(diffCharts(shorter, before)).toEqual([
      { kind: 'line_added', path: [0, 1], text: '第二行' },
    ]);
  });

  it('detects section changes and metadata changes', () => {
    const before = chart([verse('s1', [line('a', '主歌', [])])]);
    const after = chart(
      [
        verse('s1', [line('a', '主歌', [])]),
        { id: 's2', kind: 'chorus', lines: [line('b', '副歌', [['c', 'F', 0]])] },
      ],
      { concertKey: 'D', title: '晨光小路（校訂）' },
    );
    expect(diffCharts(before, after)).toEqual([
      { kind: 'metadata_changed', field: 'title', from: '晨光小路', to: '晨光小路（校訂）' },
      { kind: 'metadata_changed', field: 'concertKey', from: 'C', to: 'D' },
      { kind: 'section_added', path: [1], sectionKind: 'chorus', label: null, lines: 1 },
    ]);
    expect(diffCharts(after, before).map((c) => c.kind)).toEqual([
      'metadata_changed',
      'metadata_changed',
      'section_removed',
    ]);
  });

  it('compares unanchored (instrumental) chords in order', () => {
    const before = chart([
      {
        id: 'i',
        kind: 'intro',
        lines: [
          line('l', '', [
            ['a', 'C', null],
            ['b', 'G', null],
          ]),
        ],
      },
    ]);
    const after = chart([
      {
        id: 'i',
        kind: 'intro',
        lines: [
          line('l', '', [
            ['a', 'C', null],
            ['b', 'Em', null],
            ['c', 'F', null],
          ]),
        ],
      },
    ]);
    expect(diffCharts(before, after)).toEqual([
      { kind: 'chord_changed', path: [0, 0], offset: null, from: 'G', to: 'Em' },
      { kind: 'chord_added', path: [0, 0], offset: null, symbol: 'F' },
    ]);
  });
});
