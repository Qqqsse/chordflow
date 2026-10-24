'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

const GAP_PX = 32;

/**
 * Page/column reading mode (SPEC §8): content flows into fixed-height
 * columns read left to right; whole pages (1 or 2 columns) are navigated
 * explicitly with buttons or arrow/page keys — never a continuous scroll
 * through side-by-side columns.
 */
export function PagedSheet({ children, layoutKey }: { children: ReactNode; layoutKey: string }) {
  const viewport = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [pageWidth, setPageWidth] = useState(0);
  const [page, setPage] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [columns, setColumns] = useState(1);

  const measure = useCallback(() => {
    const el = viewport.current;
    const content = track.current;
    if (!el || !content) return;
    const cols = el.clientWidth >= 720 ? 2 : 1;
    setColumns(cols);
    const stride = el.clientWidth + GAP_PX;
    setPageWidth(stride);
    // The track is not a scroll container, so its overflowing columns are never clamped.
    const count = Math.max(1, Math.ceil((content.scrollWidth + GAP_PX - 1) / stride));
    setPageCount(count);
    setPage((p) => Math.min(p, count - 1));
  }, []);

  useLayoutEffect(() => {
    measure();
  }, [measure, layoutKey, columns]);

  useEffect(() => {
    const el = viewport.current;
    if (!el) return undefined;
    const observer = new ResizeObserver(() => {
      measure();
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [measure]);

  const go = useCallback(
    (delta: number) => {
      setPage((p) => Math.min(pageCount - 1, Math.max(0, p + delta)));
    },
    [pageCount],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName))
        return;
      if (event.key === 'ArrowRight' || event.key === 'PageDown') {
        event.preventDefault();
        go(1);
      } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        go(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [go]);

  return (
    <div className="space-y-2">
      <div
        ref={viewport}
        className="paged-viewport"
        data-testid="paged-viewport"
        aria-roledescription="分頁"
      >
        <div
          ref={track}
          className="paged-track"
          style={{
            columnCount: columns,
            columnGap: `${GAP_PX}px`,
            transform: `translateX(${String(-page * pageWidth)}px)`,
          }}
        >
          {children}
        </div>
      </div>
      <nav aria-label="翻頁" className="flex items-center justify-center gap-3">
        <button
          type="button"
          className="min-h-11 min-w-11 rounded-md border border-border px-3 text-sm disabled:opacity-40"
          disabled={page === 0}
          onClick={() => {
            go(-1);
          }}
        >
          上一頁
        </button>
        <span className="text-sm tabular-nums" aria-live="polite" data-testid="page-indicator">
          第 {page + 1} / {pageCount} 頁
        </span>
        <button
          type="button"
          className="min-h-11 min-w-11 rounded-md border border-border px-3 text-sm disabled:opacity-40"
          disabled={page >= pageCount - 1}
          onClick={() => {
            go(1);
          }}
        >
          下一頁
        </button>
      </nav>
    </div>
  );
}
