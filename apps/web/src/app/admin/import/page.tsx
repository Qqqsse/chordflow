import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ChordProImport } from '@/components/account/chordpro-import';
import { getSessionUser } from '@/server/auth/principal';

export const metadata: Metadata = { title: '匯入 ChordPro' };
export const dynamic = 'force-dynamic';

export default async function ImportPage() {
  const user = await getSessionUser(await headers());
  if (user === null) redirect('/login');
  if (user.role !== 'admin') return <p role="alert">只有管理員可以匯入。</p>;
  return (
    <section aria-labelledby="import-title" className="space-y-4">
      <h1 id="import-title" className="text-2xl font-bold">
        匯入 ChordPro
      </h1>
      <p className="max-w-prose text-sm text-ink-muted">
        只匯入你有權使用的內容（自己的創作、公有領域或已取得授權）。權利不明的譜只能設為私人。
      </p>
      <ChordProImport />
    </section>
  );
}
