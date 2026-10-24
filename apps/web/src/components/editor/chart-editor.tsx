'use client';

import {
  SECTION_KINDS,
  splitGraphemes,
  validateChartDocument,
  type ChartDocument,
  type ChartLine,
} from '@chordflow/chart-schema';
import { transposeChartDisplay } from '@chordflow/music-theory';
import { useEffect, useReducer, useState } from 'react';
import { sectionLabel } from '@/components/section-label';
import { ChordSheet } from '@/components/viewer/chord-sheet';
import { getJson, postJson } from '@/lib/api/client';
import { createEditorState, editorReducer, type EditorAction } from './editor-state';

interface Base {
  id: string;
  revision: number;
  document: ChartDocument;
}

const chip = 'min-h-9 rounded border px-2 font-mono text-sm';

function LineEditor({
  line,
  section,
  index,
  selected,
  dispatch,
  pendingSymbol,
}: {
  line: ChartLine;
  section: number;
  index: number;
  selected: number | null;
  dispatch: (action: EditorAction) => void;
  pendingSymbol: string;
}) {
  const place = (offset: number | null) => {
    if (selected !== null || pendingSymbol.trim() === '') {
      dispatch({ type: 'moveSelected', section, line: index, offset });
    } else {
      dispatch({ type: 'add', section, line: index, offset, symbol: pendingSymbol });
    }
  };
  const chordButton = (chordIndex: number) => {
    const chord = line.chords[chordIndex];
    if (chord === undefined) return null;
    const isSelected = selected === chordIndex;
    return (
      <button
        key={chord.id}
        type="button"
        aria-pressed={isSelected}
        className={`${chip} ${isSelected ? 'border-ink bg-ink text-surface' : 'border-border'}`}
        onClick={() => {
          dispatch(
            isSelected
              ? { type: 'clearSelection' }
              : { type: 'select', section, line: index, chord: chordIndex },
          );
        }}
      >
        {chord.symbol}
      </button>
    );
  };

  if (line.text === '') {
    return (
      <div className="flex flex-wrap items-center gap-1" data-testid="editor-line">
        <span className="text-xs text-ink-muted">（只有和弦）</span>
        {line.chords.map((_, i) => chordButton(i))}
        <button
          type="button"
          className={`${chip} border-dashed border-border`}
          onClick={() => {
            place(null);
          }}
        >
          放到這行
        </button>
      </div>
    );
  }
  const graphemes = splitGraphemes(line.text);
  const byOffset = new Map<number, number[]>();
  line.chords.forEach((c, i) => {
    if (c.anchor === null) return;
    byOffset.set(c.anchor.graphemeOffset, [...(byOffset.get(c.anchor.graphemeOffset) ?? []), i]);
  });
  return (
    <div className="flex flex-wrap items-end gap-y-2" data-testid="editor-line">
      {[...graphemes, ''].map((g, offset) => (
        <span key={offset} className="inline-flex flex-col items-start">
          <span className="flex min-h-9 gap-0.5">
            {(byOffset.get(offset) ?? []).map(chordButton)}
          </span>
          <button
            type="button"
            aria-label={`第 ${String(index + 1)} 行 ${g === '' ? '行尾' : `「${g}」前`}`}
            className="min-h-9 min-w-6 rounded px-0.5 text-lg hover:bg-surface-muted"
            onClick={() => {
              place(offset);
            }}
          >
            {g === '' ? '⏎' : g === ' ' ? ' ' : g}
          </button>
        </span>
      ))}
    </div>
  );
}

/**
 * Edits chord positions, chord names and sections of the newest revision and
 * saves the result as a new revision (old revisions are never changed).
 */
export function ChartEditor({ arrangementId }: { arrangementId: string }) {
  const [base, setBase] = useState<Base | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const url = `/api/v1/arrangements/${arrangementId}`;
    void getJson<{ revisions: { id: string; revision: number }[] }>(url)
      .then(async (detail) => {
        const newest = [...(detail.data?.revisions ?? [])].sort(
          (a, b) => b.revision - a.revision,
        )[0];
        if (newest === undefined) return null;
        const full = await getJson<{ document: ChartDocument }>(
          `${url}/revisions/${String(newest.revision)}`,
        );
        return full.data === null ? null : { ...newest, document: full.data.document };
      })
      .then((found) => {
        if (found === null) {
          setMessage('這份編曲還沒有任何修訂可以編輯。');
          return;
        }
        setBase(found);
      });
  }, [arrangementId]);

  if (base === null) return <p role="status">{message ?? '載入中…'}</p>;
  return <EditorBody arrangementId={arrangementId} base={base} />;
}

function EditorBody({ arrangementId, base }: { arrangementId: string; base: Base }) {
  const [state, dispatch] = useReducer(editorReducer, base.document, createEditorState);
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ id: string; revision: number } | null>(null);
  const [pendingSymbol, setPendingSymbol] = useState('');
  const [rename, setRename] = useState('');

  const save = async () => {
    const check = validateChartDocument(state.doc);
    if (!check.ok) {
      setMessage(`無法儲存：${check.issues[0]?.message ?? '內容不正確'}`);
      return;
    }
    const reply = await postJson<{ id: string; revision: number }>(
      `/api/v1/arrangements/${arrangementId}/revisions`,
      {
        document: state.doc,
        parentRevisionId: saved?.id ?? base.id,
        expectedLatestRevision: saved?.revision ?? base.revision,
      },
    );
    if (reply.data === null) {
      setMessage(
        reply.error?.code === 'REVISION_CONFLICT'
          ? '有人在你之後儲存了新版本，請重新載入頁面再編輯。'
          : (reply.error?.message ?? '儲存失敗'),
      );
      return;
    }
    setSaved(reply.data);
    dispatch({ type: 'reset', doc: state.doc });
    setMessage(`已儲存為第 ${String(reply.data.revision)} 版（草稿，尚未發布）。`);
  };

  const publish = async () => {
    if (saved === null) return;
    const reply = await postJson(`/api/v1/arrangements/${arrangementId}/publish`, {
      revisionId: saved.id,
    });
    setMessage(
      reply.error === null ? `已發布第 ${String(saved.revision)} 版。` : reply.error.message,
    );
  };

  const selected = state.selected;
  const selectedChord =
    selected === null
      ? undefined
      : state.doc.sections[selected.section]?.lines[selected.line]?.chords[selected.chord];

  return (
    <div className="space-y-6">
      <p className="text-sm text-ink-muted">
        以第 {base.revision} 版為基礎。點和弦選取，再點歌詞中的字，就會把和弦移到那個字前面；
        沒有選取時，先在「新增和弦」輸入名稱再點位置。儲存會建立新的修訂，舊版本不會被改動。
      </p>

      <div className="sticky top-0 z-10 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-3 text-sm">
        <label className="space-y-1">
          <span className="block">新增和弦</span>
          <input
            value={pendingSymbol}
            onChange={(e) => {
              setPendingSymbol(e.target.value);
            }}
            maxLength={32}
            placeholder="例如 Am7"
            className="min-h-11 w-28 rounded-md border border-border bg-surface px-2 font-mono"
          />
        </label>
        {selectedChord !== undefined && (
          <>
            <label className="space-y-1">
              <span className="block">選取的和弦：{selectedChord.symbol}，改為</span>
              <input
                value={rename}
                onChange={(e) => {
                  setRename(e.target.value);
                }}
                maxLength={32}
                className="min-h-11 w-28 rounded-md border border-border bg-surface px-2 font-mono"
              />
            </label>
            <button
              type="button"
              className="min-h-11 rounded-md border border-border px-3"
              onClick={() => {
                dispatch({ type: 'renameSelected', symbol: rename });
              }}
            >
              改名
            </button>
            <button
              type="button"
              className="min-h-11 rounded-md border border-border px-3"
              onClick={() => {
                dispatch({ type: 'removeSelected' });
              }}
            >
              刪除和弦
            </button>
          </>
        )}
        <button
          type="button"
          disabled={!state.dirty}
          className="ms-auto min-h-11 rounded-md bg-ink px-4 font-medium text-surface disabled:opacity-50"
          onClick={() => void save()}
        >
          儲存為新修訂
        </button>
        {saved !== null && !state.dirty && (
          <button
            type="button"
            className="min-h-11 rounded-md border border-border px-3"
            onClick={() => void publish()}
          >
            發布第 {saved.revision} 版
          </button>
        )}
      </div>
      {state.error !== null && <p role="alert">{state.error}</p>}
      {message !== null && <p role="status">{message}</p>}

      {state.doc.sections.map((section, si) => (
        <section
          key={section.id}
          aria-label={`段落 ${String(si + 1)}：${sectionLabel(section)}`}
          className="space-y-3 rounded-lg border border-border p-3"
        >
          <div className="flex flex-wrap items-end gap-3 text-sm">
            <label className="space-y-1">
              <span className="block">段落類型</span>
              <select
                value={section.kind}
                onChange={(e) => {
                  dispatch({
                    type: 'setSection',
                    section: si,
                    kind: e.target.value as (typeof SECTION_KINDS)[number],
                    label: section.label ?? null,
                  });
                }}
                className="min-h-11 rounded-md border border-border bg-surface px-2"
              >
                {SECTION_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {sectionLabel({ kind })}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="block">段落名稱（選填）</span>
              <input
                value={section.label ?? ''}
                maxLength={80}
                onChange={(e) => {
                  dispatch({
                    type: 'setSection',
                    section: si,
                    kind: section.kind,
                    label: e.target.value,
                  });
                }}
                className="min-h-11 rounded-md border border-border bg-surface px-2"
              />
            </label>
          </div>
          {section.lines.map((line, li) => (
            <LineEditor
              key={line.id}
              line={line}
              section={si}
              index={li}
              selected={selected?.section === si && selected.line === li ? selected.chord : null}
              dispatch={dispatch}
              pendingSymbol={pendingSymbol}
            />
          ))}
        </section>
      ))}

      <section aria-labelledby="preview-title" className="rounded-lg border border-border p-3">
        <h2 id="preview-title" className="mb-2 font-semibold">
          預覽
        </h2>
        <ChordSheet
          chart={state.doc}
          display={transposeChartDisplay(state.doc, {
            transposeSemitones: 0,
            capoFret: 0,
            show: 'shape',
            notation: 'letters',
          })}
          fontSize={18}
        />
      </section>
    </div>
  );
}
