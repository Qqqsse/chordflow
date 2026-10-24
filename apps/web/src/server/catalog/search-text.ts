/**
 * Search normalization shared by every catalog adapter: NFKC, lower case,
 * and no whitespace, punctuation or symbols. Traditional/Simplified and other
 * spellings are matched through stored aliases, never by guessing.
 */
export function normalizeSearchText(input: string): string {
  return input
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

/** Combined, normalized search field for a Work. */
export function buildWorkSearchText(parts: readonly string[]): string {
  const seen = new Set<string>();
  for (const part of parts) {
    const normalized = normalizeSearchText(part);
    if (normalized !== '') seen.add(normalized);
  }
  return [...seen].join('|');
}

export const MIN_QUERY_LENGTH = 1;
export const MAX_QUERY_LENGTH = 100;
