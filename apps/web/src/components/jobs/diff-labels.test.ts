import { diffCharts, type DiffableChart } from '@chordflow/chart-schema';
import { describe, expect, it } from 'vitest';
import { describeChange } from './diff-labels';

const base: DiffableChart = {
  title: '晨光小路',
  language: 'zh-TW',
  concertKey: 'C',
  timeSignature: null,
  defaultBpm: null,
  sections: [
    {
      id: 's1',
      kind: 'verse',
      lines: [
        {
          id: 'l1',
          text: '清晨的風吹過小路',
          chords: [
            { id: 'c1', symbol: 'C', anchor: { graphemeOffset: 0 } },
            { id: 'c2', symbol: 'D', anchor: { graphemeOffset: 4 } },
          ],
        },
      ],
    },
  ],
};

describe('review diff labels', () => {
  it('describes chord, lyric and metadata changes in zh-TW', () => {
    const after: DiffableChart = {
      ...base,
      concertKey: 'D',
      sections: [
        {
          id: 's1',
          kind: 'verse',
          lines: [
            {
              id: 'l1',
              text: '清晨的風吹過小路',
              chords: [
                { id: 'c1', symbol: 'C', anchor: { graphemeOffset: 0 } },
                { id: 'c2', symbol: 'Dm', anchor: { graphemeOffset: 4 } },
              ],
            },
          ],
        },
      ],
    };
    const text = diffCharts(base, after).map((c) => describeChange(c, base, after));
    expect(text).toEqual(['調性：C → D', '主歌 第 1 行：D → Dm（「吹」前）']);
  });

  it('describes moved chords and added lines', () => {
    const after: DiffableChart = {
      ...base,
      sections: [
        {
          id: 's1',
          kind: 'verse',
          lines: [
            {
              id: 'l1',
              text: '清晨的風吹過小路',
              chords: [
                { id: 'c1', symbol: 'C', anchor: { graphemeOffset: 0 } },
                { id: 'c2', symbol: 'D', anchor: { graphemeOffset: 6 } },
              ],
            },
            { id: 'l2', text: '新的一行', chords: [] },
          ],
        },
      ],
    };
    expect(diffCharts(base, after).map((c) => describeChange(c, base, after))).toEqual([
      '主歌 第 1 行：D 從「吹」前移到「小」前',
      '主歌 第 2 行：新增歌詞「新的一行」',
    ]);
  });
});
