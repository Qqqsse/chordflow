import { parseChordOrThrow } from '@chordflow/music-theory';
import { describe, expect, it } from 'vitest';
import fullZh from '../../../fixtures/charts/demo-full-zh.chart.json';
import { CURATED, getVoicingById, voicingLibrary } from './library';
import { difficultyOf, findVoicings, recommendVoicings, resolveVoicing } from './recommend';
import { midiOf, STANDARD_TUNING, type Tuning } from './tuning';
import {
  checkPlayability,
  fretsToken,
  validateVoicing,
  voicingId,
  type Frets,
  type Voicing,
} from './voicing';

function frets(token: string): Frets {
  return Array.from(token, (c) => (c === 'x' ? -1 : parseInt(c, 36))) as unknown as Frets;
}

function shape(token: string): Pick<Voicing, 'frets' | 'fingers' | 'barres'> {
  return { frets: frets(token), fingers: null, barres: [] };
}

/** Library entry (with its barres and fingers) when there is one, else a bare shape. */
const valid = (token: string, symbol: string, tuning: Tuning = STANDARD_TUNING) =>
  validateVoicing(getVoicingById(`v_${token}`) ?? shape(token), parseChordOrThrow(symbol), tuning);

describe('tuning', () => {
  it('maps scientific pitch to MIDI', () => {
    expect(STANDARD_TUNING.map(midiOf)).toEqual([40, 45, 50, 55, 59, 64]);
    expect(midiOf('C4')).toBe(60);
    expect(() => midiOf('H2')).toThrow();
  });
});

describe('ids', () => {
  it('encodes frets unambiguously, including frets ≥ 10', () => {
    expect(fretsToken(frets('x32010'))).toBe('x32010');
    expect(voicingId([-1, 10, 12, 12, 12, 10])).toBe('v_xaccca');
  });
});

describe('SPEC §7 required fixture cases', () => {
  it('C = x32010 and x35553 are both valid', () => {
    expect(valid('x32010', 'C').valid).toBe(true);
    expect(valid('x35553', 'C').valid).toBe(true);
    const ids = findVoicings(parseChordOrThrow('C')).map((v) => v.voicing.id);
    expect(ids).toEqual(expect.arrayContaining(['v_x32010', 'v_x35553']));
  });

  it('G/B requires B as the lowest sounding pitch', () => {
    expect(valid('x20003', 'G/B').valid).toBe(true);
    expect(valid('320003', 'G/B').issues.map((i) => i.code)).toContain('WRONG_BASS');
    // An unintended sounding low E string adds a wrong bass and a foreign note.
    expect(valid('020003', 'G/B').issues.map((i) => i.code)).toEqual(
      expect.arrayContaining(['WRONG_BASS', 'FOREIGN_NOTE']),
    );
  });

  it('F has a full barre 133211 and an easy xx3211 with labels', () => {
    const full = getVoicingById('v_133211');
    const easy = getVoicingById('v_xx3211');
    expect(full?.label).toBe('封閉和弦');
    expect(easy?.label).toBe('簡易');
    expect(full && difficultyOf(full)).toBe('intermediate');
    expect(easy && difficultyOf(easy)).toBe('easy');
    expect(valid('133211', 'F').valid).toBe(true);
    expect(valid('xx3211', 'F').valid).toBe(true);
  });

  it('Cadd9 = x32033', () => {
    expect(valid('x32033', 'Cadd9').valid).toBe(true);
    expect(valid('x32010', 'Cadd9').issues.map((i) => i.code)).toContain('MISSING_CHORD_TONE');
  });

  it('F#m7b5 validates 2x221x and rejects a near miss', () => {
    expect(valid('2x221x', 'F#m7b5').valid).toBe(true);
    expect(valid('2x222x', 'F#m7b5').issues.map((i) => i.code)).toContain('FOREIGN_NOTE');
  });

  it('inversions: the bass decides', () => {
    expect(valid('032010', 'C/E').valid).toBe(true);
    expect(valid('032010', 'C').issues.map((i) => i.code)).toEqual(['WRONG_BASS']);
    expect(valid('2x0232', 'D/F#').valid).toBe(true);
  });

  it('validates against nonstandard tuning instead of assuming standard shapes', () => {
    const dropD: Tuning = ['D2', 'A2', 'D3', 'G3', 'B3', 'E4'];
    expect(valid('000232', 'D', dropD).valid).toBe(true);
    expect(valid('xx0232', 'D', dropD).valid).toBe(true);
    expect(valid('320003', 'G', dropD).valid).toBe(false);
    const result = recommendVoicings(parseChordOrThrow('G'), { tuning: dropD });
    for (const r of result.ranked) expect(r.check.valid).toBe(true);
  });

  it('exotic chords return a transparent unsupported state', () => {
    expect(recommendVoicings(parseChordOrThrow('C13b9'))).toEqual({
      status: 'unsupported',
      reason: 'NO_VERIFIED_VOICING',
      ranked: [],
    });
  });

  it('capo shapes are ordinary shape chords (validation is pitch-relative to the open strings)', () => {
    // Concert D with capo 2 is played as a C shape: validate the shape, not the concert chord.
    expect(valid('x32010', 'C').valid).toBe(true);
  });
});

describe('curated library', () => {
  it.each(CURATED.map((e) => [e.chord, e.frets] as const))(
    '%s %s validates and is playable',
    (chord, token) => {
      const voicing = getVoicingById(`v_${token}`);
      expect(voicing).not.toBeNull();
      if (!voicing) return;
      const check = validateVoicing(voicing, parseChordOrThrow(chord));
      expect(check.issues).toEqual([]);
    },
  );

  it('every movable shape that is kept is playable', () => {
    for (const v of voicingLibrary()) expect(checkPlayability(v), v.id).toEqual([]);
  });

  it('has unique ids', () => {
    const ids = voicingLibrary().map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('covers every chord in the demo fixtures except deliberately unsupported ones', () => {
    const symbols = new Set(
      fullZh.sections.flatMap((s) => s.lines.flatMap((l) => l.chords.map((c) => c.symbol))),
    );
    const missing = [...symbols].filter(
      (s) => recommendVoicings(parseChordOrThrow(s)).status === 'unsupported',
    );
    expect(missing).toEqual(['B7/D#']);
  });
});

describe('playability checks', () => {
  it.each<[string, string]>([
    ['x3xxx0', 'TOO_FEW_STRINGS'],
    ['1x6xxx', 'TOO_FEW_STRINGS'],
    ['13x80x', 'SPAN_TOO_WIDE'],
  ])('%s → %s', (token, code) => {
    expect(checkPlayability(shape(token)).map((i) => i.code)).toContain(code);
  });

  it('a five-note fretted shape needs a barre to be playable', () => {
    expect(checkPlayability(shape('x35553')).map((i) => i.code)).toEqual(['TOO_MANY_FINGERS']);
    expect(
      checkPlayability({
        ...shape('x35553'),
        barres: [{ fret: 3, fromString: 1, toString: 5, finger: 1 }],
      }),
    ).toEqual([]);
  });

  it('rejects fingers on open strings, bad barres and five fingers', () => {
    expect(
      checkPlayability({
        frets: frets('x32010'),
        fingers: ['T', 3, 2, 1, 1, null],
        barres: [],
      }).map((i) => i.code),
    ).toContain('FINGER_ON_OPEN_STRING');
    expect(
      checkPlayability({
        frets: frets('x32010'),
        fingers: null,
        barres: [{ fret: 1, fromString: 0, toString: 5, finger: 1 }],
      }).map((i) => i.code),
    ).toContain('BARRE_INVALID');
    expect(checkPlayability(shape('x23434')).map((i) => i.code)).toContain('TOO_MANY_FINGERS');
  });
});

describe('recommendation', () => {
  it('prefers open shapes for easy players', () => {
    const top = recommendVoicings(parseChordOrThrow('C'));
    expect(top.status === 'ok' && top.ranked[0]?.voicing.id).toBe('v_x32010');
    const f = recommendVoicings(parseChordOrThrow('F'), { preferredDifficulty: 'easy' });
    expect(f.status === 'ok' && f.ranked[0]?.voicing.id).toBe('v_xx3211');
  });

  it('is deterministic', () => {
    const a = recommendVoicings(parseChordOrThrow('Bm'));
    const b = recommendVoicings(parseChordOrThrow('Bm'));
    expect(a.ranked.map((r) => r.voicing.id)).toEqual(b.ranked.map((r) => r.voicing.id));
  });

  it('transition cost favours shapes near the previous chord', () => {
    const previous = getVoicingById('v_x57775');
    const near = recommendVoicings(parseChordOrThrow('A'), {
      previous,
      preferredDifficulty: 'advanced',
    });
    const far = recommendVoicings(parseChordOrThrow('A'), { preferredDifficulty: 'advanced' });
    expect(near.ranked[0]?.score).toBeGreaterThanOrEqual(far.ranked[0]?.score ?? 0);
    expect(near.ranked.map((r) => r.voicing.id)).toContain('v_577655');
  });

  it('resolves user > occurrence > arrangement > recommended, ignoring invalid ids', () => {
    const chord = parseChordOrThrow('C');
    const policy = {
      symbolDefaults: { C: 'v_x35553' },
      occurrenceOverrides: { occ2: 'v_x32010', occ3: 'v_xx3211' },
    };
    expect(resolveVoicing(chord, 'occ1', 'C', policy)).toMatchObject({ source: 'arrangement' });
    expect(resolveVoicing(chord, 'occ1', 'C', policy).selected?.voicing.id).toBe('v_x35553');
    expect(resolveVoicing(chord, 'occ2', 'C', policy).selected?.voicing.id).toBe('v_x32010');
    expect(resolveVoicing(chord, 'occ2', 'C', policy, { userChoice: 'v_x35553' })).toMatchObject({
      source: 'user',
    });
    const invalid = resolveVoicing(chord, 'occ3', 'C', {
      occurrenceOverrides: { occ3: 'v_xx3211' },
    });
    expect(invalid).toMatchObject({ source: 'recommended', ignored: ['v_xx3211'] });
  });

  it('resolving never mutates the policy object', () => {
    const policy = Object.freeze({ occurrenceOverrides: Object.freeze({ a: 'v_x32010' }) });
    expect(() =>
      resolveVoicing(parseChordOrThrow('C'), 'a', 'C', policy, { userChoice: 'v_x35553' }),
    ).not.toThrow();
  });
});
