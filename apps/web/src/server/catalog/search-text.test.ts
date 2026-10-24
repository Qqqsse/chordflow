import { describe, expect, it } from 'vitest';
import { buildWorkSearchText, normalizeSearchText } from './search-text';

describe('normalizeSearchText', () => {
  it.each<[string, string]>([
    ['示範歌曲（虛構）', '示範歌曲虛構'],
    ['  Paper  Boats! ', 'paperboats'],
    ['Ｆｕｌｌｗｉｄｔｈ', 'fullwidth'],
    ["Don't Stop", 'dontstop'],
    ['100%_match', '100match'],
    ['Café', 'café'],
  ])('%j → %j', (input, expected) => {
    expect(normalizeSearchText(input)).toBe(expected);
  });

  it('builds a deduplicated combined field', () => {
    expect(buildWorkSearchText(['送別', '送别', '送別', 'Farewell', ''])).toBe(
      '送別|送别|farewell',
    );
  });
});
