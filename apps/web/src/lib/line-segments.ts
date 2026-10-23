/**
 * Splits a lyric line into chord-anchored segments using Unicode grapheme
 * clusters (SPEC §4: `graphemeOffset` never counts UTF-16 code units).
 */

export interface ChordPlacement {
  id: string;
  symbol: string;
  anchor: { graphemeOffset: number } | null;
}

export interface LineSegment {
  /** Chord occurrence id when the segment starts with a chord. */
  chordId: string | null;
  chord: string | null;
  text: string;
}

export interface SegmentedLine {
  /** Chords without a lyric anchor (instrumental / time-only), in document order. */
  unanchored: ChordPlacement[];
  segments: LineSegment[];
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function splitGraphemes(text: string): string[] {
  return Array.from(segmenter.segment(text.normalize('NFC')), (part) => part.segment);
}

export class AnchorOutOfBoundsError extends RangeError {
  override name = 'AnchorOutOfBoundsError';
}

export function segmentLine(text: string, chords: readonly ChordPlacement[]): SegmentedLine {
  const graphemes = splitGraphemes(text);
  const unanchored: ChordPlacement[] = [];
  const anchored: { chord: ChordPlacement; offset: number }[] = [];

  for (const chord of chords) {
    if (chord.anchor === null) {
      unanchored.push(chord);
      continue;
    }
    const offset = chord.anchor.graphemeOffset;
    if (!Number.isInteger(offset) || offset < 0 || offset > graphemes.length) {
      throw new AnchorOutOfBoundsError(
        `Chord ${chord.id} anchor ${offset} is outside 0..${graphemes.length}`,
      );
    }
    anchored.push({ chord, offset });
  }

  // Stable sort keeps authored order for chords sharing one offset.
  anchored.sort((a, b) => a.offset - b.offset);

  const segments: LineSegment[] = [];
  const firstOffset = anchored[0]?.offset ?? graphemes.length;
  if (firstOffset > 0) {
    segments.push({ chordId: null, chord: null, text: graphemes.slice(0, firstOffset).join('') });
  }
  anchored.forEach(({ chord, offset }, index) => {
    const end = anchored[index + 1]?.offset ?? graphemes.length;
    segments.push({
      chordId: chord.id,
      chord: chord.symbol,
      text: graphemes.slice(offset, end).join(''),
    });
  });

  return { unanchored, segments };
}
