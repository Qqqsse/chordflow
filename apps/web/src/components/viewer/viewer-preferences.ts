import {
  VIEWER_PREFERENCES_VERSION,
  ViewerPreferencesSchema,
  type ViewerPreferences,
} from '@chordflow/chart-schema';
import {
  DEFAULT_VIEWER_STATE,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  UI_CAPO_MAX,
  type ViewerState,
} from './viewer-state';

/* Mapping between the in-browser ViewerState and the stored UserChartPreference v1. */

export function toPreferences(state: ViewerState): ViewerPreferences {
  return {
    version: VIEWER_PREFERENCES_VERSION,
    transposeSemitones: state.transposeSemitones,
    capoFret: state.capoFret,
    capoMode: state.capoMode,
    show: state.show,
    notation: state.notation,
    fontSize: state.fontSize,
    voicingChoices: { ...state.voicingChoices },
    showDiagrams: state.showDiagrams,
    readingMode: state.readingMode,
    scrollSpeed: state.scrollSpeed,
  };
}

/** Restores a saved state; anything invalid falls back to the defaults, never to a guess. */
export function fromPreferences(value: unknown): ViewerState {
  const parsed = ViewerPreferencesSchema.safeParse(value);
  if (!parsed.success) return DEFAULT_VIEWER_STATE;
  const { version: _version, ...prefs } = parsed.data;
  return {
    ...prefs,
    // The UI offers a smaller range than the stored contract allows.
    capoFret: Math.min(prefs.capoFret, UI_CAPO_MAX),
    fontSize: Math.min(Math.max(prefs.fontSize, FONT_SIZE_MIN), FONT_SIZE_MAX),
  };
}
