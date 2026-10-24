import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { ROLE_LABEL, VARIANT_LABEL } from '@/components/catalog/labels';
import { SaveOfflineButton } from '@/components/offline/save-offline-button';
import { ChartViewer } from '@/components/viewer/chart-viewer';
import { ApiProblem } from '@/lib/api/handler';
import { getPrincipalFromHeaders } from '@/server/auth/principal';
import { getCatalog } from '@/server/catalog';
import { requireVisibleArrangement } from '@/server/catalog/lookups';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ arrangementId: string }>;
}

async function load(arrangementId: string) {
  const repo = getCatalog();
  const principal = await getPrincipalFromHeaders(await headers());
  try {
    const arrangement = await requireVisibleArrangement(repo, principal, arrangementId);
    const revision = await repo.getPublishedRevision(arrangement.id);
    if (revision === null) notFound();
    const work = await repo.getWork(arrangement.workId);
    const credits = await Promise.all(
      (work?.credits ?? []).map(
        async (c) =>
          `${ROLE_LABEL[c.role] ?? c.role}：${(await repo.getArtist(c.artistId))?.name ?? ''}`,
      ),
    );
    return { arrangement, chart: revision.document, creditLine: credits.join('　') };
  } catch (error) {
    if (error instanceof ApiProblem && error.status === 404) notFound();
    throw error;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { chart } = await load((await params).arrangementId);
  return { title: chart.title };
}

export default async function ChartPage({ params }: Props) {
  const { arrangement, chart, creditLine } = await load((await params).arrangementId);
  return (
    <article aria-labelledby="chart-title" className="space-y-6">
      <header className="space-y-1">
        <h1 id="chart-title" className="text-2xl font-bold">
          {chart.title}
        </h1>
        {creditLine !== '' && <p className="text-sm text-ink-muted">{creditLine}</p>}
        <p className="text-sm text-ink-muted">
          版本：{arrangement.name}（{VARIANT_LABEL[arrangement.variant] ?? arrangement.variant}）
        </p>
        {arrangement.rights.attribution !== null && (
          <p className="text-xs text-ink-muted">{arrangement.rights.attribution}</p>
        )}
      </header>
      <SaveOfflineButton
        chart={chart}
        meta={{ arrangementName: arrangement.name, credits: creditLine === '' ? null : creditLine }}
      />
      <ChartViewer chart={chart} />
    </article>
  );
}
