'use client';

import type { ChartDocument } from '@chordflow/chart-schema';
import { difficultyOf, resolveVoicing, type VoicingDifficulty } from '@chordflow/guitar-voicings';
import { parseChord, type ChartDisplay } from '@chordflow/music-theory';
import type { Dispatch } from 'react';
import { ChordDiagram } from './chord-diagram';
import type { ViewerAction, ViewerState } from './viewer-state';

const DIFFICULTY_LABEL: Readonly<Record<VoicingDifficulty, string>> = {
  easy: '簡單',
  intermediate: '中等',
  advanced: '進階',
};

/** Shape chords in first-appearance order (what the player fingers). */
export function uniqueShapes(chart: ChartDocument, display: ChartDisplay): string[] {
  const seen = new Set<string>();
  for (const section of chart.sections) {
    for (const line of section.lines) {
      for (const chord of line.chords) {
        const shown = display.chords[chord.id];
        const symbol = shown?.status === 'ok' ? shown.shape : shown?.original;
        if (symbol !== undefined) seen.add(symbol);
      }
    }
  }
  return [...seen];
}

export function VoicingStrip({
  chart,
  display,
  state,
  dispatch,
}: {
  chart: ChartDocument;
  display: ChartDisplay;
  state: ViewerState;
  dispatch: Dispatch<ViewerAction>;
}) {
  // Chart defaults are written for the concert chords; they apply only when shapes equal them.
  const untransposed = state.transposeSemitones === 0 && state.capoFret === 0;
  const policy = untransposed ? chart.voicingPolicy : { occurrenceOverrides: {} };
  const preferredDifficulty = chart.voicingPolicy.defaultDifficulty;

  return (
    <section aria-label="和弦指法圖" className="voicing-strip" data-testid="voicing-strip">
      <ul className="flex flex-wrap gap-3">
        {uniqueShapes(chart, display).map((symbol) => {
          const parsed = parseChord(symbol);
          const resolved = parsed.ok
            ? resolveVoicing(parsed.chord, '', symbol, policy, {
                tuning: chart.instrument.tuning,
                preferredDifficulty,
                userChoice: state.voicingChoices[symbol] ?? null,
              })
            : null;
          const ranked = resolved?.ranked ?? [];
          const selected = resolved?.selected ?? null;
          const index = selected
            ? ranked.findIndex((r) => r.voicing.id === selected.voicing.id)
            : -1;
          const choose = (step: number) => {
            const next = ranked[(index + step + ranked.length) % ranked.length];
            if (next) dispatch({ type: 'chooseVoicing', symbol, voicingId: next.voicing.id });
          };
          return (
            <li key={symbol} className="voicing-card" data-symbol={symbol}>
              <p className="text-center font-semibold">{symbol}</p>
              {selected ? (
                <>
                  <ChordDiagram symbol={symbol} voicing={selected.voicing} />
                  <p className="text-center text-xs text-ink-muted">
                    {selected.voicing.label ?? DIFFICULTY_LABEL[difficultyOf(selected.voicing)]}
                    {ranked.length > 1 && ` · ${index + 1}/${ranked.length}`}
                  </p>
                  {ranked.length > 1 && (
                    <div className="flex justify-center gap-1">
                      <button
                        type="button"
                        className="min-h-9 min-w-9 rounded border border-border text-sm"
                        aria-label={`${symbol} 上一個指法`}
                        onClick={() => {
                          choose(-1);
                        }}
                      >
                        ‹
                      </button>
                      <button
                        type="button"
                        className="min-h-9 min-w-9 rounded border border-border text-sm"
                        aria-label={`${symbol} 下一個指法`}
                        onClick={() => {
                          choose(1);
                        }}
                      >
                        ›
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <p className="voicing-missing text-xs text-ink-muted" role="note">
                  {parsed.ok ? '沒有已驗證的指法' : '無法解析此和弦'}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
