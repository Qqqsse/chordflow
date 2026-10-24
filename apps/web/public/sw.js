/*
 * chordflow service worker (SPEC §13).
 * - Precaches the offline library shell (/offline, /offline/view) and the
 *   static assets those pages reference, so explicitly saved charts open
 *   without a network connection.
 * - Never caches /api responses (private data) or other HTML pages.
 * - Bump VERSION to invalidate every cache on the next activation.
 */
const VERSION = 'v1';
const SHELL_CACHE = `chordflow-shell-${VERSION}`;
const STATIC_CACHE = `chordflow-static-${VERSION}`;
const SHELL_PAGES = ['/offline', '/offline/view'];

async function precacheShell() {
  const shell = await caches.open(SHELL_CACHE);
  const staticCache = await caches.open(STATIC_CACHE);
  for (const path of SHELL_PAGES) {
    const response = await fetch(path, { cache: 'no-cache', credentials: 'same-origin' });
    if (!response.ok) continue;
    const html = await response.clone().text();
    await shell.put(path, response);
    const assets = new Set(
      Array.from(html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g), (m) => m[1]),
    );
    await Promise.all(
      Array.from(assets, async (asset) => {
        try {
          const r = await fetch(asset);
          if (r.ok) await staticCache.put(asset, r);
        } catch {
          // Asset fetched lazily later.
        }
      }),
    );
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(precacheShell().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, STATIC_CACHE]);
      for (const name of await caches.keys()) {
        if (name.startsWith('chordflow-') && !keep.has(name)) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

const OFFLINE_HTML = `<!doctype html><html lang="zh-TW"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>目前離線 · chordflow</title><body style="font-family:system-ui,sans-serif;padding:2rem;line-height:1.6"><h1>目前離線</h1><p>這個頁面需要網路連線。已儲存的離線譜仍可使用。</p><p><a href="/offline">前往離線譜庫</a></p></body></html>`;

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) (await caches.open(STATIC_CACHE)).put(request, response.clone());
        return response;
      })(),
    );
    return;
  }

  if (request.mode === 'navigate') {
    const shellPath = SHELL_PAGES.includes(url.pathname) ? url.pathname : null;
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (shellPath && response.ok)
            (await caches.open(SHELL_CACHE)).put(shellPath, response.clone());
          return response;
        } catch {
          if (shellPath) {
            const cached = await caches.match(shellPath, { cacheName: SHELL_CACHE });
            if (cached) return cached;
          }
          return new Response(OFFLINE_HTML, {
            status: 503,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          });
        }
      })(),
    );
  }
});
