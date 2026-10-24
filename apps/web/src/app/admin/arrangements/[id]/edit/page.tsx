import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { OpaqueIdSchema } from '@chordflow/chart-schema';
import { ChartEditor } from '@/components/editor/chart-editor';
import { getSessionUser } from '@/server/auth/principal';

export const metadata: Metadata = { title: '編輯和弦譜' };
export const dynamic = 'force-dynamic';

export default async function EditPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser(await headers());
  if (user === null) redirect('/login');
  if (user.role !== 'admin') return <p role="alert">只有管理員可以編輯和弦譜。</p>;
  const { id } = await params;
  if (!OpaqueIdSchema.safeParse(id).success) notFound();
  return (
    <section aria-labelledby="edit-title" className="space-y-4">
      <h1 id="edit-title" className="text-2xl font-bold">
        編輯和弦譜
      </h1>
      <p>
        <a className="underline" href={`/charts/${id}`}>
          回到譜頁
        </a>
      </p>
      <ChartEditor arrangementId={id} />
    </section>
  );
}
