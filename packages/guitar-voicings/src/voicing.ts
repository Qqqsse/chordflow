import { getChordTones, mod12, pitchClass, type ChordAst } from '@chordflow/music-theory';
import { STANDARD_TUNING, tuningMidi, type Tuning } from './tuning';

/*
 * A guitar voicing is a fingering, independent of any chord symbol (SPEC §7).
 * Whether it realizes a chord is decided by validation against that chord in
 * a specific tuning — never assumed from a name.
 */

export const STRING_COUNT = 6;
/** -1 = muted, 0 = open, n = fretted at n. Index 0 is the lowest string. */
export type Frets = readonly [number, number, number, number, number, number];
/** 1 index … 4 little finger, `T` thumb, `null` for open/muted strings. */
export type Finger = 1 | 2 | 3 | 4 | 'T' | null;
export type Fingers = readonly [Finger, Finger, Finger, Finger, Finger, Finger];

export interface Barre {
  fret: number;
  /** Inclusive string indices (0 = lowest string). */
  fromString: number;
  toString: number;
  finger: 1 | 2 | 3 | 4;
}

export type VoicingDifficulty = 'easy' | 'intermediate' | 'advanced';

export interface Voicing {
  /** Stable id derived from the frets, e.g. `v_x32010`. */
  id: string;
  frets: Frets;
  fingers: Fingers | null;
  barres: readonly Barre[];
  tags: readonly string[];
  source: 'curated' | 'curated_movable';
  /** Editorial override; otherwise derived from the difficulty score. */
  difficulty: VoicingDifficulty | null;
  /** Short zh-TW description, e.g. `簡易`, `封閉和弦`. */
  label: string | null;
}

export const MAX_FRET = 15;
export const MAX_SPAN = 4;

/** Frets as a compact, unambiguous token: one base-36 digit per string, `x` = muted. */
export function fretsToken(frets: Frets): string {
  return frets.map((f) => (f < 0 ? 'x' : f.toString(36))).join('');
}

export function voicingId(frets: Frets): string {
  return `v_${fretsToken(frets)}`;
}

export type VoicingIssueCode =
  | 'INVALID_FRET'
  | 'TOO_FEW_STRINGS'
  | 'SPAN_TOO_WIDE'
  | 'TOO_MANY_FINGERS'
  | 'FINGER_ON_OPEN_STRING'
  | 'BARRE_INVALID'
  | 'MISSING_CHORD_TONE'
  | 'FOREIGN_NOTE'
  | 'WRONG_BASS';

export interface VoicingIssue {
  code: VoicingIssueCode;
  message: string;
}

/** Sounding MIDI note per string (`null` for muted). */
export function soundingNotes(frets: Frets, tuning: Tuning = STANDARD_TUNING): (number | null)[] {
  const open = tuningMidi(tuning);
  return frets.map((fret, i) => (fret < 0 ? null : (open[i] ?? 0) + fret));
}

/** Checks the fingering itself, independent of any chord. */
export function checkPlayability(
  voicing: Pick<Voicing, 'frets' | 'fingers' | 'barres'>,
): VoicingIssue[] {
  const issues: VoicingIssue[] = [];
  const { frets, fingers, barres } = voicing;
  if (
    // Runtime guard: voicings may come from untyped JSON.
    (frets as readonly number[]).length !== STRING_COUNT ||
    frets.some((f) => !Number.isInteger(f) || f < -1 || f > MAX_FRET)
  ) {
    issues.push({ code: 'INVALID_FRET', message: `frets must be integers −1…${MAX_FRET}` });
    return issues;
  }
  if (frets.filter((f) => f >= 0).length < 3) {
    issues.push({ code: 'TOO_FEW_STRINGS', message: 'at least three strings must sound' });
  }
  const fretted = frets.filter((f) => f > 0);
  if (fretted.length > 0 && Math.max(...fretted) - Math.min(...fretted) + 1 > MAX_SPAN + 1) {
    issues.push({
      code: 'SPAN_TOO_WIDE',
      message: `fretted notes span more than ${MAX_SPAN + 1} frets`,
    });
  }
  for (const barre of barres) {
    const inRange =
      barre.fromString >= 0 && barre.toString < STRING_COUNT && barre.fromString < barre.toString;
    const covered = inRange ? frets.slice(barre.fromString, barre.toString + 1) : [];
    if (
      !inRange ||
      barre.fret < 1 ||
      covered.some((f) => f >= 0 && f < barre.fret) ||
      frets[barre.fromString] !== barre.fret
    ) {
      issues.push({
        code: 'BARRE_INVALID',
        message: `barre at fret ${barre.fret} does not fit the frets`,
      });
    }
  }
  if (fingers !== null) {
    fingers.forEach((finger, i) => {
      if (finger !== null && (frets[i] ?? -1) <= 0) {
        issues.push({
          code: 'FINGER_ON_OPEN_STRING',
          message: `string ${i + 1} is open or muted but has a finger`,
        });
      }
    });
    const used = new Set(fingers.filter((f) => f !== null));
    if (used.size > 4)
      issues.push({ code: 'TOO_MANY_FINGERS', message: 'more than four fretting fingers' });
  } else {
    // Without explicit fingers: barres count as one finger each.
    const barreStrings = new Set<number>();
    for (const b of barres) {
      for (let s = b.fromString; s <= b.toString; s += 1)
        if (frets[s] === b.fret) barreStrings.add(s);
    }
    const individual = frets.filter((f, i) => f > 0 && !barreStrings.has(i)).length;
    if (individual + barres.length > 4) {
      issues.push({ code: 'TOO_MANY_FINGERS', message: 'needs more than four fretting fingers' });
    }
  }
  return issues;
}

export interface VoicingCheck {
  valid: boolean;
  issues: VoicingIssue[];
  /** Pitch classes that sound, low to high (duplicates kept). */
  soundingPitchClasses: number[];
  /** Optional chord tones (e.g. the natural 5th) left out by this voicing. */
  omittedOptional: number[];
}

/**
 * Validates that `voicing` realizes `chord` in `tuning`: every required chord
 * tone sounds, no foreign notes sound, and the lowest sounding note is the
 * slash bass (or the root for chords without a slash).
 */
export function validateVoicing(
  voicing: Pick<Voicing, 'frets' | 'fingers' | 'barres'>,
  chord: ChordAst,
  tuning: Tuning = STANDARD_TUNING,
): VoicingCheck {
  const issues = checkPlayability(voicing);
  if (issues.some((i) => i.code === 'INVALID_FRET')) {
    return { valid: false, issues, soundingPitchClasses: [], omittedOptional: [] };
  }
  const notes = soundingNotes(voicing.frets, tuning).filter((n): n is number => n !== null);
  const sounding = notes.map(mod12);
  const present = new Set(sounding);
  const tones = getChordTones(chord);
  const allowed = new Set(tones.map((t) => t.pitchClass));
  if (chord.bass !== null) allowed.add(pitchClass(chord.bass));

  for (const tone of tones) {
    if (!tone.optional && !present.has(tone.pitchClass)) {
      issues.push({
        code: 'MISSING_CHORD_TONE',
        message: `missing chord tone (degree ${tone.degree})`,
      });
    }
  }
  for (const pc of present) {
    if (!allowed.has(pc))
      issues.push({ code: 'FOREIGN_NOTE', message: `pitch class ${pc} is not in the chord` });
  }
  const lowest = notes.length > 0 ? mod12(Math.min(...notes)) : null;
  const expectedBass = pitchClass(chord.bass ?? chord.root);
  if (lowest !== expectedBass) {
    issues.push({
      code: 'WRONG_BASS',
      message: chord.bass
        ? 'the slash bass must be the lowest sounding note'
        : 'the root must be the lowest sounding note',
    });
  }
  const omittedOptional = tones
    .filter((t) => t.optional && !present.has(t.pitchClass))
    .map((t) => t.pitchClass);
  return { valid: issues.length === 0, issues, soundingPitchClasses: sounding, omittedOptional };
}
