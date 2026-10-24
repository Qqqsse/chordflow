import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { GenerateForm } from '@/components/jobs/generate-form';
import { getSessionUser } from '@/server/auth/principal';

export const metadata: Metadata = { title: '產生和弦譜草稿' };
export const dynamic = 'force-dynamic';

export default async function GeneratePage() {
  const user = await getSessionUser(await headers());
  if (user === null) redirect('/login');
  if (user.role !== 'admin') return <p role="alert">只有管理員可以使用這個頁面。</p>;
  return (
    <section aria-labelledby="generate-title" className="space-y-4">
      <h1 id="generate-title" className="text-2xl font-bold">
        產生和弦譜草稿
      </h1>
      <p className="max-w-prose text-sm text-ink-muted">
        目前只提供 CPU 模擬流程：依你提供的歌詞產生可審查的合成草稿，不分析音訊、不下載任何連結。
        只輸入你有權使用的歌詞；草稿必須經過審查才會發布。
      </p>
      <GenerateForm />
    </section>
  );
}
