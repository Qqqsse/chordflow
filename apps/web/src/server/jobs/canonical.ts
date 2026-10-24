import { createHash } from 'node:crypto';

/** JSON with object keys sorted recursively, so equal values serialize identically. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

export function sha256Of(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

const URL_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi;
const PATH_PATTERN = /(?:^|\s)(?:\/|[A-Za-z]:\\)[^\s]*/g;

/**
 * Worker error messages are shown to users: URLs (which may carry private
 * query tokens) and absolute paths are removed before storage.
 */
export function sanitizeWorkerMessage(message: string): string {
  return message
    .replace(URL_PATTERN, '[url]')
    .replace(PATH_PATTERN, (match) => `${match.startsWith(' ') ? ' ' : ''}[path]`)
    .slice(0, 300);
}
