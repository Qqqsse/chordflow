import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { OpaqueIdSchema } from '@chordflow/chart-schema';
import { JobReview } from '@/components/jobs/job-review';
import { getSessionUser } from '@/server/auth/principal';

export const metadata: Metadata = { title: '審查草稿' };
export const dynamic = 'force-dynamic';

export default async function JobReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser(await headers());
  if (user === null) redirect('/login');
  if (user.role !== 'admin') return <p role="alert">只有管理員可以審查草稿。</p>;
  const { id } = await params;
  if (!OpaqueIdSchema.safeParse(id).success) notFound();
  return (
    <section aria-labelledby="review-title" className="space-y-4">
      <h1 id="review-title" className="text-2xl font-bold">
        審查草稿
      </h1>
      <p>
        <a className="underline" href="/admin/generate">
          回到任務列表
        </a>
      </p>
      <JobReview jobId={id} />
    </section>
  );
}
