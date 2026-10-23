import { describe, expect, it } from 'vitest';
import { splitGraphemes } from '@chordflow/chart-schema';
import { AnchorOutOfBoundsError, segmentLine } from './line-segments';

const chord = (id: string, symbol: string, offset: number | null) => ({
  id,
  symbol,
  anchor: offset === null ? null : { graphemeOffset: offset },
});

describe('splitGraphemes', () => {
  it('counts emoji and combining marks as single graphemes', () => {
    expect(splitGraphemes('a👍🏽é')).toEqual(['a', '👍🏽', 'é']);
  });
});

describe('segmentLine', () => {
  it('anchors chords to Chinese graphemes', () => {
    const result = segmentLine('微風帶我向前走', [chord('c1', 'C', 0), chord('c2', 'G/B', 4)]);
    expect(result.segments).toEqual([
      { chordId: 'c1', chord: 'C', text: '微風帶我' },
      { chordId: 'c2', chord: 'G/B', text: '向前走' },
    ]);
  });

  it('keeps leading lyric text without a chord', () => {
    const result = segmentLine("Don't stop", [chord('c1', 'Am', 6)]);
    expect(result.segments).toEqual([
      { chordId: null, chord: null, text: "Don't " },
      { chordId: 'c1', chord: 'Am', text: 'stop' },
    ]);
  });

  it('supports a trailing chord at offset equal to length', () => {
    const result = segmentLine('走', [chord('c1', 'F', 1)]);
    expect(result.segments).toEqual([
      { chordId: null, chord: null, text: '走' },
      { chordId: 'c1', chord: 'F', text: '' },
    ]);
  });

  it('uses grapheme offsets, not UTF-16 code units', () => {
    const result = segmentLine('👍🏽好', [chord('c1', 'D', 1)]);
    expect(result.segments[1]).toEqual({ chordId: 'c1', chord: 'D', text: '好' });
  });

  it('separates unanchored chords', () => {
    const result = segmentLine('', [chord('c1', 'C', null), chord('c2', 'G', null)]);
    expect(result.unanchored.map((c) => c.symbol)).toEqual(['C', 'G']);
    expect(result.segments).toEqual([]);
  });

  it('keeps authored order for chords sharing an offset', () => {
    const result = segmentLine('ab', [chord('c1', 'C', 0), chord('c2', 'C/B', 0)]);
    expect(result.segments).toEqual([
      { chordId: 'c1', chord: 'C', text: '' },
      { chordId: 'c2', chord: 'C/B', text: 'ab' },
    ]);
  });

  it.each([-1, 3, 1.5])('rejects invalid offset %s', (offset) => {
    expect(() => segmentLine('ab', [chord('c1', 'C', offset)])).toThrow(AnchorOutOfBoundsError);
  });
});
