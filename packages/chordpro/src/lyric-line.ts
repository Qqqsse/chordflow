import { splitGraphemes } from '@chordflow/chart-schema';

/*
 * One ChordPro lyric line: literal text with inline `[Chord]` marks.
 *
 * Escapes (chordflow subset): `\[` `\]` `\{` `\}` `\\` produce the literal
 * character anywhere in a lyric line; `\#` is needed only at line start.
 * Any other backslash sequence, an unescaped `]`, `{` or `}`, an empty or
 * unterminated chord mark and `[*annotation]` are errors.
 */

export const ESCAPABLE = new Set(['[', ']', '{', '}', '\\', '#']);

export type LyricLineErrorCode =
  | 'BAD_ESCAPE'
  | 'MALFORMED_CHORD'
  | 'UNSUPPORTED_ANNOTATION'
  | 'UNEXPECTED_BRACKET'
  | 'UNEXPECTED_BRACE'
  | 'CHORD_INSIDE_GRAPHEME';

export interface LyricLineError {
  code: LyricLineErrorCode;
  /** 1-based column (UTF-16 based, for editor highlighting). */
  column: number;
  message: string;
}

export interface ParsedChordMark {
  symbol: string;
  /** Grapheme offset into the NFC line text. */
  offset: number;
}

export interface ParsedLyricLine {
  /** NFC text with chord marks removed and escapes resolved. */
  text: string;
  chords: ParsedChordMark[];
}

export function parseLyricLine(
  raw: string,
): { ok: true; line: ParsedLyricLine } | { ok: false; errors: LyricLineError[] } {
  const errors: LyricLineError[] = [];
  let text = '';
  const marks: { symbol: string; prefix: string; column: number }[] = [];

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw.charAt(i);
    const column = i + 1;
    if (ch === '\\') {
      const next = raw.charAt(i + 1);
      if (next !== '' && ESCAPABLE.has(next)) {
        text += next;
        i += 1;
      } else {
        errors.push({ code: 'BAD_ESCAPE', column, message: `unsupported escape "\\${next}"` });
      }
    } else if (ch === '[') {
      const close = raw.indexOf(']', i + 1);
      const nextOpen = raw.indexOf('[', i + 1);
      if (close === -1 || (nextOpen !== -1 && nextOpen < close)) {
        errors.push({ code: 'MALFORMED_CHORD', column, message: 'chord mark is not closed' });
        break;
      }
      const symbol = raw.slice(i + 1, close).trim();
      if (symbol === '') {
        errors.push({ code: 'MALFORMED_CHORD', column, message: 'empty chord mark' });
      } else if (symbol.startsWith('*')) {
        errors.push({
          code: 'UNSUPPORTED_ANNOTATION',
          column,
          message: 'annotations ([*text]) are not supported',
        });
      } else {
        marks.push({ symbol, prefix: text, column });
      }
      i = close;
    } else if (ch === ']') {
      errors.push({ code: 'UNEXPECTED_BRACKET', column, message: 'unmatched "]" (escape as \\])' });
    } else if (ch === '{' || ch === '}') {
      errors.push({
        code: 'UNEXPECTED_BRACE',
        column,
        message: `"${ch}" inside a lyric line (escape as \\${ch})`,
      });
    } else {
      text += ch;
    }
  }

  const full = text.normalize('NFC');
  const graphemes = splitGraphemes(full);
  const boundaries = new Map<number, number>();
  let length = 0;
  boundaries.set(0, 0);
  graphemes.forEach((g, index) => {
    length += g.length;
    boundaries.set(length, index + 1);
  });

  const chords: ParsedChordMark[] = [];
  for (const mark of marks) {
    const prefix = mark.prefix.normalize('NFC');
    const offset = full.startsWith(prefix) ? boundaries.get(prefix.length) : undefined;
    if (offset === undefined) {
      errors.push({
        code: 'CHORD_INSIDE_GRAPHEME',
        column: mark.column,
        message: 'chord mark splits a character (e.g. before a combining accent)',
      });
    } else {
      chords.push({ symbol: mark.symbol, offset });
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, line: { text: full, chords } };
}

function escapeChars(text: string): string {
  return text.replace(/[[\]{}\\]/g, (ch) => `\\${ch}`);
}

/** A leading `#` would make the line a ChordPro comment, so it is escaped too. */
function guardComment(line: string): string {
  return line.startsWith('#') ? `\\${line}` : line;
}

export function escapeLyricText(text: string): string {
  return guardComment(escapeChars(text));
}

/** Inverse of `parseLyricLine` for anchored chords. */
export function renderLyricLine(text: string, chords: readonly ParsedChordMark[]): string {
  const graphemes = splitGraphemes(text);
  const byOffset = new Map<number, string[]>();
  for (const chord of chords) {
    const list = byOffset.get(chord.offset) ?? [];
    list.push(chord.symbol);
    byOffset.set(chord.offset, list);
  }
  let out = '';
  for (let i = 0; i <= graphemes.length; i += 1) {
    for (const symbol of byOffset.get(i) ?? []) out += `[${symbol}]`;
    const g = graphemes[i];
    if (g !== undefined) out += escapeChars(g);
  }
  return guardComment(out);
}
