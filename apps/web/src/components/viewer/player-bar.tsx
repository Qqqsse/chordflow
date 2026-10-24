'use client';

import type { Dispatch } from 'react';
import type { AutoscrollStatus } from './use-autoscroll';
import {
  SCROLL_SPEED_MAX,
  SCROLL_SPEED_MIN,
  type ViewerAction,
  type ViewerState,
} from './viewer-state';

const STATUS_TEXT: Readonly<Record<AutoscrollStatus, string>> = {
  idle: '自動捲動已停止',
  running: '自動捲動中',
  paused_by_user: '偵測到手動捲動，已暫停',
  finished: '已到結尾',
};

export function PlayerBar({
  state,
  dispatch,
  autoscroll,
}: {
  state: ViewerState;
  dispatch: Dispatch<ViewerAction>;
  autoscroll: {
    status: AutoscrollStatus;
    reducedMotion: boolean;
    toggle: () => void;
    stop: () => void;
  };
}) {
  const running = autoscroll.status === 'running';
  return (
    <div
      className="player-bar flex flex-wrap items-center gap-3 rounded-lg border border-border p-2"
      data-testid="player-bar"
    >
      <div
        role="group"
        aria-label="閱讀模式"
        className="inline-flex rounded-md border border-border"
      >
        {(
          [
            ['continuous', '連續捲動'],
            ['pages', '分頁'],
          ] as const
        ).map(([mode, label]) => (
          <button
            key={mode}
            type="button"
            aria-pressed={state.readingMode === mode}
            className="min-h-11 px-3 text-sm first:rounded-l-md last:rounded-r-md aria-pressed:bg-ink aria-pressed:text-surface"
            onClick={() => {
              autoscroll.stop();
              dispatch({ type: 'setReadingMode', readingMode: mode });
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {state.readingMode === 'continuous' && (
        <>
          <button
            type="button"
            className="min-h-11 rounded-md border border-border px-3 text-sm"
            aria-pressed={running}
            onClick={autoscroll.toggle}
          >
            {running ? '暫停捲動' : '開始捲動'}
          </button>
          <label className="flex items-center gap-2 text-sm">
            <span>速度</span>
            <input
              type="range"
              min={SCROLL_SPEED_MIN}
              max={SCROLL_SPEED_MAX}
              step={5}
              value={state.scrollSpeed}
              aria-valuetext={`每秒 ${state.scrollSpeed} 像素`}
              onChange={(event) => {
                dispatch({ type: 'setScrollSpeed', scrollSpeed: Number(event.target.value) });
              }}
            />
          </label>
          <span
            className="text-xs text-ink-muted"
            aria-live="polite"
            data-testid="autoscroll-status"
          >
            {STATUS_TEXT[autoscroll.status]}
            {autoscroll.reducedMotion && '（減少動態：分段翻頁）'}
          </span>
        </>
      )}
    </div>
  );
}
