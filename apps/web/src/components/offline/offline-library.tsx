'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  GUEST_NAMESPACE,
  type OfflineInvalidReason,
  type ParsedOfflineRecord,
} from '@/lib/offline/offline-record';
import {
  clearOfflineCharts,
  listOfflineCharts,
  removeOfflineChart,
} from '@/lib/offline/offline-store';
import { formatSavedAt } from './save-offline-button';

export const INVALID_REASON_TEXT: Readonly<Record<OfflineInvalidReason, string>> = {
  NOT_A_RECORD: '資料已損毀',
  UNSUPPORTED_RECORD_VERSION: '由較新或較舊版本的 chordflow 儲存',
  CHART_INVALID: '和弦譜格式已不相容',
  KEY_MISMATCH: '儲存位置不一致',
};

type State =
  { kind: 'loading' } | { kind: 'ready'; records: ParsedOfflineRecord[] } | { kind: 'unavailable' };

export function OfflineLibrary() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [confirmClear, setConfirmClear] = useState(false);

  const refresh = useCallback(() => {
    listOfflineCharts(GUEST_NAMESPACE)
      .then((records) => {
        setState({ kind: 'ready', records });
      })
      .catch(() => {
        setState({ kind: 'unavailable' });
      });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (state.kind === 'loading') return <p className="text-ink-muted">讀取中…</p>;
  if (state.kind === 'unavailable') {
    return <p role="alert">這個瀏覽器無法使用離線儲存（可能是無痕模式或已停用網站資料）。</p>;
  }

  const valid = state.records.flatMap((r) => (r.ok ? [r.record] : []));
  const invalid = state.records.flatMap((r) => (r.ok ? [] : [r]));
  const remove = (key: string) => {
    removeOfflineChart(key).then(refresh, refresh);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span data-testid="offline-count">共 {valid.length} 份離線譜</span>
        <button
          type="button"
          className="min-h-11 rounded-md border border-border px-3"
          onClick={refresh}
        >
          重新整理
        </button>
        {state.records.length > 0 &&
          (confirmClear ? (
            <button
              type="button"
              className="min-h-11 rounded-md border border-border px-3 font-medium text-accent"
              onClick={() => {
                setConfirmClear(false);
                clearOfflineCharts(GUEST_NAMESPACE).then(refresh, refresh);
              }}
            >
              確定清除全部？
            </button>
          ) : (
            <button
              type="button"
              className="min-h-11 rounded-md border border-border px-3"
              onClick={() => {
                setConfirmClear(true);
              }}
            >
              全部清除
            </button>
          ))}
      </div>

      {invalid.length > 0 && (
        <ul className="space-y-2" aria-label="無法開啟的離線譜">
          {invalid.map((r, index) => (
            <li
              key={r.key ?? `invalid-${index}`}
              role="alert"
              className="rounded-md border border-border p-3 text-sm"
            >
              <p>
                「{r.title ?? '未知歌曲'}」無法安全開啟：{INVALID_REASON_TEXT[r.reason]}。
                請在連線時回到原譜重新儲存。
              </p>
              {r.key !== null && (
                <button
                  type="button"
                  className="mt-2 min-h-11 rounded-md border border-border px-3"
                  onClick={() => {
                    if (r.key !== null) remove(r.key);
                  }}
                >
                  移除
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {valid.length === 0 ? (
        <p className="text-ink-muted">還沒有離線譜。開啟任何一份譜，按「儲存離線」即可加入。</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border" aria-label="離線譜">
          {valid.map((record) => (
            <li key={record.key} className="flex flex-wrap items-center justify-between gap-3 p-3">
              <div>
                <a
                  className="font-medium underline-offset-4 hover:underline"
                  href={`/offline/view?id=${encodeURIComponent(record.arrangementId)}`}
                >
                  {record.title}
                </a>
                <p className="text-xs text-ink-muted">
                  儲存於 {formatSavedAt(record.savedAt)} · 格式版本 {record.schemaVersion}
                  {record.meta.arrangementName !== null && ` · ${record.meta.arrangementName}`}
                </p>
              </div>
              <button
                type="button"
                className="min-h-11 rounded-md border border-border px-3 text-sm"
                aria-label={`移除 ${record.title}`}
                onClick={() => {
                  remove(record.key);
                }}
              >
                移除
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
