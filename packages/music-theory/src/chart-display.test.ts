import { describe, expect, it } from 'vitest';
import amazingGrace from '../../../fixtures/charts/pd-amazing-grace.chart.json';
import basic from '../../../fixtures/charts/demo-basic.chart.json';
import english from '../../../fixtures/charts/demo-english.chart.json';
import fullZh from '../../../fixtures/charts/demo-full-zh.chart.json';
import songbie from '../../../fixtures/charts/pd-songbie.chart.json';
import { changeCapo, transposeChartDisplay, type ChartDisplayOptions } from './chart-display';
import { parseChord } from './chord';
import { InvalidCapoError } from './transpose';

const FIXTURES = { basic, english, fullZh, songbie, amazingGrace };

const base: ChartDisplayOptions = {
  transposeSemitones: 0,
  capoFret: 0,
  show: 'shape',
  notation: 'letters',
};

describe('fixture coverage', () => {
  it.each(Object.entries(FIXTURES))('every chord in %s parses', (_name, chart) => {
    for (const section of chart.sections) {
      for (const line of section.lines) {
        for (const chord of line.chords) {
          expect(parseChord(chord.symbol), chord.symbol).toMatchObject({ ok: true });
        }
      }
    }
  });
});

describe('transposeChartDisplay', () => {
  it('transposes a slash chord, applies capo and leaves the chart unchanged', () => {
    const before = structuredClone(basic);
    const view = transposeChartDisplay(basic, { ...base, transposeSemitones: 2, capoFret: 2 });
    expect(view.keys).toEqual({ concert: 'C', sounding: 'D', shape: 'C' });
    expect(view.chords.ch_verse_2).toMatchObject({
      sounding: 'A/C#',
      shape: 'G/B',
      display: 'G/B',
    });
    expect(basic).toEqual(before);
  });

  it('shows sounding chords when asked', () => {
    const view = transposeChartDisplay(basic, {
      ...base,
      transposeSemitones: 2,
      capoFret: 2,
      show: 'sounding',
    });
    expect(view.chords.ch_verse_2?.display).toBe('A/C#');
  });

  it('numbers are relative to the key and invariant under transpose and capo', () => {
    const roman = transposeChartDisplay(fullZh, { ...base, notation: 'roman' });
    const moved = transposeChartDisplay(fullZh, {
      ...base,
      notation: 'roman',
      transposeSemitones: -3,
      capoFret: 4,
    });
    expect(roman.chords.fz_c011?.display).toBe('V/7');
    expect(roman.chords.fz_c022?.display).toBe('III7/#5');
    expect(roman.chords.fz_c051?.display).toBe('iiiø7');
    for (const id of Object.keys(roman.chords)) {
      expect(moved.chords[id]?.display).toBe(roman.chords[id]?.display);
    }
    const nashville = transposeChartDisplay(songbie, { ...base, notation: 'nashville' });
    expect(nashville.chords.sb_c33?.display).toBe('6m');
    expect(nashville.chords.sb_c23?.display).toBe('57');
  });

  it('reports numbering as unavailable when the key is unknown', () => {
    const noKey = { ...basic, concertKey: null };
    const view = transposeChartDisplay(noKey, {
      ...base,
      notation: 'roman',
      transposeSemitones: 2,
    });
    expect(view.numbering).toEqual({ available: false, reason: 'KEY_UNKNOWN' });
    expect(view.keys).toEqual({ concert: null, sounding: null, shape: null });
    expect(view.chords.ch_verse_2?.display).toBe('A/C#');
  });

  it('falls back transparently for unsupported chords', () => {
    const odd = structuredClone(basic);
    const chord = odd.sections[1]?.lines[0]?.chords[0];
    if (!chord) throw new Error('fixture changed');
    chord.symbol = 'C7alt';
    const view = transposeChartDisplay(odd, { ...base, transposeSemitones: 5 });
    expect(view.chords[chord.id]).toEqual({
      id: chord.id,
      original: 'C7alt',
      status: 'unsupported',
      display: 'C7alt',
      unsupportedReason: 'UNSUPPORTED_SUFFIX',
    });
  });

  it('maps a flat-key song to open shapes with capo', () => {
    const view = transposeChartDisplay(english, { ...base, capoFret: 3 });
    expect(view.keys.shape).toBe('G');
    expect(['en_c01', 'en_c02', 'en_c03', 'en_c04'].map((id) => view.chords[id]?.display)).toEqual([
      'G',
      'D/F#',
      'Em7',
      'Cmaj7',
    ]);
  });

  it('uses Unicode accidentals on request', () => {
    const view = transposeChartDisplay(english, { ...base, accidentals: 'unicode' });
    expect(view.keys.concert).toBe('B♭');
    expect(view.chords.en_c04?.display).toBe('E♭maj7');
  });

  it('validates options', () => {
    expect(() => transposeChartDisplay(basic, { ...base, capoFret: 13 })).toThrow(InvalidCapoError);
    expect(() => transposeChartDisplay(basic, { ...base, transposeSemitones: 0.5 })).toThrow(
      RangeError,
    );
  });
});

describe('changeCapo', () => {
  it('keep_pitch keeps the sounding key and changes shapes', () => {
    const next = changeCapo({ transposeSemitones: 0, capoFret: 0 }, 2, 'keep_pitch');
    expect(next).toEqual({ transposeSemitones: 0, capoFret: 2 });
    const view = transposeChartDisplay(basic, { ...base, ...next });
    expect(view.keys).toMatchObject({ sounding: 'C', shape: 'Bb' });
  });

  it('keep_shape keeps the fingered shapes and moves the sounding pitch', () => {
    const next = changeCapo({ transposeSemitones: 0, capoFret: 0 }, 2, 'keep_shape');
    expect(next).toEqual({ transposeSemitones: 2, capoFret: 2 });
    const view = transposeChartDisplay(basic, { ...base, ...next });
    expect(view.keys).toMatchObject({ sounding: 'D', shape: 'C' });
    expect(view.chords.ch_verse_2?.display).toBe('G/B');
  });
});
