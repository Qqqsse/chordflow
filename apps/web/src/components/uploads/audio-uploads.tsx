'use client';

import type { AudioUpload, AudioUploadListData } from '@chordflow/chart-schema';
import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import { deleteJson, getJson, putJson } from '@/lib/api/client';
import { CURRENT_UPLOAD_DECLARATION, UPLOAD_DECLARATIONS } from '@/lib/rights-declaration';
import { useAccount } from '../account/account-context';
import {
  DENIAL_MESSAGES,
  formatBytes,
  formatDate,
  uploadErrorMessage,
  uploadStatusLabel,
} from './labels';

const field = 'min-h-11 w-full rounded-md border border-border bg-surface px-3';
const smallButton = 'min-h-9 rounded-md border border-border px-3 text-sm';

export function AudioUploads() {
  const account = useAccount();
  const [data, setData] = useState<AudioUploadListData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Changing the key resets the form after a successful upload.
  const [formKey, setFormKey] = useState(0);

  const load = useCallback(() => {
    void getJson<AudioUploadListData>('/api/v1/audio-uploads').then((result) => {
      if (result.data === null) setLoadError('無法讀取上傳的音訊。');
      else setData(result.data);
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    form.set('declarationVersion', CURRENT_UPLOAD_DECLARATION);
    form.set('declarationAccepted', form.get('declarationAccepted') === 'on' ? 'true' : 'false');
    setBusy(true);
    setStatus('上傳中…');
    const response = await fetch('/api/v1/audio-uploads', {
      method: 'POST',
      credentials: 'same-origin',
      body: form,
      cache: 'no-store',
    }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as {
      error?: { code: string };
    } | null;
    setBusy(false);
    if (response?.ok !== true) {
      setStatus(uploadErrorMessage(body?.error?.code, data?.policy.maxBytes ?? null));
      return;
    }
    setStatus('已上傳。');
    setFormKey((key) => key + 1);
    load();
  };

  const withdraw = async (upload: AudioUpload) => {
    const question = `確定要刪除「${upload.title}」嗎？音訊會立即刪除，還在使用它的任務會被取消。`;
    if (!window.confirm(question)) return;
    const result = await deleteJson(`/api/v1/audio-uploads/${upload.id}`);
    setStatus(result.error === null ? `已刪除「${upload.title}」。` : '刪除失敗，請稍後再試。');
    load();
  };

  const setBlocked = async (userId: string, name: string, blocked: boolean) => {
    const url = `/api/v1/audio-upload-blocks/${userId}`;
    const result = blocked ? await putJson(url, {}) : await deleteJson(url);
    if (result.error !== null) setStatus('無法變更上傳權限。');
    else setStatus(blocked ? `已停用 ${name} 的上傳權限。` : `已恢復 ${name} 的上傳權限。`);
    load();
  };

  if (loadError !== null) return <p role="alert">{loadError}</p>;
  if (data === null) return <p>讀取中…</p>;

  const { policy, items, blockedUsers } = data;
  const isAdmin = account.user?.role === 'admin';
  const blocked = new Set(blockedUsers.map((b) => b.userId));
  return (
    <div className="space-y-8">
      <section aria-labelledby="upload-form-title" className="space-y-3">
        <h2 id="upload-form-title" className="text-lg font-semibold">
          上傳音訊
        </h2>
        <p className="max-w-prose text-sm text-ink-muted" data-testid="upload-limits">
          已使用 {formatBytes(policy.usedBytes)}／{formatBytes(policy.quotaBytes)}。 單檔上限{' '}
          {formatBytes(policy.maxBytes)}，長度 {Math.round(policy.maxDurationSeconds / 60)}{' '}
          分鐘以內；格式：WAV、FLAC、MP3、OGG、M4A。音訊不會公開，最後一次使用後保存{' '}
          {policy.retentionDays} 天，到期自動刪除。
        </p>
        {policy.canUpload ? (
          <form
            key={formKey}
            onSubmit={(e) => void submit(e)}
            className="space-y-4"
            aria-label="上傳音訊"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1 text-sm sm:col-span-2">
                <span>音訊檔</span>
                <input
                  type="file"
                  name="file"
                  required
                  accept="audio/*,.wav,.flac,.mp3,.ogg,.m4a"
                  className="block w-full text-sm"
                />
              </label>
              <label className="block space-y-1 text-sm">
                <span>歌名</span>
                <input name="title" required maxLength={200} className={field} />
              </label>
              <label className="block space-y-1 text-sm">
                <span>歌手（選填）</span>
                <input name="artist" maxLength={200} className={field} />
              </label>
            </div>
            <label className="flex max-w-prose items-start gap-2 text-sm">
              <input type="checkbox" name="declarationAccepted" required className="mt-1" />
              <span>
                {UPLOAD_DECLARATIONS[CURRENT_UPLOAD_DECLARATION]}（
                <a href="/terms" className="underline">
                  使用條款
                </a>
                ）
              </span>
            </label>
            <button
              type="submit"
              disabled={busy}
              className="min-h-11 rounded-md bg-ink px-4 text-sm font-medium text-surface disabled:opacity-50"
            >
              上傳
            </button>
          </form>
        ) : (
          <p role="note">{policy.reason === null ? null : DENIAL_MESSAGES[policy.reason]}</p>
        )}
        {status !== null && <p role="status">{status}</p>}
      </section>

      <section aria-labelledby="upload-list-title" className="space-y-3">
        <h2 id="upload-list-title" className="text-lg font-semibold">
          {isAdmin ? '所有上傳的音訊' : '我上傳的音訊'}
        </h2>
        {items.length === 0 ? (
          <p className="text-sm text-ink-muted">還沒有上傳的音訊。</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th>歌名</th>
                {isAdmin && <th>上傳者</th>}
                <th>格式／大小</th>
                <th>上傳日期</th>
                <th>狀態</th>
                <th>
                  <span className="sr-only">操作</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((upload) => (
                <tr key={upload.id} data-testid="upload-row" className="align-top">
                  <td>
                    {upload.title}
                    {upload.artist !== null && (
                      <span className="text-ink-muted">（{upload.artist}）</span>
                    )}
                  </td>
                  {isAdmin && (
                    <td className="space-y-1">
                      <span className="block">{upload.owner.name}</span>
                      {upload.owner.id !== account.user?.id && (
                        <button
                          type="button"
                          className={smallButton}
                          onClick={() =>
                            void setBlocked(
                              upload.owner.id,
                              upload.owner.name,
                              !blocked.has(upload.owner.id),
                            )
                          }
                        >
                          {blocked.has(upload.owner.id) ? '恢復上傳權限' : '停用上傳權限'}
                        </button>
                      )}
                    </td>
                  )}
                  <td>
                    {upload.format.toUpperCase()}／{formatBytes(upload.sizeBytes)}
                  </td>
                  <td>{formatDate(upload.uploadedAt)}</td>
                  <td>{uploadStatusLabel(upload)}</td>
                  <td>
                    {upload.status === 'active' && (
                      <button
                        type="button"
                        className={smallButton}
                        aria-label={`刪除「${upload.title}」`}
                        onClick={() => void withdraw(upload)}
                      >
                        刪除
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {isAdmin && blockedUsers.length > 0 && (
        <section aria-labelledby="blocked-title" className="space-y-3">
          <h2 id="blocked-title" className="text-lg font-semibold">
            已停用上傳權限的帳號
          </h2>
          <ul className="space-y-2 text-sm">
            {blockedUsers.map((b) => (
              <li key={b.userId} className="flex flex-wrap items-center gap-2">
                <span>
                  {b.name}（{formatDate(b.blockedAt)} 起）
                </span>
                <button
                  type="button"
                  className={smallButton}
                  onClick={() => void setBlocked(b.userId, b.name, false)}
                >
                  恢復上傳權限
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
