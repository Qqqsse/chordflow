import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { LibraryLists } from '@/components/library/library-lists';
import { getSessionUser } from '@/server/auth/principal';

export const metadata: Metadata = { title: '我的譜庫' };
export const dynamic = 'force-dynamic';

export default async function LibraryPage() {
  const user = await getSessionUser(await headers());
  if (user === null) redirect('/login');
  return (
    <section aria-labelledby="library-title" className="space-y-4">
      <h1 id="library-title" className="text-2xl font-bold">
        我的譜庫
      </h1>
      <p className="max-w-prose text-sm text-ink-muted">
        收藏與最近開啟的譜只有你看得到。要在沒有網路時使用，請在譜頁按「儲存離線」，並到
        <a className="underline" href="/offline">
          離線譜庫
        </a>
        。
      </p>
      <LibraryLists />
    </section>
  );
}
