import { getChordTones, type ChordAst } from './chord';
import { chooseEnharmonicSpelling, keySpellingMap, transposeKey, type KeyContext } from './key';
import {
  applyInterval,
  isRareEnharmonic,
  mod12,
  pitchClass,
  type SpelledInterval,
  type SpelledPitch,
} from './pitch';

/** Default interval spelling per semitone count when no key is known (tritone decided per chord). */
const DEFAULT_INTERVALS: Readonly<Record<number, SpelledInterval>> = {
  0: { steps: 0, semitones: 0 },
  1: { steps: 1, semitones: 1 },
  2: { steps: 1, semitones: 2 },
  3: { steps: 2, semitones: 3 },
  4: { steps: 2, semitones: 4 },
  5: { steps: 3, semitones: 5 },
  7: { steps: 4, semitones: 7 },
  8: { steps: 5, semitones: 8 },
  9: { steps: 5, semitones: 9 },
  10: { steps: 6, semitones: 10 },
  11: { steps: 6, semitones: 11 },
};

/**
 * Keeps the interval-derived spelling unless it is a double accidental, or a
 * rare enharmonic (E♯, B♯, C♭, F♭) the target key does not itself use.
 */
function tidy(pitch: SpelledPitch, key: KeyContext | null): SpelledPitch {
  const pc = pitchClass(pitch);
  const keyUses = (p: SpelledPitch) => {
    if (key === null) return false;
    const spelled = keySpellingMap(key).get(pc);
    return spelled?.letter === p.letter && spelled.accidental === p.accidental;
  };
  if (Math.abs(pitch.accidental) >= 2 || (isRareEnharmonic(pitch) && !keyUses(pitch))) {
    return chooseEnharmonicSpelling(pc, {
      key,
      prefer: pitch.accidental > 0 ? 'sharp' : 'flat',
    });
  }
  return pitch;
}

/**
 * Moves root and bass together by one spelled interval; the suffix never
 * changes. A bass that is a chord tone is spelled as that chord tone (G♯7/B♯,
 * not G♯7/C), so the slash keeps its harmonic meaning.
 */
export function transposeChordByInterval(
  chord: ChordAst,
  interval: SpelledInterval,
  targetKey: KeyContext | null = null,
): ChordAst {
  const root = tidy(applyInterval(chord.root, interval), targetKey);
  let bass: SpelledPitch | null = null;
  if (chord.bass !== null) {
    const moved = applyInterval(chord.bass, interval);
    const asChordTone = getChordTones({ ...chord, root }).find(
      (tone) => tone.pitchClass === pitchClass(moved),
    );
    bass =
      asChordTone !== undefined && Math.abs(asChordTone.note.accidental) <= 1
        ? asChordTone.note
        : tidy(moved, targetKey);
  }
  return { ...chord, root, bass };
}

export interface TransposeOptions {
  /** Key the chord is currently written in. Enables key-aware target spelling. */
  key?: KeyContext | null;
}

function totalAccidentals(chord: ChordAst): number {
  return Math.abs(chord.root.accidental) + Math.abs(chord.bass?.accidental ?? 0);
}

/**
 * Transposes sounding pitch by `semitones` (any integer; octaves are
 * spelling-neutral). With a key, the target key is chosen first and its
 * interval applied, so spelling stays consistent across the whole chart.
 */
export function transposeChord(
  chord: ChordAst,
  semitones: number,
  options: TransposeOptions = {},
): ChordAst {
  if (!Number.isInteger(semitones)) throw new RangeError('semitones must be an integer');
  if (options.key) {
    const target = transposeKey(options.key, semitones);
    return transposeChordByInterval(chord, target.interval, target.key);
  }
  const n = mod12(semitones);
  const fixed = DEFAULT_INTERVALS[n];
  if (fixed) return transposeChordByInterval(chord, fixed);
  // Tritone: augmented fourth or diminished fifth, whichever spells more simply.
  const a4 = transposeChordByInterval(chord, { steps: 3, semitones: 6 });
  const d5 = transposeChordByInterval(chord, { steps: 4, semitones: 6 });
  return totalAccidentals(d5) < totalAccidentals(a4) ? d5 : a4;
}

export const MIN_CAPO = 0;
export const MAX_CAPO = 12;

export class InvalidCapoError extends RangeError {
  override name = 'InvalidCapoError';
}

export function assertCapo(capoFret: number): void {
  if (!Number.isInteger(capoFret) || capoFret < MIN_CAPO || capoFret > MAX_CAPO) {
    throw new InvalidCapoError(`capo fret must be an integer ${MIN_CAPO}–${MAX_CAPO}`);
  }
}

/**
 * Guitar shape to play for a sounding (concert) chord with a capo: the chord
 * shifted down `capoFret` semitones. Pass the concert key for key-aware spelling.
 */
export function concertToShape(
  chord: ChordAst,
  capoFret: number,
  options: TransposeOptions = {},
): ChordAst {
  assertCapo(capoFret);
  return transposeChord(chord, -capoFret, options);
}

/** Sounding chord produced by playing `shape` with a capo. Pass the shape key if known. */
export function shapeToConcert(
  shape: ChordAst,
  capoFret: number,
  options: TransposeOptions = {},
): ChordAst {
  assertCapo(capoFret);
  return transposeChord(shape, capoFret, options);
}
