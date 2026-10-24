'use client';

import type { ChartDisplay, ChordNotation } from '@chordflow/music-theory';
import type { Dispatch, ReactNode } from 'react';
import {
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  FONT_SIZE_STEP,
  TRANSPOSE_MAX,
  TRANSPOSE_MIN,
  UI_CAPO_MAX,
  formatSemitones,
  type ViewerAction,
  type ViewerState,
} from './viewer-state';

const button =
  'inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-border px-3 text-sm font-medium hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-ink-muted">{label}</span>
      {children}
    </div>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <Group label={label}>
      <div className="inline-flex rounded-md border border-border">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            disabled={disabled}
            onClick={() => {
              onChange(option.value);
            }}
            className="min-h-11 px-3 text-sm first:rounded-l-md last:rounded-r-md aria-pressed:bg-ink aria-pressed:text-surface disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-accent"
          >
            {option.label}
          </button>
        ))}
      </div>
    </Group>
  );
}

const NOTATIONS: readonly { value: ChordNotation; label: string }[] = [
  { value: 'letters', label: '和弦' },
  { value: 'roman', label: '羅馬級數' },
  { value: 'nashville', label: 'Nashville' },
];

export function ViewerControls({
  state,
  dispatch,
  display,
}: {
  state: ViewerState;
  dispatch: Dispatch<ViewerAction>;
  display: ChartDisplay;
}) {
  const numberingAvailable = display.numbering.available;
  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-border p-3"
      data-testid="viewer-controls"
    >
      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-live="polite">
        <div className="flex gap-1">
          <dt className="text-ink-muted">原調</dt>
          <dd className="font-medium" data-testid="key-concert">
            {display.keys.concert ?? '未知'}
          </dd>
        </div>
        <div className="flex gap-1">
          <dt className="text-ink-muted">實際發聲</dt>
          <dd className="font-medium" data-testid="key-sounding">
            {display.keys.sounding ?? '—'}
          </dd>
        </div>
        <div className="flex gap-1">
          <dt className="text-ink-muted">按法調</dt>
          <dd className="font-medium" data-testid="key-shape">
            {display.keys.shape ?? '—'}
          </dd>
        </div>
      </dl>

      <div className="flex flex-wrap gap-x-6 gap-y-3">
        <Group label="移調">
          <button
            type="button"
            className={button}
            aria-label="降半音"
            disabled={state.transposeSemitones <= TRANSPOSE_MIN}
            onClick={() => {
              dispatch({ type: 'transpose', delta: -1 });
            }}
          >
            −
          </button>
          <output
            className="min-w-10 text-center font-medium tabular-nums"
            data-testid="transpose-value"
          >
            {formatSemitones(state.transposeSemitones)}
          </output>
          <button
            type="button"
            className={button}
            aria-label="升半音"
            disabled={state.transposeSemitones >= TRANSPOSE_MAX}
            onClick={() => {
              dispatch({ type: 'transpose', delta: 1 });
            }}
          >
            +
          </button>
          <button
            type="button"
            className={button}
            disabled={state.transposeSemitones === 0}
            onClick={() => {
              dispatch({ type: 'resetTranspose' });
            }}
          >
            回原調
          </button>
        </Group>

        <Group label="移調夾">
          <label className="sr-only" htmlFor="capo-select">
            移調夾格數
          </label>
          <select
            id="capo-select"
            className="min-h-11 rounded-md border border-border bg-surface px-2 text-sm"
            value={state.capoFret}
            onChange={(event) => {
              dispatch({ type: 'setCapo', capoFret: Number(event.target.value) });
            }}
          >
            {Array.from({ length: UI_CAPO_MAX + 1 }, (_, fret) => (
              <option key={fret} value={fret}>
                {fret === 0 ? '不夾' : `第 ${fret} 格`}
              </option>
            ))}
          </select>
        </Group>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-3">
        <Segmented
          label="記譜"
          value={numberingAvailable ? state.notation : 'letters'}
          options={NOTATIONS}
          onChange={(notation) => {
            dispatch({ type: 'setNotation', notation });
          }}
          disabled={!numberingAvailable}
        />
        <Group label="字級">
          <button
            type="button"
            className={button}
            aria-label="縮小字級"
            disabled={state.fontSize <= FONT_SIZE_MIN}
            onClick={() => {
              dispatch({ type: 'fontSize', delta: -FONT_SIZE_STEP });
            }}
          >
            A−
          </button>
          <button
            type="button"
            className={button}
            aria-label="放大字級"
            disabled={state.fontSize >= FONT_SIZE_MAX}
            onClick={() => {
              dispatch({ type: 'fontSize', delta: FONT_SIZE_STEP });
            }}
          >
            A+
          </button>
        </Group>
      </div>

      <details className="group">
        <summary className="min-h-11 cursor-pointer content-center text-sm font-medium">
          進階設定
        </summary>
        <div className="mt-2 flex flex-col gap-3">
          <Segmented
            label="換移調夾時"
            value={state.capoMode}
            options={[
              { value: 'keep_pitch', label: '保持音高' },
              { value: 'keep_shape', label: '保持按法' },
            ]}
            onChange={(capoMode) => {
              dispatch({ type: 'setCapoMode', capoMode });
            }}
          />
          <p className="text-xs text-ink-muted">
            保持音高：聲音不變，按法跟著移調夾改變。保持按法：按法不變，聲音跟著移調夾改變。
          </p>
          <Segmented
            label="顯示"
            value={state.show}
            options={[
              { value: 'shape', label: '按法' },
              { value: 'sounding', label: '實際音' },
            ]}
            onChange={(show) => {
              dispatch({ type: 'setShow', show });
            }}
            disabled={state.notation !== 'letters'}
          />
          <div>
            <button
              type="button"
              className={button}
              onClick={() => {
                dispatch({ type: 'reset' });
              }}
            >
              全部重設
            </button>
          </div>
        </div>
      </details>
      {!numberingAvailable && (
        <p className="text-xs text-ink-muted" role="note">
          這份譜沒有標示調性，無法顯示級數。
        </p>
      )}
    </div>
  );
}
