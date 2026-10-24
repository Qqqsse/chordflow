'use client';

import type {
  ChartDocument,
  DraftTarget,
  GenerationJobView,
  JobEvent,
  QualityReport,
  ArtifactManifestEntry,
  ChartRevision,
} from '@chordflow/chart-schema';
import { exportChordPro } from '@chordflow/chordpro';
import { transposeChartDisplay } from '@chordflow/music-theory';
import { useCallback, useEffect, useState } from 'react';
import { sectionLabel } from '@/components/section-label';
import { ChordSheet } from '@/components/viewer/chord-sheet';
import { getJson, postJson } from './http';
import { JobStatusText } from './job-list';
import { JOB_ERROR_LABEL, LIVE_STATUSES, SPAN_REASON_LABEL, STAGE_LABEL } from './labels';

interface JobResult {
  job: GenerationJobView;
  events: JobEvent[];
  revision: ChartRevision;
  quality: QualityReport;
  processor: { id: string; version: string };
  artifacts: ArtifactManifestEntry[];
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/** Highlight rules for flagged chords and lines (ids are opaque-id safe; checked anyway). */
function highlightCss(quality: QualityReport): string {
  const rules = new Set<string>();
  for (const span of quality.spans) {
    const { lineId, chordId } = span.target;
    if (chordId !== null && SAFE_ID.test(chordId)) {
      rules.add(`.review-sheet [data-chord-id="${chordId}"] .chord-label`);
    } else if (lineId !== null && SAFE_ID.test(lineId)) {
      rules.add(`.review-sheet [data-line-id="${lineId}"]`);
    }
  }
  if (rules.size === 0) return '';
  return `${[...rules].join(',\n')} { outline: 2px dashed var(--color-warn, #b45309); outline-offset: 2px; border-radius: 4px; }`;
}

function describeTarget(document: ChartDocument, target: DraftTarget): string {
  const index = document.sections.findIndex((s) => s.id === target.sectionId);
  const section = document.sections[index];
  if (section === undefined) return target.sectionId;
  const sameKind = document.sections.slice(0, index + 1).filter((s) => s.kind === section.kind);
  let text = `${sectionLabel(section)}${sameKind.length > 1 ? ` ${String(sameKind.length)}` : ''}`;
  const lineIndex = section.lines.findIndex((l) => l.id === target.lineId);
  const line = section.lines[lineIndex];
  if (line !== undefined) {
    text += ` 第 ${String(lineIndex + 1)} 行`;
    const chord = line.chords.find((c) => c.id === target.chordId);
    if (chord !== undefined) text += ` · ${chord.symbol}`;
  }
  return text;
}

const shortDigest = (digest: string) => digest.replace('sha256:', '').slice(0, 12);

export function JobReview({ jobId }: { jobId: string }) {
  const [result, setResult] = useState<JobResult | null>(null);
  const [job, setJob] = useState<GenerationJobView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [edited, setEdited] = useState<{ id: string; revision: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      getJson<JobResult>(`/api/v1/generation-jobs/${jobId}/result`).then(async (full) => {
        if (full.data !== null) {
          setResult(full.data);
          setJob(full.data.job);
          return;
        }
        const status = await getJson<{ job: GenerationJobView }>(
          `/api/v1/generation-jobs/${jobId}`,
        );
        if (status.data === null) setMessage(status.error?.message ?? '找不到這個任務');
        else setJob(status.data.job);
      }),
    [jobId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const live = job !== null && LIVE_STATUSES.has(job.status);
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => void load(), 1500);
    return () => {
      clearInterval(timer);
    };
  }, [live, load]);

  const review = async (body: { action: 'publish'; revisionId: string } | { action: 'reject' }) => {
    setBusy(true);
    const reply = await postJson(`/api/v1/generation-jobs/${jobId}/review`, body);
    setBusy(false);
    setMessage(
      reply.error !== null
        ? reply.error.message
        : body.action === 'publish'
          ? '已發布。'
          : '已退回草稿。',
    );
    await load();
  };

  const saveEdit = async () => {
    if (result === null || editing === null) return;
    setBusy(true);
    const reply = await postJson<{ id: string; revision: number }>(
      `/api/v1/arrangements/${result.revision.arrangementId}/revisions`,
      {
        chordpro: { source: editing },
        parentRevisionId: edited?.id ?? result.revision.id,
        expectedLatestRevision: edited?.revision ?? result.revision.revision,
      },
    );
    setBusy(false);
    if (reply.data === null) {
      setMessage(reply.error?.message ?? '無法儲存修訂');
      return;
    }
    setEdited(reply.data);
    setEditing(null);
    setMessage(`已儲存為第 ${String(reply.data.revision)} 版修訂（尚未發布）。`);
  };

  if (job === null) return <p role="status">{message ?? '載入中…'}</p>;
  if (result === null) {
    return (
      <div className="space-y-2">
        <p>
          狀態：
          <JobStatusText job={job} />
        </p>
        {job.error !== null && (
          <p role="alert">
            {JOB_ERROR_LABEL[job.error.code]}
            {job.error.message !== '' && `：${job.error.message}`}
          </p>
        )}
        <p className="text-sm text-ink-muted">草稿完成後會顯示在這裡。</p>
      </div>
    );
  }

  const { revision, quality } = result;
  const document = revision.document;
  const flagged = quality.spans.filter((s) => s.reason !== 'synthetic_output');
  const reviewable = result.job.status === 'needs_review';

  return (
    <div className="space-y-6">
      <p>
        狀態：
        <JobStatusText job={result.job} />
      </p>
      {quality.analysis === 'synthetic_mock' && (
        <p
          role="note"
          className="rounded-md border border-border bg-surface p-3 text-sm"
          data-testid="synthetic-banner"
        >
          這是 CPU 模擬流程產生的<strong>合成草稿</strong>：沒有分析任何音訊，也沒有信心分數。
          每個和弦都需要人工確認後才能發布。
        </p>
      )}
      {message !== null && <p role="status">{message}</p>}

      <section aria-labelledby="draft-title" className="rounded-lg border border-border p-3">
        <h2 id="draft-title" className="mb-2 font-semibold">
          草稿：{document.title}（第 {revision.revision} 版，{document.concertKey ?? '調性未知'}）
        </h2>
        <style>{highlightCss(quality)}</style>
        <div className="review-sheet">
          <ChordSheet
            chart={document}
            display={transposeChartDisplay(document, {
              transposeSemitones: 0,
              capoFret: 0,
              show: 'shape',
              notation: 'letters',
            })}
            fontSize={18}
          />
        </div>
      </section>

      <section aria-labelledby="flags-title" className="space-y-2">
        <h2 id="flags-title" className="text-lg font-semibold">
          待確認（{flagged.length}）
        </h2>
        {flagged.length === 0 ? (
          <p className="text-sm">規則檢查沒有標記任何位置；仍需逐一確認合成和弦。</p>
        ) : (
          <ul className="space-y-1 text-sm" data-testid="quality-spans">
            {flagged.map((span, i) => (
              <li key={i}>
                <strong>{SPAN_REASON_LABEL[span.reason]}</strong>：
                {describeTarget(document, span.target)}—{span.message}
              </li>
            ))}
          </ul>
        )}
      </section>

      {quality.llm.provider !== 'disabled' && (
        <section aria-labelledby="suggest-title" className="space-y-2">
          <h2 id="suggest-title" className="text-lg font-semibold">
            審查建議（測試用假審查器，
            {quality.llm.calls}／{quality.llm.maxCalls} 次呼叫）
          </h2>
          <p className="text-sm text-ink-muted">建議不會自動套用；要採用請在下方修改後另存修訂。</p>
          {quality.llm.budgetExceeded && <p role="alert">已達每個任務的呼叫上限，沒有產生建議。</p>}
          <ul className="space-y-2 text-sm" data-testid="suggestions">
            {quality.suggestions.map((s, i) => (
              <li key={i} className="rounded-md border border-border p-2">
                <p>
                  {describeTarget(document, s.target)} →{' '}
                  <strong>{s.proposedSymbol ?? '（備註）'}</strong>
                </p>
                <p>{s.rationale}</p>
                <p className="text-ink-muted">依據：{s.evidence.join('；')}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {reviewable && (
        <section aria-labelledby="actions-title" className="space-y-3">
          <h2 id="actions-title" className="text-lg font-semibold">
            審查
          </h2>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void review({ action: 'publish', revisionId: revision.id })}
              className="min-h-11 rounded-md bg-ink px-4 text-sm font-medium text-surface"
            >
              發布這份草稿
            </button>
            {edited !== null && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void review({ action: 'publish', revisionId: edited.id })}
                className="min-h-11 rounded-md bg-ink px-4 text-sm font-medium text-surface"
              >
                發布第 {edited.revision} 版修訂
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setEditing(exportChordPro(document).text);
              }}
              className="min-h-11 rounded-md border border-border px-4 text-sm"
            >
              以 ChordPro 修改
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (window.confirm('確定退回這份草稿？任務會被取消，草稿保留為「已退回」。')) {
                  void review({ action: 'reject' });
                }
              }}
              className="min-h-11 rounded-md border border-border px-4 text-sm"
            >
              退回草稿
            </button>
          </div>
          {editing !== null && (
            <div className="space-y-2">
              <label className="block space-y-1 text-sm">
                <span>修改內容（ChordPro）</span>
                <textarea
                  value={editing}
                  onChange={(e) => {
                    setEditing(e.target.value);
                  }}
                  rows={14}
                  className="w-full rounded-md border border-border bg-surface p-2 font-mono text-sm"
                />
              </label>
              <button
                type="button"
                disabled={busy}
                onClick={() => void saveEdit()}
                className="min-h-11 rounded-md border border-border px-4 text-sm"
              >
                儲存為新修訂
              </button>
            </div>
          )}
        </section>
      )}
      {result.job.status === 'completed' && (
        <a className="underline" href={`/charts/${revision.arrangementId}`}>
          開啟已發布的譜
        </a>
      )}

      <details className="text-sm">
        <summary className="cursor-pointer">
          處理階段與產出（{result.artifacts.length} 個檔案）
        </summary>
        <table className="mt-2 w-full text-left">
          <thead>
            <tr>
              <th>階段</th>
              <th>處理器</th>
              <th>結果</th>
            </tr>
          </thead>
          <tbody>
            {quality.stages.map((stage) => (
              <tr key={stage.stage}>
                <td>{STAGE_LABEL[stage.stage]}</td>
                <td className="font-mono">
                  {stage.processorId}@{stage.processorVersion}
                </td>
                <td>
                  {stage.status === 'ok'
                    ? '完成'
                    : `略過${stage.note === null ? '' : `：${stage.note}`}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="mt-2 space-y-1 font-mono" data-testid="artifacts">
          {result.artifacts.map((artifact) => (
            <li key={artifact.id}>
              {artifact.kind} · {shortDigest(artifact.contentDigest)} · {artifact.byteSize} B
            </li>
          ))}
        </ul>
        {result.events.length > 0 && (
          <ol className="mt-2 space-y-1" aria-label="狀態紀錄">
            {result.events.map((event, i) => (
              <li key={i} className="font-mono">
                {new Date(event.at).toLocaleString('zh-TW')} {event.from ?? '∅'} → {event.to}（
                {event.actor}
                {event.code === null ? '' : `, ${event.code}`}）
              </li>
            ))}
          </ol>
        )}
      </details>
    </div>
  );
}
