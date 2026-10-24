'use client';

import type { ChartDocument } from '@chordflow/chart-schema';
import { transposeChartDisplay } from '@chordflow/music-theory';
import { useEffect, useMemo, useReducer, useRef } from 'react';
import { ChordSheet } from './chord-sheet';
import { ViewerControls } from './viewer-controls';
import { PagedSheet } from './paged-sheet';
import { PlayerBar } from './player-bar';
import { useAutoscroll } from './use-autoscroll';
import { VoicingStrip } from './voicing-strip';
import {
  DEFAULT_VIEWER_STATE,
  viewerReducer,
  type ViewerAction,
  type ViewerState,
} from './viewer-state';

/** Keyboard shortcuts; ignored while typing in a form field. */
export const VIEWER_SHORTCUTS: Readonly<Record<string, ViewerAction>> = {
  '+': { type: 'transpose', delta: 1 },
  '=': { type: 'transpose', delta: 1 },
  '-': { type: 'transpose', delta: -1 },
  '0': { type: 'resetTranspose' },
};

/** Autoscroll toggle key (handled separately because it is not a reducer action). */
export const AUTOSCROLL_KEY = 'p';

export function ChartViewer({
  chart,
  initialState = DEFAULT_VIEWER_STATE,
  onStateChange,
}: {
  chart: ChartDocument;
  /** e.g. the signed-in reader's saved preferences. */
  initialState?: ViewerState;
  /** Called after each change made by the reader (not for the initial state). */
  onStateChange?: (state: ViewerState) => void;
}) {
  const [state, dispatch] = useReducer(viewerReducer, initialState);
  const reported = useRef(state);
  useEffect(() => {
    if (reported.current === state) return;
    reported.current = state;
    onStateChange?.(state);
  }, [state, onStateChange]);
  const autoscroll = useAutoscroll(state.scrollSpeed);
  const { toggle: toggleAutoscroll } = autoscroll;
  const notation = chart.concertKey === null ? 'letters' : state.notation;
  const display = useMemo(
    () =>
      transposeChartDisplay(chart, {
        transposeSemitones: state.transposeSemitones,
        capoFret: state.capoFret,
        show: state.show,
        notation,
      }),
    [chart, state.transposeSemitones, state.capoFret, state.show, notation],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName))
      ) {
        return;
      }
      if (event.key === AUTOSCROLL_KEY) {
        event.preventDefault();
        toggleAutoscroll();
        return;
      }
      const action = VIEWER_SHORTCUTS[event.key];
      if (action) {
        event.preventDefault();
        dispatch(action);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [toggleAutoscroll]);

  const sheet = <ChordSheet chart={chart} display={display} fontSize={state.fontSize} />;

  return (
    <div className="space-y-6">
      <ViewerControls state={{ ...state, notation }} dispatch={dispatch} display={display} />
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-ink-muted">
          快捷鍵：+／− 移調、0 回原調、P 開始／暫停捲動；分頁模式用 ←／→ 翻頁。
        </p>
        <button
          type="button"
          className="min-h-11 rounded-md border border-border px-3 text-sm"
          aria-pressed={state.showDiagrams}
          onClick={() => {
            dispatch({ type: 'toggleDiagrams' });
          }}
        >
          指法圖
        </button>
      </div>
      {state.showDiagrams && (
        <VoicingStrip chart={chart} display={display} state={state} dispatch={dispatch} />
      )}
      <PlayerBar state={state} dispatch={dispatch} autoscroll={autoscroll} />
      {state.readingMode === 'pages' ? (
        <PagedSheet
          layoutKey={`${String(state.fontSize)}|${state.notation}|${String(state.transposeSemitones)}|${String(state.capoFret)}|${state.show}`}
        >
          {sheet}
        </PagedSheet>
      ) : (
        sheet
      )}
    </div>
  );
}
