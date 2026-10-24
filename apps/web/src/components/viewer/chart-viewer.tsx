'use client';

import type { ChartDocument } from '@chordflow/chart-schema';
import { transposeChartDisplay } from '@chordflow/music-theory';
import { useEffect, useMemo, useReducer } from 'react';
import { ChordSheet } from './chord-sheet';
import { ViewerControls } from './viewer-controls';
import { VoicingStrip } from './voicing-strip';
import { DEFAULT_VIEWER_STATE, viewerReducer, type ViewerAction } from './viewer-state';

/** Keyboard shortcuts; ignored while typing in a form field. */
export const VIEWER_SHORTCUTS: Readonly<Record<string, ViewerAction>> = {
  '+': { type: 'transpose', delta: 1 },
  '=': { type: 'transpose', delta: 1 },
  '-': { type: 'transpose', delta: -1 },
  '0': { type: 'resetTranspose' },
};

export function ChartViewer({ chart }: { chart: ChartDocument }) {
  const [state, dispatch] = useReducer(viewerReducer, DEFAULT_VIEWER_STATE);
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
  }, []);

  return (
    <div className="space-y-6">
      <ViewerControls state={{ ...state, notation }} dispatch={dispatch} display={display} />
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-ink-muted">快捷鍵：+／− 移調、0 回原調。</p>
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
      <ChordSheet chart={chart} display={display} fontSize={state.fontSize} />
    </div>
  );
}
