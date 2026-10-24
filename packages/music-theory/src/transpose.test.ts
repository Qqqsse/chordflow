import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formatChord, getChordTones, parseChordOrThrow } from './chord';
import { parseKey, type KeyContext } from './key';
import { pitchClass } from './pitch';
import { InvalidCapoError, concertToShape, shapeToConcert, transposeChord } from './transpose';

function key(name: string): KeyContext {
  const k = parseKey(name);
  if (!k) throw new Error(`bad key ${name}`);
  return k;
}

const t = (symbol: string, n: number, keyName?: string) =>
  formatChord(transposeChord(parseChordOrThrow(symbol), n, keyName ? { key: key(keyName) } : {}));

describe('SPEC §5 required transposition cases', () => {
  it.each<[string, number, string]>([
    ['C', 2, 'D'],
    ['G/B', 2, 'A/C#'],
    ['F#m7b5', 2, 'G#m7b5'],
    ['Bbmaj7', 2, 'Cmaj7'],
    ['C/E', 2, 'D/F#'],
  ])('%s %+d → %s (no key context)', (symbol, n, expected) => {
    expect(t(symbol, n)).toBe(expected);
  });

  it.each<[string, number, string, string]>([
    ['C', 2, 'C', 'D'],
    ['G/B', 2, 'C', 'A/C#'],
    ['F#m7b5', 2, 'G', 'G#m7b5'],
    ['Bbmaj7', 2, 'F', 'Cmaj7'],
    ['C/E', 2, 'C', 'D/F#'],
  ])('%s %+d in key %s → %s', (symbol, n, keyName, expected) => {
    expect(t(symbol, n, keyName)).toBe(expected);
  });

  it('transposition by -12 keeps sounding pitch and spelling', () => {
    for (const symbol of ['C', 'F#m7b5', 'Bbmaj7', 'G/B', 'Ebm7', 'C#dim7']) {
      expect(t(symbol, -12)).toBe(symbol);
      expect(t(symbol, 12, 'C')).toBe(symbol);
    }
  });

  it('slash chords move root and bass together', () => {
    const moved = transposeChord(parseChordOrThrow('G/B'), 5);
    expect(formatChord(moved)).toBe('C/E');
    expect(moved.suffix).toBe('');
    expect(pitchClass(moved.bass ?? moved.root) - pitchClass(moved.root)).toBe(4);
  });
});

describe('contextual enharmonic spelling', () => {
  it('uses flats when moving into a flat key and sharps into a sharp key', () => {
    // C → Db (5 flats) rather than C# (7 sharps)
    expect(t('C', 1, 'C')).toBe('Db');
    expect(t('G/B', 1, 'C')).toBe('Ab/C');
    expect(t('Am', 1, 'C')).toBe('Bbm');
    // G → A (3 sharps): the vii° chord F#dim becomes G#dim
    expect(t('F#dim', 2, 'G')).toBe('G#dim');
    // F (1 flat) → Eb (3 flats)
    expect(t('Bb', -2, 'F')).toBe('Ab');
  });

  it('spells each chord root as the target key expects', () => {
    const progression = ['C', 'Am', 'F', 'G7', 'E7/G#', 'Bb'];
    expect(progression.map((s) => t(s, 3, 'C'))).toEqual(['Eb', 'Cm', 'Ab', 'Bb7', 'G7/B', 'Db']);
    expect(progression.map((s) => t(s, 4, 'C'))).toEqual(['E', 'C#m', 'A', 'B7', 'G#7/B#', 'D']);
  });

  it('avoids double accidentals and rare enharmonics outside the key', () => {
    expect(t('D#', 1)).toBe('E');
    expect(t('Bb', 1)).toBe('B');
    expect(t('A#', 1, 'F#')).toBe('B');
    // F# major genuinely uses E#
    expect(t('C#', -2, 'F#')).toBe('B');
    expect(t('D#m', 1, 'B')).toBe('Em');
  });

  it('keeps E# when the target key itself uses it', () => {
    // vii° of E moved to F# major is E#dim (F# major's seventh degree is E#)
    expect(t('D#dim', 2, 'E')).toBe('E#dim');
    // C → F# (6 sharps): the VII chord B lands on E#, the diatonic letter in F#
    expect(t('B', 6, 'C')).toBe('E#');
  });

  it('does not use rare enharmonics as chromatic spellings', () => {
    // bIII in Ab is written B, not Cb; bII is A, not Bbb
    expect(t('Eb', 8, 'G')).toBe('B');
    expect(t('C', 9, 'B')).toBe('A');
  });

  it('chooses the simpler tritone spelling without a key', () => {
    expect(t('C', 6)).toBe('F#');
    expect(t('F', 6)).toBe('B');
    expect(t('Bb', 6)).toBe('E');
  });

  it('rejects non-integer semitones', () => {
    expect(() => transposeChord(parseChordOrThrow('C'), 1.5)).toThrow(RangeError);
  });
});

describe('capo semantics', () => {
  it('concert D with capo 2 is a C shape', () => {
    expect(formatChord(concertToShape(parseChordOrThrow('D'), 2))).toBe('C');
    expect(formatChord(concertToShape(parseChordOrThrow('D'), 2, { key: key('D') }))).toBe('C');
  });

  it('C shape with capo 2 sounds D', () => {
    expect(formatChord(shapeToConcert(parseChordOrThrow('C'), 2))).toBe('D');
  });

  it('flat-key songs map to open shapes', () => {
    const concert = ['Eb', 'Cm', 'Ab', 'Bb7'];
    expect(
      concert.map((s) => formatChord(concertToShape(parseChordOrThrow(s), 3, { key: key('Eb') }))),
    ).toEqual(['C', 'Am', 'F', 'G7']);
  });

  it('capo 0 and capo 12 keep the chord', () => {
    expect(formatChord(concertToShape(parseChordOrThrow('F#m'), 0))).toBe('F#m');
    expect(formatChord(concertToShape(parseChordOrThrow('F#m'), 12))).toBe('F#m');
  });

  it.each([-1, 13, 2.5, Number.NaN])('rejects capo %s', (capo) => {
    expect(() => concertToShape(parseChordOrThrow('C'), capo)).toThrow(InvalidCapoError);
  });
});

const ROOTS = ['C', 'C#', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const SUFFIXES = ['', 'm', '7', 'm7', 'maj7', 'm7b5', 'dim7', 'sus4', 'add9', '6', '9', 'aug'];
const KEYS = [
  'C',
  'G',
  'D',
  'A',
  'E',
  'B',
  'F#',
  'F',
  'Bb',
  'Eb',
  'Ab',
  'Db',
  'Am',
  'Em',
  'Dm',
  'Cm',
];

const chordArb = fc
  .tuple(
    fc.constantFrom(...ROOTS),
    fc.constantFrom(...SUFFIXES),
    fc.option(fc.constantFrom(...ROOTS)),
  )
  .map(([root, suffix, bass]) => `${root}${suffix}${bass === null ? '' : `/${bass}`}`);

describe('transposition properties', () => {
  it('+n then −n restores the sounding pitch classes and suffix', () => {
    fc.assert(
      fc.property(
        chordArb,
        fc.integer({ min: -24, max: 24 }),
        fc.option(fc.constantFrom(...KEYS)),
        (symbol, n, k) => {
          const original = parseChordOrThrow(symbol);
          const options = k === null ? {} : { key: key(k) };
          const there = transposeChord(original, n, options);
          const back = transposeChord(there, -n);
          expect(pitchClass(back.root)).toBe(pitchClass(original.root));
          expect(back.bass === null ? null : pitchClass(back.bass)).toBe(
            original.bass === null ? null : pitchClass(original.bass),
          );
          expect(back.suffix).toBe(original.suffix);
        },
      ),
    );
  });

  it('every chord tone moves by exactly n semitones', () => {
    fc.assert(
      fc.property(
        chordArb,
        fc.integer({ min: -11, max: 11 }),
        fc.option(fc.constantFrom(...KEYS)),
        (symbol, n, k) => {
          const original = parseChordOrThrow(symbol);
          const moved = transposeChord(original, n, k === null ? {} : { key: key(k) });
          const before = getChordTones(original).map((x) => x.pitchClass);
          const after = getChordTones(moved).map((x) => x.pitchClass);
          expect(after).toEqual(before.map((pc) => (((pc + n) % 12) + 12) % 12));
        },
      ),
    );
  });

  it('never produces double accidentals or unparseable output', () => {
    fc.assert(
      fc.property(
        chordArb,
        fc.integer({ min: -11, max: 11 }),
        fc.option(fc.constantFrom(...KEYS)),
        (symbol, n, k) => {
          const moved = transposeChord(
            parseChordOrThrow(symbol),
            n,
            k === null ? {} : { key: key(k) },
          );
          expect(Math.abs(moved.root.accidental)).toBeLessThanOrEqual(1);
          expect(Math.abs(moved.bass?.accidental ?? 0)).toBeLessThanOrEqual(1);
          expect(formatChord(parseChordOrThrow(formatChord(moved)))).toBe(formatChord(moved));
        },
      ),
    );
  });

  it('parse → format round-trips supported symbols exactly', () => {
    fc.assert(
      fc.property(chordArb, (symbol) => {
        expect(formatChord(parseChordOrThrow(symbol))).toBe(symbol);
      }),
    );
  });
});
