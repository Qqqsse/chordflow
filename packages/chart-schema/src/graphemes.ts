/**
 * Grapheme cluster helpers. Chord anchors and lyric alignment ranges index
 * extended grapheme clusters of NFC-normalized text (SPEC §4) — never UTF-16
 * code units, bytes or code points.
 */

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function splitGraphemes(text: string): string[] {
  return Array.from(segmenter.segment(text.normalize('NFC')), (part) => part.segment);
}

export function countGraphemes(text: string): number {
  return Array.from(segmenter.segment(text.normalize('NFC'))).length;
}

export function isNfc(text: string): boolean {
  return text === text.normalize('NFC');
}

/** C0/C1 control characters. Line text never contains tabs or newlines: each line is its own entry. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/u;

export function hasControlCharacters(text: string): boolean {
  return CONTROL_CHARACTERS.test(text);
}
