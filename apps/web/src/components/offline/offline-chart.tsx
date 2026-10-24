'use client';

import { useEffect, useState } from 'react';
import { ChartViewer } from '@/components/viewer/chart-viewer';
import { GUEST_NAMESPACE, type ParsedOfflineRecord } from '@/lib/offline/offline-record';
import { getOfflineChart } from '@/lib/offline/offline-store';
import { INVALID_REASON_TEXT } from './offline-library';
import { formatSavedAt } from './save-offline-button';

type State =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'unavailable' }
  | { kind: 'loaded'; result: ParsedOfflineRecord };

/** Renders a chart saved in IndexedDB; works with no network once the shell is cached. */
export function OfflineChart() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('id');
    const lookup =
      id === null || id === '' ? Promise.resolve(null) : getOfflineChart(GUEST_NAMESPACE, id);
    lookup
      .then((result) => {
        setState(result === null ? { kind: 'missing' } : { kind: 'loaded', result });
      })
      .catch(() => {
        setState({ kind: 'unavailable' });
      });
  }, []);

  if (state.kind === 'loading') return <p className="text-ink-muted">讀取中…</p>;
  if (state.kind === 'unavailable') return <p role="alert">這個瀏覽器無法使用離線儲存。</p>;
  if (state.kind === 'missing') {
    return (
      <p role="alert">
        找不到這份離線譜。<a href="/offline">回到離線譜庫</a>
      </p>
    );
  }
  const { result } = state;
  if (!result.ok) {
    return (
      <div role="alert" className="space-y-2">
        <p>
          這份離線譜無法安全開啟：{INVALID_REASON_TEXT[result.reason]}。請在連線時回到原譜重新儲存。
        </p>
        <a href="/offline">回到離線譜庫</a>
      </div>
    );
  }
  const { record } = result;
  return (
    <article aria-labelledby="chart-title" className="space-y-6">
      <header className="space-y-1">
        <a href="/offline" className="text-sm text-ink-muted hover:text-ink">
          ← 離線譜庫
        </a>
        <h1 id="chart-title" className="text-2xl font-bold">
          {record.title}
        </h1>
        {record.meta.credits !== null && (
          <p className="text-sm text-ink-muted">{record.meta.credits}</p>
        )}
        <p className="text-xs text-ink-muted" data-testid="offline-badge">
          離線版本 · 儲存於 {formatSavedAt(record.savedAt)}
        </p>
      </header>
      <ChartViewer chart={record.document} />
    </article>
  );
}
