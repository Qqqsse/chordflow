import {
  applyInterval,
  formatNote,
  pitchClass,
  readNote,
  type AccidentalStyle,
  type SpelledPitch,
} from './pitch';

/*
 * Chord symbol parsing (SPEC §5). The grammar is an explicit, documented
 * subset; anything outside it yields a typed error — symbols are never
 * guessed at or silently rewritten.
 */

export const MAX_CHORD_SYMBOL_LENGTH = 32;

export type ThirdKind = 'major' | 'minor' | 'sus2' | 'sus4' | 'none';
export type FifthKind = 'perfect' | 'diminished' | 'augmented' | 'none';
export type SeventhKind = 'none' | 'minor' | 'major' | 'diminished';

export type ChordTokenKind =
  'quality' | 'power' | 'sixth' | 'seventh' | 'extension' | 'sus' | 'add' | 'alteration' | 'omit';

export interface ChordToken {
  kind: ChordTokenKind;
  /** Normalized ASCII text of the token, e.g. `m`, `maj7`, `sus4`, `b5`, `add9`. */
  text: string;
}

export interface ChordInterval {
  /** Scale degree above the root: 1, 2, 3 … 13. Determines the spelled letter. */
  degree: number;
  semitones: number;
  /** May be omitted in a voicing (e.g. a natural 5th, the 9th under an 11/13). */
  optional: boolean;
}

export interface ChordAst {
  /** Original input exactly as given. */
  input: string;
  root: SpelledPitch;
  /** Suffix as written between root and slash (e.g. `m7b5`). */
  suffix: string;
  bass: SpelledPitch | null;
  tokens: ChordToken[];
  third: ThirdKind;
  fifth: FifthKind;
  seventh: SeventhKind;
  sixth: boolean;
  /** Highest natural extension implying a seventh (9, 11, 13), if any. */
  extension: 9 | 11 | 13 | null;
  intervals: ChordInterval[];
}

export type ChordParseErrorCode =
  | 'EMPTY'
  | 'TOO_LONG'
  | 'INVALID_ROOT'
  | 'INVALID_BASS'
  | 'UNSUPPORTED_SUFFIX'
  | 'CONFLICTING_SUFFIX';

export interface ChordParseError {
  code: ChordParseErrorCode;
  message: string;
  input: string;
}

export type ChordParseResult =
  { ok: true; chord: ChordAst } | { ok: false; error: ChordParseError };

export class UnsupportedChordError extends Error {
  override name = 'UnsupportedChordError';
  constructor(readonly detail: ChordParseError) {
    super(`${detail.code}: ${detail.message} (${JSON.stringify(detail.input)})`);
  }
}

interface Draft {
  tokens: ChordToken[];
  third: ThirdKind | null;
  fifth: FifthKind | null;
  seventh: SeventhKind;
  sixth: boolean;
  extension: 9 | 11 | 13 | null;
  power: boolean;
  adds: ChordInterval[];
  alterations: ChordInterval[];
  omit3: boolean;
  omit5: boolean;
}

const ADD_INTERVALS: Readonly<Record<string, ChordInterval>> = {
  '2': { degree: 2, semitones: 2, optional: false },
  '4': { degree: 4, semitones: 5, optional: false },
  '9': { degree: 9, semitones: 14, optional: false },
  '11': { degree: 11, semitones: 17, optional: false },
  '13': { degree: 13, semitones: 21, optional: false },
  b9: { degree: 9, semitones: 13, optional: false },
  '#9': { degree: 9, semitones: 15, optional: false },
  '#11': { degree: 11, semitones: 18, optional: false },
  b13: { degree: 13, semitones: 20, optional: false },
};

function intervalFor(text: string): ChordInterval {
  const interval = ADD_INTERVALS[text];
  if (interval === undefined) throw new RangeError(`no interval for ${text}`);
  return interval;
}

class SuffixError extends Error {
  constructor(
    readonly code: 'UNSUPPORTED_SUFFIX' | 'CONFLICTING_SUFFIX',
    message: string,
  ) {
    super(message);
  }
}

function parseSuffix(raw: string): Draft {
  const d: Draft = {
    tokens: [],
    third: null,
    fifth: null,
    seventh: 'none',
    sixth: false,
    extension: null,
    power: false,
    adds: [],
    alterations: [],
    omit3: false,
    omit5: false,
  };

  // Parentheses and commas only group modifiers: `7(b9,#11)` ≡ `7b9#11`.
  let depth = 0;
  for (const ch of raw) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (depth < 0 || depth > 1)
      throw new SuffixError('UNSUPPORTED_SUFFIX', 'unbalanced parentheses');
  }
  if (depth !== 0) throw new SuffixError('UNSUPPORTED_SUFFIX', 'unbalanced parentheses');
  let s = raw.replace(/♯/gu, '#').replace(/♭/gu, 'b').replace(/[(),]/g, '');

  const take = (re: RegExp): RegExpExecArray | null => {
    const match = re.exec(s);
    if (match) s = s.slice(match[0].length);
    return match;
  };
  const push = (kind: ChordTokenKind, text: string) => d.tokens.push({ kind, text });
  const setSeventh = (kind: SeventhKind, text: string) => {
    if (d.seventh !== 'none') throw new SuffixError('CONFLICTING_SUFFIX', 'seventh given twice');
    d.seventh = kind;
    push('seventh', text);
  };
  const setExtension = (value: string) => {
    if (value === '7') return;
    d.extension = Number(value) as 9 | 11 | 13;
    push('extension', value);
  };

  // 1. Quality.
  if (take(/^[øØ]7?/)) {
    d.third = 'minor';
    d.fifth = 'diminished';
    d.seventh = 'minor';
    push('quality', 'ø');
  } else if (take(/^(dim7|°7|o7)/)) {
    d.third = 'minor';
    d.fifth = 'diminished';
    d.seventh = 'diminished';
    push('quality', 'dim');
    push('seventh', '7');
  } else if (take(/^(dim|°|o(?=$|7))/)) {
    d.third = 'minor';
    d.fifth = 'diminished';
    push('quality', 'dim');
  } else if (take(/^(aug|\+)/)) {
    d.third = 'major';
    d.fifth = 'augmented';
    push('quality', 'aug');
  } else if (take(/^(min|m(?!aj|a(?:7|9|11|13))|-)/)) {
    d.third = 'minor';
    push('quality', 'm');
  } else if (take(/^5(?![0-9])/)) {
    d.power = true;
    push('power', '5');
  }

  // 2. Sixth / seventh / extension.
  let match: RegExpExecArray | null;
  if ((match = take(/^(maj|Maj|MA|ma|M)(7|9|11|13)/)) || (match = take(/^[Δ△](7|9|11|13)?/))) {
    const number = match[2] ?? match[1] ?? '7';
    setSeventh('major', 'maj7');
    setExtension(/^\d+$/.test(number) ? number : '7');
  } else if (take(/^(6\/9|69)/)) {
    d.sixth = true;
    push('sixth', '6');
    d.adds.push(intervalFor('9'));
    push('add', 'add9');
  } else if (take(/^6/)) {
    d.sixth = true;
    push('sixth', '6');
  } else if ((match = take(/^(7|9|11|13)/))) {
    const number = match[1] ?? '7';
    if (d.seventh !== 'none') {
      // `ø7` already consumed its 7; a second number is a conflict.
      throw new SuffixError('CONFLICTING_SUFFIX', 'seventh given twice');
    }
    const dimTriad = d.tokens.some((t) => t.kind === 'quality' && t.text === 'dim');
    setSeventh(dimTriad ? 'diminished' : 'minor', '7');
    setExtension(number);
  }
  // `m(maj7)` / `mMaj7` — a major seventh after a minor quality.
  if (
    d.seventh === 'none' &&
    d.third === 'minor' &&
    (match = take(/^(?:(?:maj|Maj|MA|M)(7|9|11|13)|[Δ△](7|9|11|13)?)/))
  ) {
    setSeventh('major', 'maj7');
    setExtension(match[1] ?? match[2] ?? '7');
  }

  // 3. Modifiers.
  while (s.length > 0) {
    if ((match = take(/^sus(2|4)?/))) {
      if (d.third !== null) {
        throw new SuffixError('CONFLICTING_SUFFIX', 'sus conflicts with the chord quality');
      }
      d.third = match[1] === '2' ? 'sus2' : 'sus4';
      push('sus', `sus${match[1] ?? '4'}`);
    } else if ((match = take(/^add(b9|#9|#11|b13|2|4|9|11|13)/))) {
      const value = match[1] ?? '';
      d.adds.push(intervalFor(value));
      push('add', `add${value}`);
    } else if ((match = take(/^(b|#)(5|9|11|13)/))) {
      const text = `${match[1] ?? ''}${match[2] ?? ''}`;
      if (text === 'b5' || text === '#5') {
        if (d.fifth !== null && d.fifth !== 'perfect') {
          throw new SuffixError('CONFLICTING_SUFFIX', 'fifth altered twice');
        }
        d.fifth = text === 'b5' ? 'diminished' : 'augmented';
      } else if (text === 'b11' || text === '#13') {
        throw new SuffixError('UNSUPPORTED_SUFFIX', `unsupported alteration ${text}`);
      } else {
        d.alterations.push(intervalFor(text));
      }
      push('alteration', text);
    } else if ((match = take(/^(no|omit)(3|5)/))) {
      if (match[2] === '3') d.omit3 = true;
      else d.omit5 = true;
      push('omit', `no${match[2] ?? ''}`);
    } else {
      throw new SuffixError('UNSUPPORTED_SUFFIX', `cannot read "${s}"`);
    }
  }

  if (d.power && d.tokens.length > 1) {
    throw new SuffixError('CONFLICTING_SUFFIX', 'a power chord takes no other modifiers');
  }
  const texts = d.tokens.map((t) => t.text);
  if (new Set(texts).size !== texts.length) {
    throw new SuffixError('CONFLICTING_SUFFIX', 'repeated modifier');
  }
  return d;
}

function buildIntervals(d: Draft): ChordInterval[] {
  const out: ChordInterval[] = [{ degree: 1, semitones: 0, optional: false }];
  const third: ThirdKind = d.power ? 'none' : (d.third ?? 'major');
  if (!d.omit3) {
    if (third === 'major') out.push({ degree: 3, semitones: 4, optional: false });
    if (third === 'minor') out.push({ degree: 3, semitones: 3, optional: false });
    if (third === 'sus2') out.push({ degree: 2, semitones: 2, optional: false });
    if (third === 'sus4') out.push({ degree: 4, semitones: 5, optional: false });
  }
  const fifth = d.fifth ?? 'perfect';
  if (!d.omit5) {
    if (fifth === 'perfect') out.push({ degree: 5, semitones: 7, optional: !d.power });
    if (fifth === 'diminished') out.push({ degree: 5, semitones: 6, optional: false });
    if (fifth === 'augmented') out.push({ degree: 5, semitones: 8, optional: false });
  }
  if (d.sixth) out.push({ degree: 6, semitones: 9, optional: false });
  if (d.seventh === 'minor') out.push({ degree: 7, semitones: 10, optional: false });
  if (d.seventh === 'major') out.push({ degree: 7, semitones: 11, optional: false });
  if (d.seventh === 'diminished') out.push({ degree: 7, semitones: 9, optional: false });

  const altered = (degree: number) => d.alterations.some((a) => a.degree === degree);
  if (d.extension !== null) {
    // 11 is conventionally omitted from 13th chords; the 9th under 11/13 is optional.
    if (!altered(9)) out.push({ degree: 9, semitones: 14, optional: d.extension !== 9 });
    if (d.extension === 11 && !altered(11))
      out.push({ degree: 11, semitones: 17, optional: false });
    if (d.extension === 13 && !altered(13))
      out.push({ degree: 13, semitones: 21, optional: false });
  }
  out.push(...d.alterations, ...d.adds);
  return out;
}

function failure(code: ChordParseErrorCode, message: string, input: string): ChordParseResult {
  return { ok: false, error: { code, message, input } };
}

export function parseChord(input: string): ChordParseResult {
  const text = input.trim();
  if (text === '') return failure('EMPTY', 'chord symbol is empty', input);
  if (text.length > MAX_CHORD_SYMBOL_LENGTH) {
    return failure('TOO_LONG', `longer than ${MAX_CHORD_SYMBOL_LENGTH} characters`, input);
  }
  const root = readNote(text);
  if (root === null || Math.abs(root.pitch.accidental) > 1) {
    return failure('INVALID_ROOT', 'root must be A–G with an optional single ♯/♭', input);
  }

  let body = text.slice(root.length);
  let bass: SpelledPitch | null = null;
  const bassText = /\/([^/]+)$/.exec(body)?.[1];
  if (bassText !== undefined && bassText !== '9') {
    const note = readNote(bassText);
    if (note?.length !== bassText.length || Math.abs(note.pitch.accidental) > 1) {
      return failure('INVALID_BASS', `slash bass "${bassText}" is not a note`, input);
    }
    bass = note.pitch;
    body = body.slice(0, body.length - bassText.length - 1);
  }

  let draft: Draft;
  try {
    draft = parseSuffix(body);
  } catch (error) {
    if (error instanceof SuffixError) return failure(error.code, error.message, input);
    throw error;
  }

  const chord: ChordAst = {
    input,
    root: root.pitch,
    suffix: body,
    bass,
    tokens: draft.tokens,
    third: draft.power || draft.omit3 ? 'none' : (draft.third ?? 'major'),
    fifth: draft.omit5 ? 'none' : (draft.fifth ?? 'perfect'),
    seventh: draft.seventh,
    sixth: draft.sixth,
    extension: draft.extension,
    intervals: buildIntervals(draft),
  };
  return { ok: true, chord };
}

export function parseChordOrThrow(input: string): ChordAst {
  const result = parseChord(input);
  if (!result.ok) throw new UnsupportedChordError(result.error);
  return result.chord;
}

function styleSuffix(suffix: string, style: AccidentalStyle): string {
  return style === 'unicode'
    ? suffix.replace(/#/g, '♯').replace(/b(?=\d)/g, '♭')
    : suffix.replace(/♯/gu, '#').replace(/♭/gu, 'b');
}

/** Root + suffix as written + optional slash bass. */
export function formatChord(chord: ChordAst, style: AccidentalStyle = 'ascii'): string {
  const bass = chord.bass === null ? '' : `/${formatNote(chord.bass, style)}`;
  return `${formatNote(chord.root, style)}${styleSuffix(chord.suffix, style)}${bass}`;
}

export interface ChordTone {
  degree: number;
  semitones: number;
  pitchClass: number;
  note: SpelledPitch;
  optional: boolean;
}

/** Spelled chord tones above the root (bass excluded; see `chord.bass`). */
export function getChordTones(chord: ChordAst): ChordTone[] {
  return chord.intervals.map((interval) => {
    const note = applyInterval(chord.root, {
      steps: interval.degree - 1,
      semitones: interval.semitones,
    });
    return {
      degree: interval.degree,
      semitones: interval.semitones,
      pitchClass: pitchClass(note),
      note,
      optional: interval.optional,
    };
  });
}
