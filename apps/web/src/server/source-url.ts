/**
 * Allowlisted source URL parsing (SPEC §9, §12). Extracts a platform id from
 * a user-supplied URL for catalog lookup only — the URL is never fetched,
 * and anything not on the allowlist is rejected.
 */

export type SourceUrlResult =
  | { kind: 'not_url' }
  | { kind: 'unsupported'; reason: 'NOT_HTTPS' | 'HOST_NOT_ALLOWED' | 'NO_ID' | 'INVALID_URL' }
  | { kind: 'source'; platform: 'youtube' | 'spotify'; platformSourceId: string };

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;

export function looksLikeUrl(input: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(input.trim()) || /^www\./i.test(input.trim());
}

export function parseSourceUrl(input: string): SourceUrlResult {
  const text = input.trim();
  if (!looksLikeUrl(text)) return { kind: 'not_url' };
  let url: URL;
  try {
    url = new URL(/^www\./i.test(text) ? `https://${text}` : text);
  } catch {
    return { kind: 'unsupported', reason: 'INVALID_URL' };
  }
  if (url.protocol !== 'https:') return { kind: 'unsupported', reason: 'NOT_HTTPS' };
  if (url.username !== '' || url.password !== '' || url.port !== '') {
    return { kind: 'unsupported', reason: 'HOST_NOT_ALLOWED' };
  }
  const host = url.hostname.toLowerCase();

  if (['www.youtube.com', 'youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(host)) {
    const id =
      url.pathname === '/watch'
        ? url.searchParams.get('v')
        : /^\/(?:shorts|live)\/([^/]+)$/.exec(url.pathname)?.[1];
    return id && YOUTUBE_ID.test(id)
      ? { kind: 'source', platform: 'youtube', platformSourceId: id }
      : { kind: 'unsupported', reason: 'NO_ID' };
  }
  if (host === 'youtu.be') {
    const id = url.pathname.slice(1);
    return YOUTUBE_ID.test(id)
      ? { kind: 'source', platform: 'youtube', platformSourceId: id }
      : { kind: 'unsupported', reason: 'NO_ID' };
  }
  if (host === 'open.spotify.com') {
    const id = /^\/(?:intl-[a-z-]+\/)?track\/([^/]+)$/.exec(url.pathname)?.[1];
    return id && SPOTIFY_ID.test(id)
      ? { kind: 'source', platform: 'spotify', platformSourceId: id }
      : { kind: 'unsupported', reason: 'NO_ID' };
  }
  return { kind: 'unsupported', reason: 'HOST_NOT_ALLOWED' };
}
