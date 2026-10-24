export function SearchForm({ defaultValue = '' }: { defaultValue?: string }) {
  return (
    <form action="/search" method="get" role="search" className="flex flex-wrap gap-2">
      <label htmlFor="search-q" className="sr-only">
        歌名、歌手或來源網址
      </label>
      <input
        id="search-q"
        name="q"
        type="search"
        required
        maxLength={100}
        defaultValue={defaultValue}
        placeholder="歌名、歌手或來源網址"
        className="min-h-11 min-w-0 flex-1 rounded-md border border-border bg-surface px-3"
      />
      <button type="submit" className="min-h-11 rounded-md bg-ink px-5 font-medium text-surface">
        搜尋
      </button>
    </form>
  );
}
