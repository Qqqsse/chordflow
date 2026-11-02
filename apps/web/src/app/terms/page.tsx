import type { Metadata } from 'next';
import {
  CURRENT_UPLOAD_DECLARATION,
  PLATFORM_TERMS,
  UPLOAD_DECLARATIONS,
} from '@/lib/rights-declaration';

export const metadata: Metadata = { title: '使用條款' };
// SITE_CONTACT is read when the page is served, not when the image is built.
export const dynamic = 'force-dynamic';

export default function TermsPage() {
  const contact = process.env.SITE_CONTACT?.trim() ?? '';
  return (
    <article aria-labelledby="terms-title" className="max-w-prose space-y-4">
      <h1 id="terms-title" className="text-2xl font-bold">
        使用條款
      </h1>
      <p>{PLATFORM_TERMS}</p>
      <h2 className="text-lg font-semibold">上傳音訊時的聲明</h2>
      <p>每次上傳音訊前都要先勾選下面的聲明；系統會記錄你同意的聲明版本與時間。</p>
      <blockquote className="border-l-4 border-border pl-4">
        {UPLOAD_DECLARATIONS[CURRENT_UPLOAD_DECLARATION]}
      </blockquote>
      <h2 className="text-lg font-semibold">聯絡管理員</h2>
      <p>{contact === '' ? '請聯絡邀請你加入的管理員。' : `聯絡方式：${contact}`}</p>
    </article>
  );
}
