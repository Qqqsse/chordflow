import type { Metadata } from 'next';
import Link from 'next/link';
import { getDemoCatalog } from '@/server/catalog/demo-catalog';
import { DEMO_ARRANGEMENT_IDS } from './demo-arrangements';

export const metadata: Metadata = { title: '示範譜' };

export default async function DemoIndexPage() {
  const catalog = getDemoCatalog();
  const charts = await Promise.all(
    DEMO_ARRANGEMENT_IDS.map(async (id) => ({
      id,
      revision: await catalog.getPublishedRevision(id),
    })),
  );

  return (
    <section aria-labelledby="demo-title" className="space-y-6">
      <header className="space-y-1">
        <p className="text-sm text-ink-muted">示範模式 · 不需資料庫或 GPU · 內容皆為虛構</p>
        <h1 id="demo-title" className="text-2xl font-bold">
          示範譜
        </h1>
      </header>
      <ul className="divide-y divide-border rounded-md border border-border">
        {charts.map(({ id, revision }) =>
          revision === null ? null : (
            <li key={id}>
              <Link
                href={`/demo/${id}`}
                className="flex min-h-11 items-center justify-between px-4 py-3 hover:bg-surface-muted"
              >
                <span className="font-medium">{revision.document.title}</span>
                <span className="text-sm text-ink-muted">
                  原調 {revision.document.concertKey ?? '未知'}
                </span>
              </Link>
            </li>
          ),
        )}
      </ul>
    </section>
  );
}
