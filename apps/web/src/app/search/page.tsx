import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import {
  PROVENANCE_LABEL,
  RECORDING_KIND_LABEL,
  ROLE_LABEL,
  VARIANT_LABEL,
} from '@/components/catalog/labels';
import { SearchForm } from '@/components/catalog/search-form';
import { getPrincipalFromHeaders } from '@/server/auth/principal';
import { getCatalog } from '@/server/catalog';
import { searchCatalog } from '@/server/catalog/views';

export const metadata: Metadata = { title: '搜尋' };
export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ q?: string | string[]; cursor?: string | string[] }>;
}

const first = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value) ?? '';

export default async function SearchPage({ searchParams }: Props) {
  const params = await searchParams;
  const q = first(params.q);
  const cursor = first(params.cursor);
  const principal = await getPrincipalFromHeaders(await headers());
  const result =
    q.trim() === ''
      ? null
      : await searchCatalog(getCatalog(), principal, q, {
          limit: 20,
          cursor: cursor === '' ? null : cursor,
        });

  return (
    <section aria-labelledby="search-title" className="space-y-6">
      <h1 id="search-title" className="text-2xl font-bold">
        搜尋
      </h1>
      <SearchForm defaultValue={q} />
      {result !== null && 'error' in result && (
        <p role="alert" className="text-sm">
          無法搜尋：
          {result.message.includes('URL')
            ? '不支援這個網址（只辨識 YouTube 與 Spotify 歌曲連結，且不會連線抓取）。'
            : '請輸入 1–100 個字的歌名、歌手或來源網址。'}
        </p>
      )}
      {result !== null && !('error' in result) && (
        <div className="space-y-4" data-testid="search-results">
          {result.source && (
            <p className="text-sm text-ink-muted">
              來源：{result.source.platform}（{result.source.platformSourceId}）
              {result.source.matchedSourceId === null ? '，曲庫中還沒有這個來源。' : ''}
            </p>
          )}
          {result.items.length === 0 ? (
            <p>找不到符合「{q}」的歌曲。</p>
          ) : (
            <ul className="space-y-4">
              {result.items.map((hit) => (
                <li
                  key={hit.work.id}
                  className="space-y-2 rounded-lg border border-border p-4"
                  data-work-id={hit.work.id}
                >
                  <h2 className="text-lg font-semibold">{hit.work.title}</h2>
                  <p className="text-sm text-ink-muted">
                    {hit.work.credits
                      .map((c) => `${ROLE_LABEL[c.role] ?? c.role}：${c.artist.name}`)
                      .join('　')}
                  </p>
                  {hit.arrangements.length > 0 ? (
                    <ul className="flex flex-wrap gap-2" aria-label="和弦譜">
                      {hit.arrangements.map((a) =>
                        a.hasPublishedChart ? (
                          <li key={a.id}>
                            <Link
                              href={`/charts/${a.id}`}
                              className="inline-flex min-h-11 items-center rounded-md bg-ink px-4 text-sm font-medium text-surface"
                            >
                              開啟譜：{a.name}（{VARIANT_LABEL[a.variant] ?? a.variant}）
                            </Link>
                          </li>
                        ) : (
                          <li key={a.id} className="text-sm text-ink-muted">
                            {a.name}：尚未發布
                          </li>
                        ),
                      )}
                    </ul>
                  ) : (
                    <p className="text-sm text-ink-muted">目前沒有可公開的和弦譜。</p>
                  )}
                  {hit.recordings.length > 0 && (
                    <details>
                      <summary className="cursor-pointer text-sm">
                        錄音版本（{hit.recordings.length}）
                      </summary>
                      <ul className="mt-2 space-y-1 text-sm">
                        {hit.recordings.map((r) => (
                          <li key={r.id} data-recording-id={r.id}>
                            {RECORDING_KIND_LABEL[r.kind] ?? r.kind}
                            {r.title !== null && `「${r.title}」`}・
                            {r.performers.map((p) => p.name).join('、')}
                            {r.mappings.map((m) => (
                              <span key={m.arrangementId} className="ml-2 text-xs text-ink-muted">
                                [{PROVENANCE_LABEL[m.provenance]}]
                              </span>
                            ))}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )}
          {result.nextCursor !== null && (
            <Link
              className="underline"
              href={`/search?q=${encodeURIComponent(q)}&cursor=${encodeURIComponent(result.nextCursor)}`}
            >
              更多結果
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
