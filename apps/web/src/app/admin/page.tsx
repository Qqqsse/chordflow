import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { InvitationAdmin } from '@/components/account/invitation-admin';
import { getSessionUser } from '@/server/auth/principal';

export const metadata: Metadata = { title: '管理' };
export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const user = await getSessionUser(await headers());
  if (user === null) redirect('/login');
  if (user.role !== 'admin') {
    return <p role="alert">只有管理員可以使用這個頁面。</p>;
  }
  return (
    <section aria-labelledby="admin-title" className="space-y-6">
      <h1 id="admin-title" className="text-2xl font-bold">
        管理：邀請
      </h1>
      <p>
        <a className="underline" href="/admin/import">
          匯入 ChordPro 和弦譜
        </a>
      </p>
      <InvitationAdmin />
    </section>
  );
}
