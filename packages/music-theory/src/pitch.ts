/**
 * Spelled pitch classes. Sounding pitch (0–11 in 12-TET) and written spelling
 * (letter + accidental) are kept separate (SPEC §5).
 */

export const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;
export type Letter = (typeof LETTERS)[number];

const NATURAL_PITCH_CLASS: Readonly<Record<Letter, number>> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

export interface SpelledPitch {
  letter: Letter;
  /** Semitone offset from the natural letter: -2 (double flat) … +2 (double sharp). */
  accidental: number;
}

export type AccidentalStyle = 'ascii' | 'unicode';

export function mod12(value: number): number {
  return ((value % 12) + 12) % 12;
}

export function letterIndex(letter: Letter): number {
  return LETTERS.indexOf(letter);
}

export function letterAt(index: number): Letter {
  const letter = LETTERS[((index % 7) + 7) % 7];
  if (letter === undefined) throw new RangeError(`bad letter index ${index}`);
  return letter;
}

export function naturalPitchClass(letter: Letter): number {
  return NATURAL_PITCH_CLASS[letter];
}

export function pitchClass(pitch: SpelledPitch): number {
  return mod12(NATURAL_PITCH_CLASS[pitch.letter] + pitch.accidental);
}

/** Accidental needed on `letter` to sound `pc`, normalized to −6…+5. */
export function accidentalFor(letter: Letter, pc: number): number {
  const diff = mod12(pc - NATURAL_PITCH_CLASS[letter]);
  return diff > 6 ? diff - 12 : diff;
}

// `x` is deliberately not accepted for double sharp: it would be ambiguous inside chord suffixes.
const ACCIDENTAL_PATTERN = /^(𝄪|𝄫|##|bb|♯♯|♭♭|#|b|♯|♭)?/u;

function accidentalValue(token: string): number {
  switch (token) {
    case '':
      return 0;
    case '#':
    case '♯':
      return 1;
    case 'b':
    case '♭':
      return -1;
    case '##':
    case '♯♯':
    case '𝄪':
      return 2;
    case 'bb':
    case '♭♭':
    case '𝄫':
      return -2;
    default:
      throw new RangeError(`unknown accidental ${token}`);
  }
}

/**
 * Reads a note name (letter + optional accidental) at the start of `input`.
 * Returns the pitch and the number of UTF-16 units consumed, or `null`.
 */
export function readNote(input: string): { pitch: SpelledPitch; length: number } | null {
  const letter = input[0];
  if (letter === undefined || !(LETTERS as readonly string[]).includes(letter)) {
    return null;
  }
  const rest = input.slice(1);
  const token = ACCIDENTAL_PATTERN.exec(rest)?.[0] ?? '';
  return {
    pitch: { letter: letter as Letter, accidental: accidentalValue(token) },
    length: 1 + token.length,
  };
}

export function parseNote(input: string): SpelledPitch | null {
  const read = readNote(input);
  return read !== null && read.length === input.length ? read.pitch : null;
}

export function formatAccidental(accidental: number, style: AccidentalStyle = 'ascii'): string {
  const sharp = style === 'unicode' ? '♯' : '#';
  const flat = style === 'unicode' ? '♭' : 'b';
  if (accidental >= 0) return sharp.repeat(accidental);
  return flat.repeat(-accidental);
}

export function formatNote(pitch: SpelledPitch, style: AccidentalStyle = 'ascii'): string {
  return `${pitch.letter}${formatAccidental(pitch.accidental, style)}`;
}

export function samePitchClass(a: SpelledPitch, b: SpelledPitch): boolean {
  return pitchClass(a) === pitchClass(b);
}

/** A spelled interval: letter steps (0–6, may be negative for downward) and semitones. */
export interface SpelledInterval {
  steps: number;
  semitones: number;
}

export function applyInterval(pitch: SpelledPitch, interval: SpelledInterval): SpelledPitch {
  const letter = letterAt(letterIndex(pitch.letter) + interval.steps);
  const pc = mod12(pitchClass(pitch) + interval.semitones);
  return { letter, accidental: accidentalFor(letter, pc) };
}

/** All spellings of a pitch class with at most `maxAccidental` accidentals, fewest first. */
export function spellingsOf(pc: number, maxAccidental = 2): SpelledPitch[] {
  return LETTERS.map((letter) => ({ letter, accidental: accidentalFor(letter, mod12(pc)) }))
    .filter((p) => Math.abs(p.accidental) <= maxAccidental)
    .sort((a, b) => Math.abs(a.accidental) - Math.abs(b.accidental));
}

/** E♯, B♯, C♭ and F♭: correct in some keys, but surprising as chromatic spellings. */
export function isRareEnharmonic(pitch: SpelledPitch): boolean {
  return (
    (pitch.accidental === 1 && (pitch.letter === 'E' || pitch.letter === 'B')) ||
    (pitch.accidental === -1 && (pitch.letter === 'C' || pitch.letter === 'F'))
  );
}
