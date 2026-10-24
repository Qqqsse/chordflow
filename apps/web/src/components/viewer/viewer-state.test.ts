import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VIEWER_STATE,
  FONT_SIZE_MAX,
  formatSemitones,
  viewerReducer,
  wrapTranspose,
  type ViewerState,
} from './viewer-state';

const s = (patch: Partial<ViewerState> = {}): ViewerState => ({
  ...DEFAULT_VIEWER_STATE,
  ...patch,
});

describe('viewerReducer', () => {
  it('transposes within −11…+11', () => {
    expect(viewerReducer(s(), { type: 'transpose', delta: 2 }).transposeSemitones).toBe(2);
    expect(
      viewerReducer(s({ transposeSemitones: 11 }), { type: 'transpose', delta: 1 })
        .transposeSemitones,
    ).toBe(11);
    expect(
      viewerReducer(s({ transposeSemitones: -11 }), { type: 'transpose', delta: -1 })
        .transposeSemitones,
    ).toBe(-11);
  });

  it('keep_pitch capo changes only the capo', () => {
    const next = viewerReducer(s(), { type: 'setCapo', capoFret: 3 });
    expect(next).toMatchObject({ capoFret: 3, transposeSemitones: 0 });
  });

  it('keep_shape capo moves the sounding pitch with the capo', () => {
    const next = viewerReducer(s({ capoMode: 'keep_shape' }), { type: 'setCapo', capoFret: 3 });
    expect(next).toMatchObject({ capoFret: 3, transposeSemitones: 3 });
    const back = viewerReducer(next, { type: 'setCapo', capoFret: 1 });
    expect(back).toMatchObject({ capoFret: 1, transposeSemitones: 1 });
  });

  it('clamps capo to the UI range', () => {
    expect(viewerReducer(s(), { type: 'setCapo', capoFret: 12 }).capoFret).toBe(7);
    expect(viewerReducer(s(), { type: 'setCapo', capoFret: -2 }).capoFret).toBe(0);
  });

  it('clamps font size and keeps it on reset', () => {
    const big = viewerReducer(s({ fontSize: FONT_SIZE_MAX }), { type: 'fontSize', delta: 2 });
    expect(big.fontSize).toBe(FONT_SIZE_MAX);
    const reset = viewerReducer(s({ fontSize: 26, transposeSemitones: 4, capoFret: 2 }), {
      type: 'reset',
    });
    expect(reset).toEqual({ ...DEFAULT_VIEWER_STATE, fontSize: 26 });
  });

  it('switches notation and displayed target', () => {
    expect(viewerReducer(s(), { type: 'setNotation', notation: 'roman' }).notation).toBe('roman');
    expect(viewerReducer(s(), { type: 'setShow', show: 'sounding' }).show).toBe('sounding');
  });
});

describe('helpers', () => {
  it.each([
    [0, 0],
    [7, -5],
    [12, 0],
    [-7, 5],
    [6, 6],
    [-6, 6],
    [13, 1],
  ])('wrapTranspose(%i) = %i', (input, expected) => {
    expect(wrapTranspose(input)).toBe(expected);
  });

  it('formats signed semitones', () => {
    expect([formatSemitones(2), formatSemitones(0), formatSemitones(-3)]).toEqual([
      '+2',
      '0',
      '−3',
    ]);
  });
});
