'use client';

import { useEffect, useState } from 'react';
import { getJson } from '@/lib/api/client';

interface WorkerStatus {
  workerId: string;
  workerVersion: string;
  lastSeenAt: string;
  online: boolean;
}

const POLL_MS = 10_000;

/** Which workers have contacted the worker API recently (admins only). */
export function WorkerStatusPanel() {
  const [workers, setWorkers] = useState<WorkerStatus[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const load = () =>
      getJson<{ workers: WorkerStatus[] }>('/api/v1/workers').then((result) => {
        setFailed(result.data === null);
        if (result.data !== null) setWorkers(result.data.workers);
      });
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      clearInterval(timer);
    };
  }, []);

  if (failed) return <p className="text-sm">無法讀取 worker 狀態。</p>;
  if (workers === null) return <p className="text-sm text-ink-muted">讀取 worker 狀態中…</p>;
  const online = workers.filter((w) => w.online);
  return (
    <div className="space-y-1 text-sm" data-testid="worker-status">
      <p>
        {online.length > 0
          ? `目前有 ${String(online.length)} 個 worker 在線。`
          : '目前沒有 worker 在線：任務會安全地排隊，等 worker 啟動後處理。'}
      </p>
      {workers.length > 0 && (
        <ul aria-label="worker 列表" className="space-y-0.5 text-ink-muted">
          {workers.map((w) => (
            <li key={w.workerId} className="font-mono">
              {w.online ? '● 在線' : '○ 離線'} {w.workerId}（v{w.workerVersion}）最後聯絡{' '}
              {new Date(w.lastSeenAt).toLocaleString('zh-TW')}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
