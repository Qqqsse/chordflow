'use client';

import type { ChartDocument } from '@chordflow/chart-schema';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAccount } from '@/components/account/account-context';
import { ChartViewer } from '@/components/viewer/chart-viewer';
import { fromPreferences, toPreferences } from '@/components/viewer/viewer-preferences';
import { DEFAULT_VIEWER_STATE, type ViewerState } from '@/components/viewer/viewer-state';
import { getJson, postJson, putJson, deleteJson } from '@/lib/api/client';

const SAVE_DELAY_MS = 800;

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const SAVE_LABEL: Readonly<Record<SaveStatus, string>> = {
  idle: '你的看譜設定會自動儲存到帳號。',
  saving: '儲存中…',
  saved: '看譜設定已儲存。',
  error: '無法儲存看譜設定，稍後會再試。',
};

/**
 * Catalog chart viewer with the signed-in reader's library features: saved
 * viewer preferences, a favorite toggle and "recently opened". Everything
 * personal is fetched in the browser, so the server-rendered page stays
 * identical for every visitor. Anonymous readers get the plain viewer.
 */
export function AccountChartViewer({
  chart,
  arrangementId,
}: {
  chart: ChartDocument;
  arrangementId: string;
}) {
  const account = useAccount();
  const signedIn = account.status === 'ready' && account.user !== null;
  const [initial, setInitial] = useState<{ state: ViewerState; key: string }>({
    state: DEFAULT_VIEWER_STATE,
    key: 'default',
  });
  const [favorite, setFavoriteState] = useState<boolean | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const touched = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!signedIn) return;
    void postJson(`/api/v1/me/recent/${arrangementId}`, {});
    void getJson<{ favorite: boolean }>(`/api/v1/me/favorites/${arrangementId}`).then((r) => {
      if (r.data !== null) setFavoriteState(r.data.favorite);
    });
    void getJson<{ preferences: unknown }>(`/api/v1/me/preferences/${arrangementId}`).then((r) => {
      // Never overwrite what the reader already changed while this was loading.
      if (r.data?.preferences != null && !touched.current) {
        setInitial({ state: fromPreferences(r.data.preferences), key: 'saved' });
      }
    });
  }, [signedIn, arrangementId]);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const onStateChange = useCallback(
    (state: ViewerState) => {
      touched.current = true;
      if (!signedIn) return;
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        setSaveStatus('saving');
        void putJson(`/api/v1/me/preferences/${arrangementId}`, toPreferences(state)).then((r) => {
          setSaveStatus(r.error === null ? 'saved' : 'error');
        });
      }, SAVE_DELAY_MS);
    },
    [signedIn, arrangementId],
  );

  const toggleFavorite = async () => {
    const next = !(favorite ?? false);
    const url = `/api/v1/me/favorites/${arrangementId}`;
    const result = await (next ? putJson(url, {}) : deleteJson(url));
    if (result.error === null) setFavoriteState(next);
  };

  return (
    <div className="space-y-4">
      {signedIn && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <button
            type="button"
            aria-pressed={favorite ?? false}
            disabled={favorite === null}
            onClick={() => void toggleFavorite()}
            className="min-h-11 rounded-md border border-border px-3"
          >
            {favorite === true ? '★ 已收藏' : '☆ 加入收藏'}
          </button>
          {account.user?.role === 'admin' && (
            <a className="underline" href={`/admin/arrangements/${arrangementId}/audit`}>
              權利紀錄
            </a>
          )}
          <span className="text-ink-muted" role="status" data-testid="preference-status">
            {SAVE_LABEL[saveStatus]}
          </span>
        </div>
      )}
      <ChartViewer
        key={initial.key}
        chart={chart}
        initialState={initial.state}
        onStateChange={onStateChange}
      />
    </div>
  );
}
