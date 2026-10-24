import { splitGraphemes } from '@chordflow/chart-schema';
import type { ChartLine } from '@chordflow/chart-schema';

/*
 * Turns one chart line into renderable units (SPEC §8). Each chord and the
 * lyric segment it anchors form one atomic block (chord above, text below,
 * width = max of both), so a chord label wider than its text pushes the next
 * segment instead of overlapping it. Blocks may wrap their own text. Where a
 * chord mark splits a word, the word's pieces are glued (no wrap) so a line
 * never breaks mid-word. Nothing relies on spaces or monospace fonts.
 */

export interface TextUnit {
  kind: 'text';
  key: string;
  text: string;
}

export interface ChordUnit {
  kind: 'chord';
  key: string;
  chordId: string;
  /** Lyric text under the chord; empty renders a placeholder. */
  text: string;
}

export interface GlueUnit {
  kind: 'glue';
  key: string;
  items: (TextUnit | ChordUnit)[];
}

export type LineUnit = TextUnit | ChordUnit | GlueUnit;

export type LineLayout =
  | { kind: 'blank'; lineId: string }
  | { kind: 'chords-only'; lineId: string; chordIds: string[] }
  | { kind: 'lyrics'; lineId: string; leadingChordIds: string[]; units: LineUnit[] };

const NON_WORD =
  /[\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303F\uFF00-\uFFEF]/u;

function isWordGrapheme(g: string | undefined): boolean {
  return g !== undefined && !NON_WORD.test(g);
}

/** Splits text into the part that may wrap and a trailing word fragment. */
export function splitTrailingFragment(text: string): { body: string; fragment: string } {
  const graphemes = splitGraphemes(text);
  let start = graphemes.length;
  while (start > 0 && isWordGrapheme(graphemes[start - 1])) start -= 1;
  return { body: graphemes.slice(0, start).join(''), fragment: graphemes.slice(start).join('') };
}

export function layoutLine(line: ChartLine): LineLayout {
  const unanchored = line.chords.filter((c) => c.anchor === null).map((c) => c.id);
  const anchored = line.chords
    .filter((c) => c.anchor !== null)
    .map((c, index) => ({ id: c.id, offset: c.anchor?.graphemeOffset ?? 0, index }))
    .sort((a, b) => a.offset - b.offset || a.index - b.index);

  if (line.text === '' && anchored.length === 0) {
    return unanchored.length === 0
      ? { kind: 'blank', lineId: line.id }
      : { kind: 'chords-only', lineId: line.id, chordIds: unanchored };
  }

  const graphemes = splitGraphemes(line.text);
  const segments: (TextUnit | ChordUnit)[] = [];
  const firstOffset = anchored[0]?.offset ?? graphemes.length;
  if (firstOffset > 0) {
    segments.push({ kind: 'text', key: 'lead', text: graphemes.slice(0, firstOffset).join('') });
  }
  anchored.forEach((chord, i) => {
    const end = anchored[i + 1]?.offset ?? graphemes.length;
    segments.push({
      kind: 'chord',
      key: chord.id,
      chordId: chord.id,
      text: graphemes.slice(chord.offset, end).join(''),
    });
  });

  // Glue across boundaries that fall inside a word.
  const units: LineUnit[] = [];
  let group: (TextUnit | ChordUnit)[] | null = null;
  const flush = () => {
    if (group === null) return;
    const [only] = group;
    if (group.length === 1 && only) units.push(only);
    else if (group.length > 1) units.push({ kind: 'glue', key: `g${units.length}`, items: group });
    group = null;
  };

  segments.forEach((segment, i) => {
    const next = segments[i + 1];
    const splitsWord =
      next !== undefined &&
      isWordGrapheme(splitGraphemes(segment.text).at(-1)) &&
      isWordGrapheme(splitGraphemes(next.text)[0]);

    if (!splitsWord) {
      if (group) group.push(segment);
      else units.push(segment);
      flush();
      return;
    }
    // Keep everything up to the word start wrappable; glue only the fragment.
    const { body, fragment } = splitTrailingFragment(segment.text);
    if (group === null && body !== '') {
      units.push({ ...segment, text: body });
      group = [{ kind: 'text', key: `${segment.key}-frag`, text: fragment }];
    } else {
      group ??= [];
      group.push(segment);
    }
  });
  flush();

  return { kind: 'lyrics', lineId: line.id, leadingChordIds: unanchored, units };
}
