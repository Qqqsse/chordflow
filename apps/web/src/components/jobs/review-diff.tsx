'use client';

import { diffCharts, type ChartDocument, type ChartRevision } from '@chordflow/chart-schema';
import { useEffect, useState } from 'react';
import { getJson } from '@/lib/api/client';
import { describeChange } from './diff-labels';

interface Latest {
  id: string;
  revision: number;
  document: ChartDocument;
}

/**
 * Differences between the AI draft and the newest revision derived from it
 * (an edited version waiting to be published). Shows nothing until one exists.
 */
export function ReviewDiff({
  draft,
  refreshKey,
  onLatest,
}: {
  draft: ChartRevision;
  /** Changes when a new revision is saved, to reload. */
  refreshKey: string | null;
  onLatest: (latest: { id: string; revision: number }) => void;
}) {
  const [latest, setLatest] = useState<Latest | null>(null);

  useEffect(() => {
    const base = `/api/v1/arrangements/${draft.arrangementId}`;
    void getJson<{ revisions: { id: string; revision: number }[] }>(base)
      .then(async (detail) => {
        const newest = (detail.data?.revisions ?? [])
          .filter((r) => r.revision > draft.revision)
          .sort((a, b) => b.revision - a.revision)[0];
        if (newest === undefined) return null;
        const full = await getJson<{ document: ChartDocument }>(
          `${base}/revisions/${String(newest.revision)}`,
        );
        return full.data === null ? null : { ...newest, document: full.data.document };
      })
      .then((found) => {
        setLatest(found);
        if (found !== null) onLatest({ id: found.id, revision: found.revision });
      });
  }, [draft.arrangementId, draft.revision, refreshKey, onLatest]);

  if (latest === null) return null;
  const changes = diffCharts(draft.document, latest.document);
  return (
    <section aria-labelledby="diff-title" className="space-y-2">
      <h2 id="diff-title" className="text-lg font-semibold">
        第 {latest.revision} 版與 AI 草稿的差異（{changes.length} 處）
      </h2>
      {changes.length === 0 ? (
        <p className="text-sm">內容與 AI 草稿相同。</p>
      ) : (
        <ul className="space-y-1 text-sm" data-testid="review-diff">
          {changes.map((change, i) => (
            <li key={i}>{describeChange(change, draft.document, latest.document)}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
