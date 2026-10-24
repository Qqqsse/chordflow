import { describe, expect, it } from 'vitest';
import { ViewerPreferencesSchema, type ViewerPreferences } from './library';

const base: ViewerPreferences = {
  version: 1,
  transposeSemitones: -2,
  capoFret: 3,
  capoMode: 'keep_pitch',
  show: 'shape',
  notation: 'roman',
  fontSize: 22,
  voicingChoices: { G: 'v_320003' },
  showDiagrams: false,
  readingMode: 'pages',
  scrollSpeed: 30,
};

describe('ViewerPreferences v1', () => {
  it('accepts a full preference set', () => {
    expect(ViewerPreferencesSchema.parse(base)).toEqual(base);
  });

  it.each([
    ['transpose beyond an octave', { transposeSemitones: 12 }],
    ['fractional transpose', { transposeSemitones: 1.5 }],
    ['capo above 12', { capoFret: 13 }],
    ['unknown capo mode', { capoMode: 'auto' }],
    ['font too small', { fontSize: 8 }],
    ['scroll too fast', { scrollSpeed: 500 }],
    ['other version', { version: 2 }],
    ['voicing id with markup', { voicingChoices: { G: '<script>' } }],
    ['unknown field', { theme: 'dark' }],
  ])('rejects %s', (_label, patch) => {
    expect(ViewerPreferencesSchema.safeParse({ ...base, ...patch }).success).toBe(false);
  });

  it('caps the number of saved voicing choices', () => {
    const many = Object.fromEntries(
      Array.from({ length: 65 }, (_, i) => [`C${String(i)}`, `v_${String(i)}`]),
    );
    expect(ViewerPreferencesSchema.safeParse({ ...base, voicingChoices: many }).success).toBe(
      false,
    );
  });
});
