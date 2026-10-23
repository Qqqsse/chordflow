import type { Metadata } from 'next';
import demoChart from '../../../../../fixtures/charts/demo-basic.chart.json';
import { ChartPreview } from '@/components/chart-preview';

export const metadata: Metadata = { title: '示範譜' };

export default function DemoPage() {
  return (
    <article aria-labelledby="chart-title" className="space-y-6">
      <header className="space-y-1">
        <p className="text-sm text-ink-muted">示範模式 · 不需資料庫或 GPU</p>
        <h1 id="chart-title" className="text-2xl font-bold">
          {demoChart.title}
        </h1>
        <dl className="flex gap-4 text-sm text-ink-muted">
          <div className="flex gap-1">
            <dt>原調</dt>
            <dd className="font-medium text-ink">{demoChart.concertKey}</dd>
          </div>
          <div className="flex gap-1">
            <dt>拍號</dt>
            <dd className="font-medium text-ink">{demoChart.timeSignature}</dd>
          </div>
        </dl>
      </header>
      <ChartPreview sections={demoChart.sections} />
    </article>
  );
}
