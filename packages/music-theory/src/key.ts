import {
  applyInterval,
  formatNote,
  isRareEnharmonic,
  letterIndex,
  mod12,
  pitchClass,
  readNote,
  spellingsOf,
  type AccidentalStyle,
  type SpelledInterval,
  type SpelledPitch,
} from './pitch';

export type KeyMode = 'major' | 'minor';

export interface KeyContext {
  tonic: SpelledPitch;
  mode: KeyMode;
}

const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11] as const;
const NATURAL_MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10] as const;

/** Parses `C`, `F#m`, `Bb`, `E♭m` (the chart-schema key format, plus Unicode accidentals). */
export function parseKey(input: string): KeyContext | null {
  const read = readNote(input);
  if (read === null || Math.abs(read.pitch.accidental) > 1) return null;
  const rest = input.slice(read.length);
  if (rest === '') return { tonic: read.pitch, mode: 'major' };
  if (rest === 'm') return { tonic: read.pitch, mode: 'minor' };
  return null;
}

export function formatKey(key: KeyContext, style: AccidentalStyle = 'ascii'): string {
  return `${formatNote(key.tonic, style)}${key.mode === 'minor' ? 'm' : ''}`;
}

/** Diatonic scale (natural minor for minor keys), spelled with one letter per degree. */
export function scaleOf(key: KeyContext): SpelledPitch[] {
  const steps = key.mode === 'major' ? MAJOR_STEPS : NATURAL_MINOR_STEPS;
  return steps.map((semitones, degree) => applyInterval(key.tonic, { steps: degree, semitones }));
}

/** Key signature as a signed count: +n sharps, −n flats. */
export function keySignature(key: KeyContext): number {
  return scaleOf(key).reduce((sum, note) => sum + note.accidental, 0);
}

/**
 * Preferred spelling for each of the 12 pitch classes in a key: diatonic
 * notes first, then conventional chromatic spellings (modal mixture b3/b6/b7,
 * Neapolitan b2 and #4 in major; raised 6/7, Picardy 3, b2 and #4 in minor),
 * skipping any that would need a double accidental or a rare enharmonic.
 */
const CHROMATIC: Readonly<Record<KeyMode, readonly SpelledInterval[]>> = {
  major: [
    { steps: 2, semitones: 3 },
    { steps: 5, semitones: 8 },
    { steps: 6, semitones: 10 },
    { steps: 3, semitones: 6 },
    { steps: 1, semitones: 1 },
  ],
  minor: [
    { steps: 6, semitones: 11 },
    { steps: 5, semitones: 9 },
    { steps: 2, semitones: 4 },
    { steps: 1, semitones: 1 },
    { steps: 3, semitones: 6 },
  ],
};

export function keySpellingMap(key: KeyContext): Map<number, SpelledPitch> {
  const map = new Map<number, SpelledPitch>();
  for (const note of scaleOf(key)) map.set(pitchClass(note), note);
  for (const interval of CHROMATIC[key.mode]) {
    const note = applyInterval(key.tonic, interval);
    // Chromatic spellings stay simple: no double accidentals, no E♯/B♯/C♭/F♭.
    if (Math.abs(note.accidental) > 1 || isRareEnharmonic(note)) continue;
    if (!map.has(pitchClass(note))) map.set(pitchClass(note), note);
  }
  return map;
}

export interface ScaleContext {
  key: KeyContext;
  scale: SpelledPitch[];
  signature: number;
  prefers: 'sharp' | 'flat' | 'neutral';
}

export function getScaleContext(key: KeyContext): ScaleContext {
  const signature = keySignature(key);
  return {
    key,
    scale: scaleOf(key),
    signature,
    prefers: signature > 0 ? 'sharp' : signature < 0 ? 'flat' : 'neutral',
  };
}

const NEUTRAL: KeyContext = { tonic: { letter: 'C', accidental: 0 }, mode: 'major' };

/**
 * Spelling for a sounding pitch class in context. With a key, uses that key's
 * conventions; otherwise a naturals-first spelling biased by `prefer`.
 */
export function chooseEnharmonicSpelling(
  pc: number,
  context: { key?: KeyContext | null; prefer?: 'sharp' | 'flat' } = {},
): SpelledPitch {
  const target = mod12(pc);
  if (context.key) {
    const spelled = keySpellingMap(context.key).get(target);
    if (spelled) return spelled;
  }
  if (context.prefer !== undefined) {
    const candidates = spellingsOf(target, 1);
    const natural = candidates.find((c) => c.accidental === 0);
    if (natural) return natural;
    const wanted = context.prefer === 'sharp' ? 1 : -1;
    const match = candidates.find((c) => c.accidental === wanted);
    if (match) return match;
  }
  const fallback = keySpellingMap(NEUTRAL).get(target);
  if (!fallback) throw new RangeError(`no spelling for pitch class ${target}`);
  return fallback;
}

/**
 * Transposes a key by `semitones`, choosing the target tonic spelling with the
 * smallest key signature (ties: sharps for major, flats for minor). Returns the
 * spelled interval so chords can be moved consistently with the key.
 */
export function transposeKey(
  key: KeyContext,
  semitones: number,
): { key: KeyContext; interval: SpelledInterval } {
  const targetPc = mod12(pitchClass(key.tonic) + semitones);
  let best: { key: KeyContext; signature: number } | null = null;
  for (const tonic of spellingsOf(targetPc, 1)) {
    const candidate: KeyContext = { tonic, mode: key.mode };
    const signature = keySignature(candidate);
    if (Math.abs(signature) > 7) continue;
    if (
      best === null ||
      Math.abs(signature) < Math.abs(best.signature) ||
      (Math.abs(signature) === Math.abs(best.signature) &&
        (key.mode === 'major' ? signature > 0 : signature < 0))
    ) {
      best = { key: candidate, signature };
    }
  }
  if (best === null) throw new RangeError('no valid key spelling'); // unreachable for 12-TET
  const steps = letterIndex(best.key.tonic.letter) - letterIndex(key.tonic.letter);
  return { key: best.key, interval: { steps, semitones } };
}
