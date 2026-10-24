import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { OpaqueIdSchema } from '@chordflow/chart-schema';
import { AuditLog } from '@/components/catalog/audit-log';
import { getSessionUser } from '@/server/auth/principal';

export const metadata: Metadata = { title: '權利紀錄' };
export const dynamic = 'force-dynamic';

export default async function AuditPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser(await headers());
  if (user === null) redirect('/login');
  if (user.role !== 'admin') return <p role="alert">只有管理員可以檢視權利紀錄。</p>;
  const { id } = await params;
  if (!OpaqueIdSchema.safeParse(id).success) notFound();
  return (
    <section aria-labelledby="audit-title" className="space-y-4">
      <h1 id="audit-title" className="text-2xl font-bold">
        權利紀錄
      </h1>
      <p className="max-w-prose text-sm text-ink-muted">
        可見度、各素材權利與發布的每一次變更都會被記錄，紀錄只能新增、不能修改或刪除。
      </p>
      <p>
        <a className="underline" href={`/charts/${id}`}>
          回到譜頁
        </a>
      </p>
      <AuditLog arrangementId={id} />
    </section>
  );
}
