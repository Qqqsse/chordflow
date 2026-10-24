import { describe, expect, it } from 'vitest';
import { parseChordOrThrow } from './chord';
import {
  chooseEnharmonicSpelling,
  getScaleContext,
  parseKey,
  transposeKey,
  type KeyContext,
} from './key';
import { renderNashvilleNumber, renderRomanNumeral } from './numbering';
import { formatNote } from './pitch';

function key(name: string): KeyContext {
  const k = parseKey(name);
  if (!k) throw new Error(`bad key ${name}`);
  return k;
}

const roman = (symbol: string, k: string) =>
  renderRomanNumeral(parseChordOrThrow(symbol), key(k)).text;
const nashville = (symbol: string, k: string) =>
  renderNashvilleNumber(parseChordOrThrow(symbol), key(k)).text;

describe('Roman numerals (SPEC §5)', () => {
  it('Am in C major is vi', () => {
    expect(roman('Am', 'C')).toBe('vi');
  });

  it.each<[string, string, string]>([
    ['C', 'C', 'I'],
    ['Dm7', 'C', 'ii7'],
    ['Em', 'C', 'iii'],
    ['Fmaj7', 'C', 'IVmaj7'],
    ['G7', 'C', 'V7'],
    ['G7sus4', 'C', 'V7sus4'],
    ['Bdim', 'C', 'vii°'],
    ['Bm7b5', 'C', 'viiø7'],
    ['Bø7', 'C', 'viiø7'],
    ['B°7', 'C', 'vii°7'],
    ['Bb', 'C', 'bVII'],
    ['Ab', 'C', 'bVI'],
    ['Eb', 'C', 'bIII'],
    ['F#dim', 'C', '#iv°'],
    ['E7', 'C', 'III7'],
    ['Caug', 'C', 'I+'],
    ['Cadd9', 'C', 'Iadd9'],
    ['G/B', 'C', 'V/7'],
    ['C/E', 'C', 'I/3'],
    ['F/G', 'C', 'IV/5'],
    ['C/Bb', 'C', 'I/b7'],
    ['D/F#', 'G', 'V/7'],
    ['Am', 'Am', 'i'],
    ['E7', 'Am', 'V7'],
    ['Dm', 'Am', 'iv'],
    ['G', 'Am', 'VII'],
    ['G#dim', 'Am', '#vii°'],
    ['Eb', 'Bb', 'IV'],
    ['A', 'D', 'V'],
    ['C#m7b5', 'D', 'viiø7'],
  ])('%s in %s → %s', (symbol, k, expected) => {
    expect(roman(symbol, k)).toBe(expected);
  });

  it('degree comes from letters, not quality', () => {
    // D# and Eb sound the same, but are different degrees in C
    expect(roman('D#dim', 'C')).toBe('#ii°');
    expect(roman('Eb', 'C')).toBe('bIII');
  });

  it('exposes structured parts for superscript rendering', () => {
    expect(renderRomanNumeral(parseChordOrThrow('Bbmaj7/D'), key('C'))).toMatchObject({
      accidental: 'b',
      degree: 7,
      numeral: 'VII',
      quality: '',
      suffix: 'maj7',
      bass: '2',
    });
  });
});

describe('Nashville numbers', () => {
  it.each<[string, string, string]>([
    ['C', 'C', '1'],
    ['Am', 'C', '6m'],
    ['Am7', 'C', '6m7'],
    ['G7', 'C', '57'],
    ['G/B', 'C', '5/7'],
    ['Bb', 'C', 'b7'],
    ['Bdim', 'C', '7°'],
    ['Bm7b5', 'C', '7ø7'],
    ['Dsus4', 'G', '5sus4'],
    ['Em', 'Em', '1m'],
    ['B7', 'Em', '57'],
  ])('%s in %s → %s', (symbol, k, expected) => {
    expect(nashville(symbol, k)).toBe(expected);
  });
});

describe('keys and enharmonic choice', () => {
  it('parses and rejects key names', () => {
    expect(parseKey('F#m')).toEqual({ tonic: { letter: 'F', accidental: 1 }, mode: 'minor' });
    expect(parseKey('B♭')).toEqual({ tonic: { letter: 'B', accidental: -1 }, mode: 'major' });
    expect(parseKey('H')).toBeNull();
    expect(parseKey('Cmaj')).toBeNull();
    expect(parseKey('Cbb')).toBeNull();
  });

  it('reports scale and signature', () => {
    expect(getScaleContext(key('D')).scale.map((n) => formatNote(n))).toEqual([
      'D',
      'E',
      'F#',
      'G',
      'A',
      'B',
      'C#',
    ]);
    expect(getScaleContext(key('Eb')).signature).toBe(-3);
    expect(getScaleContext(key('Em')).prefers).toBe('sharp');
    expect(getScaleContext(key('Am')).prefers).toBe('neutral');
  });

  it.each<[number, string, string]>([
    [10, 'F', 'Bb'],
    [10, 'E', 'A#'],
    [1, 'D', 'C#'],
    [1, 'Ab', 'Db'],
    [6, 'C', 'F#'],
    [8, 'Am', 'G#'],
    [3, 'C', 'Eb'],
    [3, 'E', 'D#'],
  ])('pitch class %i in %s is %s', (pc, k, expected) => {
    expect(formatNote(chooseEnharmonicSpelling(pc, { key: key(k) }))).toBe(expected);
  });

  it('honours an explicit sharp/flat preference without a key', () => {
    expect(formatNote(chooseEnharmonicSpelling(1, { prefer: 'sharp' }))).toBe('C#');
    expect(formatNote(chooseEnharmonicSpelling(1, { prefer: 'flat' }))).toBe('Db');
    expect(formatNote(chooseEnharmonicSpelling(4, { prefer: 'flat' }))).toBe('E');
  });

  it.each<[string, number, string]>([
    ['C', 1, 'Db'],
    ['C', 6, 'F#'],
    ['Am', 6, 'Ebm'],
    ['G', 1, 'Ab'],
    ['E', 1, 'F'],
    ['D', -2, 'C'],
    ['Eb', -3, 'C'],
    ['Bbm', 2, 'Cm'],
  ])('key %s %+d → %s', (k, n, expected) => {
    const result = transposeKey(key(k), n).key;
    expect(`${formatNote(result.tonic)}${result.mode === 'minor' ? 'm' : ''}`).toBe(expected);
  });
});
