'use client';

import { useState, type SyntheticEvent } from 'react';
import { postJson } from '@/lib/api/client';
import { JobList } from './job-list';
import { SAMPLE_LYRICS, SAMPLE_TITLE } from './sample-lyrics';

const LYRICS_RIGHTS = [
  ['owner_original', '自己的原創'],
  ['synthetic', '測試用合成內容'],
  ['public_domain', '公有領域'],
  ['licensed', '已取得授權'],
  ['permission_granted', '權利人同意'],
] as const;

const KEYS = ['C', 'G', 'D', 'A', 'E', 'F', 'Bb', 'Eb', 'Am', 'Em', 'Dm'];

const newKey = () => `gen_${crypto.randomUUID().replaceAll('-', '')}`;

/**
 * "Generate demo chart": submits reference lyrics to the CPU mock pipeline.
 * One idempotency key per filled-in form, so a double submit returns the same job.
 */
export function GenerateForm() {
  const [idempotencyKey, setIdempotencyKey] = useState(newKey);
  const [status, setStatus] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [title, setTitle] = useState('');
  const [lyrics, setLyrics] = useState('');

  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (name: string) => {
      const value = data.get(name);
      return typeof value === 'string' ? value.trim() : '';
    };
    setStatus('送出中…');
    const result = await postJson<{ job: { id: string }; reused: boolean }>(
      '/api/v1/generation-jobs',
      {
        idempotencyKey,
        input: {
          kind: 'reference_lyrics',
          lyrics,
          language: text('language'),
          concertKey: text('concertKey') === '' ? null : text('concertKey'),
          seed: 0,
        },
        options: {
          processor: 'mock',
          llmReview: data.get('llmReview') === 'on' ? 'fake' : 'disabled',
        },
        target: {
          work: {
            title,
            titleAliases: [],
            language: text('language'),
            artistName: text('artist') === '' ? null : text('artist'),
          },
          name: 'AI 草稿',
          variant: 'original',
          visibility: text('visibility'),
          rights: {
            lyrics: text('lyricsRights'),
            chart: 'synthetic',
            audio: 'unknown',
            attribution: text('attribution') === '' ? null : text('attribution'),
            notes: 'CPU mock pipeline draft',
          },
        },
      },
    );
    if (result.data === null) {
      setStatus(result.error?.message ?? '送出失敗');
      return;
    }
    setStatus(result.data.reused ? '已有相同的任務，沿用既有任務。' : '已建立任務。');
    setIdempotencyKey(newKey());
    setRefreshKey((n) => n + 1);
  };

  const field = 'min-h-11 w-full rounded-md border border-border bg-surface px-3';
  return (
    <div className="space-y-6">
      <form onSubmit={(e) => void submit(e)} className="space-y-4" aria-label="產生和弦譜草稿">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1 text-sm">
            <span>歌名</span>
            <input
              name="title"
              required
              maxLength={200}
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
              }}
              className={field}
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span>歌手／作者</span>
            <input name="artist" maxLength={200} className={field} />
          </label>
          <label className="block space-y-1 text-sm">
            <span>語言</span>
            <select name="language" defaultValue="zh-TW" className={field}>
              <option value="zh-TW">中文（臺灣）</option>
              <option value="en">英文</option>
              <option value="ja">日文</option>
            </select>
          </label>
          <label className="block space-y-1 text-sm">
            <span>調性</span>
            <select name="concertKey" defaultValue="" className={field}>
              <option value="">自動選擇</option>
              {KEYS.map((key) => (
                <option key={key} value={key}>
                  {key}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1 text-sm">
            <span>歌詞權利（必填）</span>
            <select name="lyricsRights" defaultValue="owner_original" className={field}>
              {LYRICS_RIGHTS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1 text-sm">
            <span>可見度（發布後）</span>
            <select name="visibility" defaultValue="private" className={field}>
              <option value="private">私人</option>
              <option value="shared">會員可見</option>
              <option value="public">公開</option>
            </select>
          </label>
          <label className="block space-y-1 text-sm sm:col-span-2">
            <span>出處／署名</span>
            <input name="attribution" maxLength={500} className={field} />
          </label>
        </div>
        <label className="block space-y-1 text-sm">
          <span>歌詞（空行分段；重複的段落會視為副歌）</span>
          <textarea
            name="lyrics"
            required
            rows={10}
            maxLength={5000}
            value={lyrics}
            onChange={(e) => {
              setLyrics(e.target.value);
            }}
            className="w-full rounded-md border border-border bg-surface p-2"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="llmReview" />{' '}
          加上假審查器的建議（測試用，不呼叫任何付費服務）
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setTitle(SAMPLE_TITLE);
              setLyrics(SAMPLE_LYRICS);
            }}
            className="min-h-11 rounded-md border border-border px-4 text-sm"
          >
            填入自創範例歌詞
          </button>
          <button
            type="submit"
            className="min-h-11 rounded-md bg-ink px-4 text-sm font-medium text-surface"
          >
            產生草稿
          </button>
        </div>
        {status !== null && <p role="status">{status}</p>}
      </form>
      <section aria-labelledby="jobs-title" className="space-y-2">
        <h2 id="jobs-title" className="text-lg font-semibold">
          最近的任務
        </h2>
        <JobList refreshKey={refreshKey} />
      </section>
    </div>
  );
}
