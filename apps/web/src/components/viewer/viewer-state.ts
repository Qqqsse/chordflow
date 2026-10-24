import {
  changeCapo,
  type CapoMode,
  type ChordDisplayTarget,
  type ChordNotation,
} from '@chordflow/music-theory';

/**
 * Per-viewer display state (SPEC §4 ViewerState). Changing it never touches
 * the chart document or any RecordingSync.
 */
export interface ViewerState {
  transposeSemitones: number;
  capoFret: number;
  capoMode: CapoMode;
  show: ChordDisplayTarget;
  notation: ChordNotation;
  fontSize: number;
}

export const TRANSPOSE_MIN = -11;
export const TRANSPOSE_MAX = 11;
/** Useful UI subset; the theory layer accepts 0–12. */
export const UI_CAPO_MAX = 7;
export const FONT_SIZE_MIN = 14;
export const FONT_SIZE_MAX = 32;
export const FONT_SIZE_STEP = 2;

export const DEFAULT_VIEWER_STATE: ViewerState = {
  transposeSemitones: 0,
  capoFret: 0,
  capoMode: 'keep_pitch',
  show: 'shape',
  notation: 'letters',
  fontSize: 20,
};

export type ViewerAction =
  | { type: 'transpose'; delta: number }
  | { type: 'resetTranspose' }
  | { type: 'setCapo'; capoFret: number }
  | { type: 'setCapoMode'; capoMode: CapoMode }
  | { type: 'setShow'; show: ChordDisplayTarget }
  | { type: 'setNotation'; notation: ChordNotation }
  | { type: 'fontSize'; delta: number }
  | { type: 'reset' };

/** Keeps a semitone offset within −11…+11 (an octave is the same key). */
export function wrapTranspose(semitones: number): number {
  const m = ((semitones % 12) + 12) % 12;
  return m > 6 ? m - 12 : m;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function viewerReducer(state: ViewerState, action: ViewerAction): ViewerState {
  switch (action.type) {
    case 'transpose':
      return {
        ...state,
        transposeSemitones: clamp(
          state.transposeSemitones + action.delta,
          TRANSPOSE_MIN,
          TRANSPOSE_MAX,
        ),
      };
    case 'resetTranspose':
      return { ...state, transposeSemitones: 0 };
    case 'setCapo': {
      const capoFret = clamp(Math.round(action.capoFret), 0, UI_CAPO_MAX);
      const next = changeCapo(state, capoFret, state.capoMode);
      return { ...state, capoFret, transposeSemitones: wrapTranspose(next.transposeSemitones) };
    }
    case 'setCapoMode':
      return { ...state, capoMode: action.capoMode };
    case 'setShow':
      return { ...state, show: action.show };
    case 'setNotation':
      return { ...state, notation: action.notation };
    case 'fontSize':
      return {
        ...state,
        fontSize: clamp(state.fontSize + action.delta, FONT_SIZE_MIN, FONT_SIZE_MAX),
      };
    case 'reset':
      return { ...DEFAULT_VIEWER_STATE, fontSize: state.fontSize };
  }
}

/** Signed display such as `+2`, `0`, `−3`. */
export function formatSemitones(value: number): string {
  if (value > 0) return `+${value}`;
  if (value < 0) return `−${Math.abs(value)}`;
  return '0';
}
