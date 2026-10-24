import { pitchClass, readNote } from '@chordflow/music-theory';

/** Six open-string pitches, lowest string first (scientific pitch notation). */
export type Tuning = readonly [string, string, string, string, string, string];

export const STANDARD_TUNING: Tuning = ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'];

export class InvalidTuningError extends Error {
  override name = 'InvalidTuningError';
}

/** MIDI note number of a pitch like `E2` or `F#3` (C4 = 60). */
export function midiOf(pitch: string): number {
  const note = readNote(pitch);
  const octave = note === null ? Number.NaN : Number(pitch.slice(note.length));
  if (note === null || !Number.isInteger(octave)) {
    throw new InvalidTuningError(`invalid pitch "${pitch}"`);
  }
  return 12 * (octave + 1) + pitchClass(note.pitch);
}

export function tuningMidi(tuning: Tuning): number[] {
  const midi = tuning.map(midiOf);
  for (let i = 1; i < midi.length; i += 1) {
    if ((midi[i] ?? 0) <= (midi[i - 1] ?? 0) - 12) {
      throw new InvalidTuningError('strings must be listed from lowest to highest');
    }
  }
  return midi;
}

export function isStandardTuning(tuning: Tuning): boolean {
  return tuning.every((pitch, i) => pitch === STANDARD_TUNING[i]);
}
