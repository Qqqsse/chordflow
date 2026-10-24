import type { Metadata } from 'next';
import { OfflineLibrary } from '@/components/offline/offline-library';

export const metadata: Metadata = { title: '離線譜庫' };

export default function OfflinePage() {
  return (
    <section aria-labelledby="offline-title" className="space-y-4">
      <h1 id="offline-title" className="text-2xl font-bold">
        離線譜庫
      </h1>
      <p className="max-w-prose text-sm text-ink-muted">
        這裡列出你按過「儲存離線」的譜。它們只存在這個裝置的瀏覽器中，沒有網路時也能開啟、移調與換移調夾。
        清除瀏覽器網站資料會一併刪除。
      </p>
      <OfflineLibrary />
    </section>
  );
}
