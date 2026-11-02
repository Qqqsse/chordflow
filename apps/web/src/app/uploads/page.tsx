import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { AudioUploads } from '@/components/uploads/audio-uploads';
import { getSessionUser } from '@/server/auth/principal';

export const metadata: Metadata = { title: '我的音訊' };
export const dynamic = 'force-dynamic';

export default async function UploadsPage() {
  const user = await getSessionUser(await headers());
  if (user === null) redirect('/login');
  return (
    <section aria-labelledby="uploads-title" className="space-y-4">
      <h1 id="uploads-title" className="text-2xl font-bold">
        我的音訊
      </h1>
      <p className="max-w-prose text-sm text-ink-muted">
        上傳自己錄製、或已取得授權的音訊，日後用來產生和弦譜草稿。音訊只有你和管理員看得到，
        不會公開，也沒有任何網址可以直接下載。用音訊產生草稿的功能完成後會出現在這裡。
      </p>
      <AudioUploads />
    </section>
  );
}
