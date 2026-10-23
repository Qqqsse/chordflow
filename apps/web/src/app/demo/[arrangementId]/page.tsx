import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChartPreview } from '@/components/chart-preview';
import { getDemoCatalog } from '@/server/catalog/demo-catalog';
import { DEMO_ARRANGEMENT_IDS } from '../demo-arrangements';

interface Props {
  params: Promise<{ arrangementId: string }>;
}

export const dynamicParams = false;

export function generateStaticParams() {
  return DEMO_ARRANGEMENT_IDS.map((arrangementId) => ({ arrangementId }));
}

async function loadChart(arrangementId: string) {
  const revision = await getDemoCatalog().getPublishedRevision(arrangementId);
  if (revision === null) notFound();
  return revision.document;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const chart = await loadChart((await params).arrangementId);
  return { title: chart.title };
}

export default async function DemoChartPage({ params }: Props) {
  const chart = await loadChart((await params).arrangementId);
  return (
    <article aria-labelledby="chart-title" className="space-y-6">
      <header className="space-y-1">
        <Link href="/demo" className="text-sm text-ink-muted hover:text-ink">
          ← 示範譜列表
        </Link>
        <h1 id="chart-title" className="text-2xl font-bold">
          {chart.title}
        </h1>
        <dl className="flex gap-4 text-sm text-ink-muted">
          <div className="flex gap-1">
            <dt>原調</dt>
            <dd className="font-medium text-ink">{chart.concertKey ?? '未知'}</dd>
          </div>
          {chart.timeSignature !== null && (
            <div className="flex gap-1">
              <dt>拍號</dt>
              <dd className="font-medium text-ink">{chart.timeSignature}</dd>
            </div>
          )}
        </dl>
      </header>
      <ChartPreview sections={chart.sections} />
    </article>
  );
}
