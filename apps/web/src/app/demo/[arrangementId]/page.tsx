import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChartViewer } from '@/components/viewer/chart-viewer';
import { getDemoCatalog } from '@/server/catalog/demo-catalog';
import { DEMO_ARRANGEMENT_IDS } from '../demo-arrangements';

interface Props {
  params: Promise<{ arrangementId: string }>;
}

export const dynamicParams = false;

export function generateStaticParams() {
  return DEMO_ARRANGEMENT_IDS.map((arrangementId) => ({ arrangementId }));
}

async function load(arrangementId: string) {
  const catalog = getDemoCatalog();
  const [arrangement, revision] = await Promise.all([
    catalog.getArrangement(arrangementId),
    catalog.getPublishedRevision(arrangementId),
  ]);
  if (arrangement === null || revision === null) notFound();
  const work = await catalog.getWork(arrangement.workId);
  const credits = await Promise.all(
    (work?.credits ?? []).map(async (credit) => ({
      role: credit.role,
      artist: await catalog.getArtist(credit.artistId),
    })),
  );
  return { arrangement, chart: revision.document, credits };
}

const ROLE_LABELS: Readonly<Record<string, string>> = {
  original_artist: '原唱',
  lyricist: '詞',
  composer: '曲',
  arranger: '編',
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { chart } = await load((await params).arrangementId);
  return { title: chart.title };
}

export default async function DemoChartPage({ params }: Props) {
  const { arrangement, chart, credits } = await load((await params).arrangementId);
  return (
    <article aria-labelledby="chart-title" className="space-y-6">
      <header className="space-y-1">
        <Link href="/demo" className="text-sm text-ink-muted hover:text-ink">
          ← 示範譜列表
        </Link>
        <h1 id="chart-title" className="text-2xl font-bold">
          {chart.title}
        </h1>
        <p className="text-sm text-ink-muted">
          {credits
            .filter((c) => c.artist !== null)
            .map((c) => `${ROLE_LABELS[c.role] ?? c.role}：${c.artist?.name ?? ''}`)
            .join('\u3000')}
        </p>
        <p className="text-sm text-ink-muted">
          版本：{arrangement.name}
          {chart.timeSignature !== null && `\u3000拍號 ${chart.timeSignature}`}
          {chart.defaultBpm !== null && `\u3000♩=${chart.defaultBpm}`}
        </p>
        {arrangement.rights.attribution !== null && (
          <p className="text-xs text-ink-muted">{arrangement.rights.attribution}</p>
        )}
      </header>
      <ChartViewer chart={chart} />
    </article>
  );
}
