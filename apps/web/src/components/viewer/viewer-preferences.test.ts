import { ViewerPreferencesSchema } from '@chordflow/chart-schema';
import { describe, expect, it } from 'vitest';
import { fromPreferences, toPreferences } from './viewer-preferences';
import { DEFAULT_VIEWER_STATE, viewerReducer, type ViewerState } from './viewer-state';

describe('viewer preferences mapping', () => {
  it('round-trips every ViewerState field through the stored contract', () => {
    let state: ViewerState = DEFAULT_VIEWER_STATE;
    for (const action of [
      { type: 'transpose', delta: 3 },
      { type: 'setCapo', capoFret: 2 },
      { type: 'setCapoMode', capoMode: 'keep_shape' },
      { type: 'setShow', show: 'sounding' },
      { type: 'setNotation', notation: 'roman' },
      { type: 'fontSize', delta: 4 },
      { type: 'chooseVoicing', symbol: 'G', voicingId: 'v_320003' },
      { type: 'toggleDiagrams' },
      { type: 'setReadingMode', readingMode: 'pages' },
      { type: 'setScrollSpeed', scrollSpeed: 60 },
    ] as const) {
      state = viewerReducer(state, action);
    }
    const stored = toPreferences(state);
    expect(ViewerPreferencesSchema.parse(stored)).toEqual(stored);
    expect(fromPreferences(stored)).toEqual(state);
    // Every state field is persisted (a new field must be added to the contract too).
    expect(Object.keys(stored).sort()).toEqual([...Object.keys(state), 'version'].sort());
  });

  it('falls back to defaults for invalid or foreign data', () => {
    expect(fromPreferences(null)).toEqual(DEFAULT_VIEWER_STATE);
    expect(fromPreferences({ version: 2 })).toEqual(DEFAULT_VIEWER_STATE);
    expect(fromPreferences({ ...toPreferences(DEFAULT_VIEWER_STATE), fontSize: 99 })).toEqual(
      DEFAULT_VIEWER_STATE,
    );
  });

  it('clamps a stored capo above the UI range', () => {
    const stored = { ...toPreferences(DEFAULT_VIEWER_STATE), capoFret: 11 };
    expect(fromPreferences(stored).capoFret).toBe(7);
  });
});
