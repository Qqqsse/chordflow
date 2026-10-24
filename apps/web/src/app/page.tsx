import Link from 'next/link';
import { SearchForm } from '@/components/catalog/search-form';

export default function HomePage() {
  return (
    <section aria-labelledby="home-title" className="space-y-6">
      <h1 id="home-title" className="text-3xl font-bold tracking-tight">
        邊彈邊唱，譜就在眼前
      </h1>
      <p className="max-w-prose text-ink-muted">
        chordflow 是給吉他自彈自唱使用的和弦譜工具：移調、移調夾、級數顯示與指法圖，
        在手機、平板與電腦上都清楚易讀。
      </p>
      <SearchForm />
      <p className="max-w-prose text-xs text-ink-muted">
        可以貼上 YouTube 或 Spotify 歌曲連結查詢曲庫，系統只辨識網址，不會下載或抓取內容。
      </p>
      <Link
        href="/demo"
        className="inline-flex min-h-11 items-center rounded-md bg-ink px-5 font-medium text-surface hover:opacity-90"
      >
        開啟示範譜
      </Link>
    </section>
  );
}
