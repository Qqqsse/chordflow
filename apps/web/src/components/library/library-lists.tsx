'use client';

import type { LibraryData, LibraryItem } from '@chordflow/chart-schema';
import { useEffect, useState } from 'react';
import { getJson } from '@/lib/api/client';

function Items({ items, empty, label }: { items: LibraryItem[]; empty: string; label: string }) {
  if (items.length === 0) return <p className="text-sm text-ink-muted">{empty}</p>;
  return (
    <ul aria-label={label} className="divide-y divide-border rounded-lg border border-border">
      {items.map((item) => (
        <li key={item.arrangement.id} className="p-3">
          <a
            className="font-medium underline-offset-4 hover:underline"
            href={`/charts/${item.arrangement.id}`}
          >
            {item.work.title}
          </a>
          <span className="ms-2 text-sm text-ink-muted">{item.arrangement.name}</span>
        </li>
      ))}
    </ul>
  );
}

/** The signed-in reader's favorites and recently opened charts (loaded in the browser). */
export function LibraryLists() {
  const [library, setLibrary] = useState<LibraryData | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void getJson<LibraryData>('/api/v1/me/library').then((result) => {
      if (result.data === null) setMessage(result.error?.message ?? '無法載入譜庫');
      else setLibrary(result.data);
    });
  }, []);

  if (library === null) return <p role="status">{message ?? '載入中…'}</p>;
  return (
    <div className="space-y-6">
      <section aria-labelledby="favorites-title" className="space-y-2">
        <h2 id="favorites-title" className="text-lg font-semibold">
          收藏
        </h2>
        <Items
          items={library.favorites}
          label="收藏的譜"
          empty="還沒有收藏。開啟任一份譜，按「加入收藏」即可。"
        />
      </section>
      <section aria-labelledby="recent-title" className="space-y-2">
        <h2 id="recent-title" className="text-lg font-semibold">
          最近開啟
        </h2>
        <Items items={library.recent} label="最近開啟的譜" empty="還沒有開啟過任何譜。" />
      </section>
    </div>
  );
}
