import { describe, expect, it } from 'vitest';
import {
  UnsupportedChordError,
  formatChord,
  getChordTones,
  parseChord,
  parseChordOrThrow,
  type ChordAst,
} from './chord';
import { formatNote } from './pitch';

function tones(symbol: string): string[] {
  return getChordTones(parseChordOrThrow(symbol)).map((t) => formatNote(t.note));
}

function chord(symbol: string): ChordAst {
  return parseChordOrThrow(symbol);
}

describe('parseChord: roots, bass and qualities', () => {
  it.each<[string, string, string | null]>([
    ['C', 'C', null],
    ['F#m7b5', 'F#', null],
    ['Bbmaj7', 'Bb', null],
    ['G/B', 'G', 'B'],
    ['D/F#', 'D', 'F#'],
    ['B7/D#', 'B', 'D#'],
    ['E♭m', 'Eb', null],
    ['Cb', 'Cb', null],
    ['C6/9', 'C', null],
    ['C6/9/E', 'C', 'E'],
  ])('%s → root %s, bass %s', (symbol, root, bass) => {
    const c = chord(symbol);
    expect(formatNote(c.root)).toBe(root);
    expect(c.bass === null ? null : formatNote(c.bass)).toBe(bass);
  });

  it.each<[string, Partial<ChordAst>]>([
    ['C', { third: 'major', fifth: 'perfect', seventh: 'none' }],
    ['Am', { third: 'minor', fifth: 'perfect', seventh: 'none' }],
    ['A-7', { third: 'minor', seventh: 'minor' }],
    ['Bdim', { third: 'minor', fifth: 'diminished', seventh: 'none' }],
    ['B°7', { third: 'minor', fifth: 'diminished', seventh: 'diminished' }],
    ['Bdim7', { seventh: 'diminished' }],
    ['Bm7b5', { third: 'minor', fifth: 'diminished', seventh: 'minor' }],
    ['Bø7', { third: 'minor', fifth: 'diminished', seventh: 'minor' }],
    ['Caug', { third: 'major', fifth: 'augmented' }],
    ['C+', { fifth: 'augmented' }],
    ['G7', { third: 'major', seventh: 'minor' }],
    ['Cmaj7', { seventh: 'major' }],
    ['CM7', { seventh: 'major' }],
    ['CΔ7', { seventh: 'major' }],
    ['CΔ', { seventh: 'major' }],
    ['Cma9', { seventh: 'major', extension: 9 }],
    ['Cm(maj7)', { third: 'minor', seventh: 'major' }],
    ['CmMaj7', { third: 'minor', seventh: 'major' }],
    ['Gsus4', { third: 'sus4' }],
    ['Gsus', { third: 'sus4' }],
    ['Dsus2', { third: 'sus2' }],
    ['D7sus4', { third: 'sus4', seventh: 'minor' }],
    ['D9sus4', { third: 'sus4', seventh: 'minor', extension: 9 }],
    ['C6', { sixth: true }],
    ['E5', { third: 'none' }],
    ['C13', { seventh: 'minor', extension: 13 }],
    ['Cno3', { third: 'none' }],
  ])('%s has %o', (symbol, expected) => {
    expect(chord(symbol)).toMatchObject(expected);
  });
});

describe('getChordTones spells every tone from the root letter', () => {
  it.each<[string, string[]]>([
    ['C', ['C', 'E', 'G']],
    ['Am', ['A', 'C', 'E']],
    ['F#m7b5', ['F#', 'A', 'C', 'E']],
    ['Bbmaj7', ['Bb', 'D', 'F', 'A']],
    ['Cadd9', ['C', 'E', 'G', 'D']],
    ['Cmaj7', ['C', 'E', 'G', 'B']],
    ['G7', ['G', 'B', 'D', 'F']],
    ['B°7', ['B', 'D', 'F', 'Ab']],
    ['Caug', ['C', 'E', 'G#']],
    ['D7sus4', ['D', 'G', 'A', 'C']],
    ['Dsus2', ['D', 'E', 'A']],
    ['C6', ['C', 'E', 'G', 'A']],
    ['C6/9', ['C', 'E', 'G', 'A', 'D']],
    ['E5', ['E', 'B']],
    ['G7b9', ['G', 'B', 'D', 'F', 'Ab']],
    ['C7#9', ['C', 'E', 'G', 'Bb', 'D#']],
    ['C7(#11,b13)', ['C', 'E', 'G', 'Bb', 'F#', 'Ab']],
    ['Cm11', ['C', 'Eb', 'G', 'Bb', 'D', 'F']],
    ['C13', ['C', 'E', 'G', 'Bb', 'D', 'A']],
    ['Cb', ['Cb', 'Eb', 'Gb']],
    ['B#', ['B#', 'D##', 'F##']],
    ['Fbm', ['Fb', 'Abb', 'Cb']],
  ])('%s → %o', (symbol, expected) => {
    expect(tones(symbol)).toEqual(expected);
  });

  it('marks the natural fifth and implied 9th as optional', () => {
    const optional = getChordTones(chord('C13'))
      .filter((t) => t.optional)
      .map((t) => t.degree);
    expect(optional).toEqual([5, 9]);
    expect(getChordTones(chord('Bdim')).find((t) => t.degree === 5)?.optional).toBe(false);
  });
});

describe('parseChord: typed errors instead of guesses', () => {
  it.each<[string, string]>([
    ['H#??', 'INVALID_ROOT'],
    ['', 'EMPTY'],
    ['   ', 'EMPTY'],
    ['c', 'INVALID_ROOT'],
    ['Cbb', 'INVALID_ROOT'],
    ['C/H', 'INVALID_BASS'],
    ['C/', 'UNSUPPORTED_SUFFIX'],
    ['Cmaj', 'UNSUPPORTED_SUFFIX'],
    ['C7alt', 'UNSUPPORTED_SUFFIX'],
    ['Cxyz', 'UNSUPPORTED_SUFFIX'],
    ['C7(b9', 'UNSUPPORTED_SUFFIX'],
    ['Cmsus4', 'CONFLICTING_SUFFIX'],
    ['C5add9', 'CONFLICTING_SUFFIX'],
    ['C77', 'UNSUPPORTED_SUFFIX'],
    ['Caugb5', 'CONFLICTING_SUFFIX'],
    ['Cadd9add9', 'CONFLICTING_SUFFIX'],
    ['C' + 'add9'.repeat(10), 'TOO_LONG'],
  ])('%j → %s', (symbol, code) => {
    const result = parseChord(symbol);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(code);
      expect(result.error.input).toBe(symbol);
    }
  });

  it('parseChordOrThrow throws a typed error', () => {
    expect(() => parseChordOrThrow('H#??')).toThrow(UnsupportedChordError);
  });
});

describe('formatChord', () => {
  it.each(['C', 'F#m7b5', 'Bbmaj7', 'G/B', 'D9sus4', 'Cm(maj7)', 'C6/9/E', 'B7/D#', 'Bø7'])(
    'round-trips %s as written',
    (symbol) => {
      expect(formatChord(chord(symbol))).toBe(symbol);
    },
  );

  it('normalizes Unicode accidentals to ASCII by default and back on request', () => {
    expect(formatChord(chord('E♭m7♭5'))).toBe('Ebm7b5');
    expect(formatChord(chord('F#7#9/A#'), 'unicode')).toBe('F♯7♯9/A♯');
    expect(formatChord(chord('Bbm7b5'), 'unicode')).toBe('B♭m7♭5');
  });
});
