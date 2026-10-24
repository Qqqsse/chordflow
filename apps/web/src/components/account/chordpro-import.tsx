'use client';

import type { ChartDocument } from '@chordflow/chart-schema';
import { transposeChartDisplay } from '@chordflow/music-theory';
import { useState, type SyntheticEvent } from 'react';
import { ChordSheet } from '@/components/viewer/chord-sheet';

interface ImportIssue {
  severity: 'error' | 'warning';
  code: string;
  line: number;
  message: string;
}

interface Preview {
  ok: boolean;
  document: ChartDocument | null;
  metadata: { title: string | null; artists: string[]; capo: number | null } | null;
  issues: ImportIssue[];
}

const RIGHTS = [
  ['unknown', '不明（只能私人）'],
  ['owner_original', '自己的原創'],
  ['public_domain', '公有領域'],
  ['licensed', '已取得授權'],
  ['permission_granted', '權利人同意'],
] as const;

async function post(url: string, body: unknown): Promise<{ status: number; json: unknown }> {
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: (await response.json().catch(() => null)) as unknown };
}

const errorMessage = (json: unknown) =>
  (json as { error?: { message?: string } } | null)?.error?.message ?? '發生錯誤';

export function ChordProImport() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [capoChoice, setCapoChoice] = useState<'' | 'concert' | 'capo_shapes'>('');
  const [status, setStatus] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  const read = (form: HTMLFormElement) => {
    const data = new FormData(form);
    const raw = (name: string) => {
      const value = data.get(name);
      return typeof value === 'string' ? value : '';
    };
    const text = (name: string) => raw(name).trim();
    return {
      source: raw('source'),
      title: text('title'),
      artist: text('artist'),
      name: text('name') || '原調',
      lyricsRights: text('lyricsRights'),
      chartRights: text('chartRights'),
      visibility: text('visibility'),
      attribution: text('attribution'),
      publish: data.get('publish') === 'on',
    };
  };

  const doPreview = async (form: HTMLFormElement) => {
    const f = read(form);
    setStatus(null);
    setCreated(null);
    const { json } = await post('/api/v1/chordpro/import', {
      source: f.source,
      ...(f.title === '' ? {} : { title: f.title }),
      ...(capoChoice === '' ? {} : { chordsWrittenAs: capoChoice }),
    });
    const data = (json as { data?: Preview } | null)?.data ?? null;
    if (data === null) setStatus(errorMessage(json));
    setPreview(data);
  };

  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const action = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value');
    if (action === 'preview') {
      await doPreview(form);
      return;
    }
    const f = read(form);
    const doc = preview?.document;
    if (!preview?.ok || !doc) {
      setStatus('請先預覽並修正所有錯誤。');
      return;
    }
    setStatus('建立中…');
    const arrangement = await post('/api/v1/arrangements', {
      work: {
        title: doc.title,
        titleAliases: [],
        language: doc.language,
        artistName: f.artist === '' ? (preview.metadata?.artists[0] ?? null) : f.artist,
      },
      name: f.name,
      variant: 'original',
      visibility: f.visibility,
      rights: {
        lyrics: f.lyricsRights,
        chart: f.chartRights,
        audio: 'unknown',
        attribution: f.attribution === '' ? null : f.attribution,
        notes: null,
      },
    });
    if (arrangement.status !== 201) {
      setStatus(errorMessage(arrangement.json));
      return;
    }
    const arrangementId = (arrangement.json as { data: { arrangementId: string } }).data
      .arrangementId;
    const revision = await post(`/api/v1/arrangements/${arrangementId}/revisions`, {
      chordpro: {
        source: f.source,
        ...(f.title === '' ? {} : { title: f.title }),
        ...(capoChoice === '' ? {} : { chordsWrittenAs: capoChoice }),
      },
      expectedLatestRevision: null,
    });
    if (revision.status !== 201) {
      setStatus(errorMessage(revision.json));
      return;
    }
    const revisionId = (revision.json as { data: { id: string } }).data.id;
    if (f.publish) {
      const published = await post(`/api/v1/arrangements/${arrangementId}/publish`, { revisionId });
      if (published.status !== 200) {
        setStatus(`草稿已建立，但無法發布：${errorMessage(published.json)}`);
        return;
      }
    }
    setStatus(f.publish ? '已建立並發布。' : '已建立草稿（尚未發布）。');
    setCreated(f.publish ? arrangementId : null);
  };

  const needsCapo = preview?.issues.some((i) => i.code === 'CAPO_INTERPRETATION_REQUIRED') ?? false;
  const doc = preview?.document ?? null;

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4">
      <label className="block space-y-1 text-sm">
        <span>ChordPro 內容</span>
        <textarea
          name="source"
          required
          rows={12}
          className="w-full rounded-md border border-border bg-surface p-2 font-mono text-sm"
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1 text-sm">
          <span>歌名（ChordPro 沒有 {'{title}'} 時使用）</span>
          <input
            name="title"
            maxLength={200}
            className="min-h-11 w-full rounded-md border border-border bg-surface px-3"
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span>歌手</span>
          <input
            name="artist"
            maxLength={200}
            className="min-h-11 w-full rounded-md border border-border bg-surface px-3"
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span>編曲名稱</span>
          <input
            name="name"
            maxLength={200}
            placeholder="原調"
            className="min-h-11 w-full rounded-md border border-border bg-surface px-3"
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span>出處／署名</span>
          <input
            name="attribution"
            maxLength={500}
            className="min-h-11 w-full rounded-md border border-border bg-surface px-3"
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span>歌詞權利</span>
          <select
            name="lyricsRights"
            className="min-h-11 w-full rounded-md border border-border bg-surface px-2"
          >
            {RIGHTS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1 text-sm">
          <span>和弦譜權利</span>
          <select
            name="chartRights"
            className="min-h-11 w-full rounded-md border border-border bg-surface px-2"
          >
            {RIGHTS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1 text-sm">
          <span>可見度</span>
          <select
            name="visibility"
            className="min-h-11 w-full rounded-md border border-border bg-surface px-2"
          >
            <option value="private">私人</option>
            <option value="shared">會員可見</option>
            <option value="public">公開</option>
          </select>
        </label>
        {needsCapo && (
          <label className="block space-y-1 text-sm">
            <span>檔案標示了移調夾，和弦是：</span>
            <select
              value={capoChoice}
              onChange={(e) => {
                setCapoChoice(e.target.value as typeof capoChoice);
              }}
              className="min-h-11 w-full rounded-md border border-border bg-surface px-2"
            >
              <option value="">請選擇</option>
              <option value="concert">實際發聲的和弦</option>
              <option value="capo_shapes">夾移調夾後的按法</option>
            </select>
          </label>
        )}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="publish" defaultChecked /> 建立後立即發布（權利不足時會被拒絕）
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          value="preview"
          className="min-h-11 rounded-md border border-border px-4 text-sm"
        >
          預覽
        </button>
        <button
          type="submit"
          value="create"
          className="min-h-11 rounded-md bg-ink px-4 text-sm font-medium text-surface"
        >
          建立
        </button>
      </div>
      {status !== null && <p role="status">{status}</p>}
      {created !== null && (
        <a className="underline" href={`/charts/${created}`}>
          開啟這份譜
        </a>
      )}
      {preview !== null && preview.issues.length > 0 && (
        <ul aria-label="匯入訊息" className="space-y-1 text-sm" data-testid="import-issues">
          {preview.issues.map((issue, i) => (
            <li key={i}>
              {issue.severity === 'error' ? '錯誤' : '提醒'}
              {issue.line > 0 && `（第 ${issue.line} 行）`}：{issue.code}
            </li>
          ))}
        </ul>
      )}
      {doc !== null && (
        <section aria-label="預覽" className="rounded-lg border border-border p-3">
          <h2 className="mb-2 font-semibold">{doc.title}</h2>
          <ChordSheet
            chart={doc}
            display={transposeChartDisplay(doc, {
              transposeSemitones: 0,
              capoFret: 0,
              show: 'shape',
              notation: 'letters',
            })}
            fontSize={18}
          />
        </section>
      )}
    </form>
  );
}
