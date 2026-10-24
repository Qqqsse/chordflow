'use client';

import { useAccount } from '@/components/account/account-context';
import type { ChartDocument } from '@chordflow/chart-schema';
import { useEffect, useState } from 'react';
import { type OfflineChartMeta } from '@/lib/offline/offline-record';
import { getOfflineChart, saveOfflineChart } from '@/lib/offline/offline-store';

type Status =
  | { kind: 'checking' }
  | { kind: 'unsaved' }
  | { kind: 'saved'; savedAt: string; current: boolean }
  | { kind: 'error' };

export function formatSavedAt(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? '時間不明'
    : date.toLocaleString('zh-TW', { dateStyle: 'medium', timeStyle: 'short' });
}

export function SaveOfflineButton({
  chart,
  meta,
}: {
  chart: ChartDocument;
  meta: OfflineChartMeta;
}) {
  const account = useAccount();
  const namespace = account.offlineNamespace;
  const [status, setStatus] = useState<Status>({ kind: 'checking' });

  useEffect(() => {
    if (account.status !== 'ready') return undefined;
    let active = true;
    getOfflineChart(namespace, chart.arrangementId)
      .then((existing) => {
        if (!active) return;
        if (existing?.ok) {
          setStatus({
            kind: 'saved',
            savedAt: existing.record.savedAt,
            current: existing.record.chartRevisionId === chart.chartRevisionId,
          });
        } else {
          setStatus({ kind: 'unsaved' });
        }
      })
      .catch(() => {
        if (active) setStatus({ kind: 'error' });
      });
    return () => {
      active = false;
    };
  }, [chart.arrangementId, chart.chartRevisionId, namespace, account.status]);

  const save = () => {
    saveOfflineChart(namespace, chart, meta)
      .then((record) => {
        setStatus({ kind: 'saved', savedAt: record.savedAt, current: true });
      })
      .catch(() => {
        setStatus({ kind: 'error' });
      });
  };

  return (
    <div className="flex flex-wrap items-center gap-3 text-sm" data-testid="save-offline">
      <button
        type="button"
        className="min-h-11 rounded-md border border-border px-3 font-medium disabled:opacity-40"
        disabled={status.kind === 'checking'}
        onClick={save}
      >
        {status.kind === 'saved' ? '更新離線版本' : '儲存離線'}
      </button>
      <span className="text-xs text-ink-muted" aria-live="polite">
        {status.kind === 'saved' &&
          `已儲存離線（${formatSavedAt(status.savedAt)}）${status.current ? '' : '，但不是最新版本'}`}
        {status.kind === 'unsaved' && '儲存在這個裝置的瀏覽器中，不會上傳。'}
        {status.kind === 'error' && '這個瀏覽器無法使用離線儲存。'}
      </span>
      {status.kind === 'saved' && (
        <a href="/offline" className="text-xs underline">
          離線譜庫
        </a>
      )}
    </div>
  );
}
