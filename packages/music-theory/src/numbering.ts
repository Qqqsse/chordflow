import type { ChordAst, ChordToken } from './chord';
import { scaleOf, type KeyContext } from './key';
import {
  accidentalFor,
  formatAccidental,
  letterIndex,
  pitchClass,
  type SpelledPitch,
} from './pitch';

/*
 * Roman-numeral and Nashville-number rendering relative to a selected key
 * (SPEC §5). Degrees come from letter distance, accidentals from comparison
 * with the key's own scale degree — chord quality never changes the degree.
 */

export interface ScaleDegree {
  /** 1–7 */
  degree: number;
  /** Offset from the key's diatonic degree: −1 = ♭, +1 = ♯. */
  accidental: number;
}

export function scaleDegreeOf(pitch: SpelledPitch, key: KeyContext): ScaleDegree {
  const steps = (((letterIndex(pitch.letter) - letterIndex(key.tonic.letter)) % 7) + 7) % 7;
  const reference = scaleOf(key)[steps];
  if (reference === undefined) throw new RangeError('bad scale degree');
  const offset = accidentalFor(reference.letter, pitchClass(pitch)) - reference.accidental;
  return { degree: steps + 1, accidental: offset };
}

type QualityMark = '' | 'm' | '°' | 'ø' | '+';

interface Decomposed {
  upper: boolean;
  mark: QualityMark;
  rest: string;
}

function decompose(chord: ChordAst): Decomposed {
  const absorbed = new Set<ChordToken>();
  const tokens = chord.tokens;
  const find = (kind: ChordToken['kind'], text?: string) =>
    tokens.find((t) => t.kind === kind && (text === undefined || t.text === text));

  let upper = true;
  let mark: QualityMark = '';
  const minorThird = chord.third === 'minor';
  if (minorThird && chord.fifth === 'diminished' && chord.seventh === 'minor') {
    upper = false;
    mark = 'ø';
    for (const t of [find('quality'), find('seventh'), find('alteration', 'b5')]) {
      if (t) absorbed.add(t);
    }
  } else if (minorThird && chord.fifth === 'diminished') {
    upper = false;
    mark = '°';
    for (const t of [find('quality'), find('alteration', 'b5')]) if (t) absorbed.add(t);
  } else if (minorThird) {
    upper = false;
    mark = 'm';
    const q = find('quality');
    if (q) absorbed.add(q);
  } else if (chord.third === 'major' && chord.fifth === 'augmented') {
    mark = '+';
    for (const t of [find('quality'), find('alteration', '#5')]) if (t) absorbed.add(t);
  }

  let rest = tokens
    .filter((t) => !absorbed.has(t))
    .map((t) => t.text)
    .join('');
  // The ø mark absorbs the m7♭5 spelling; show the implied 7 unless a 9/11/13 replaces it.
  if (mark === 'ø' && !tokens.some((t) => t.kind === 'extension')) rest = `7${rest}`;
  return { upper, mark, rest };
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'] as const;

export interface NumberedChord {
  /** Accidental prefix relative to the key, e.g. `b` for ♭VII. */
  accidental: string;
  degree: number;
  /** Roman numeral (case encodes quality) or Nashville digit. */
  numeral: string;
  /** `°`, `ø`, `+`, or `m` (Nashville minor); empty otherwise. */
  quality: string;
  /** Remaining suffix, e.g. `7`, `maj7`, `sus4`, `add9`. */
  suffix: string;
  /** Slash bass as a degree of the key (Nashville convention, e.g. G/B in C → `7`), with accidental. */
  bass: string | null;
  text: string;
}

function bassDegree(chord: ChordAst, key: KeyContext): string | null {
  if (chord.bass === null) return null;
  const d = scaleDegreeOf(chord.bass, key);
  return `${formatAccidental(d.accidental)}${d.degree}`;
}

export function renderRomanNumeral(chord: ChordAst, key: KeyContext): NumberedChord {
  const { degree, accidental } = scaleDegreeOf(chord.root, key);
  const { upper, mark, rest } = decompose(chord);
  const base = ROMAN[degree - 1] ?? '?';
  const numeral = upper ? base : base.toLowerCase();
  const quality = mark === 'm' ? '' : mark;
  const acc = formatAccidental(accidental);
  const bass = bassDegree(chord, key);
  return {
    accidental: acc,
    degree,
    numeral,
    quality,
    suffix: rest,
    bass,
    text: `${acc}${numeral}${quality}${rest}${bass === null ? '' : `/${bass}`}`,
  };
}

export function renderNashvilleNumber(chord: ChordAst, key: KeyContext): NumberedChord {
  const { degree, accidental } = scaleDegreeOf(chord.root, key);
  const { mark, rest } = decompose(chord);
  const acc = formatAccidental(accidental);
  const bass = bassDegree(chord, key);
  const numeral = String(degree);
  return {
    accidental: acc,
    degree,
    numeral,
    quality: mark,
    suffix: rest,
    bass,
    text: `${acc}${numeral}${mark}${rest}${bass === null ? '' : `/${bass}`}`,
  };
}
