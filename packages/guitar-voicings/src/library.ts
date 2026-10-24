import {
  voicingId,
  type Barre,
  type Finger,
  type Fingers,
  type Frets,
  type Voicing,
  type VoicingDifficulty,
} from './voicing';

/*
 * Curated standard-tuning shapes (SPEC §7). Every entry names the chord it
 * was written for; tests validate each one against that chord, so a typo can
 * never ship as a "valid" fingering. Movable E- and A-shape templates are
 * instantiated at frets 1–12 and kept only where validation succeeds.
 */

function parseFrets(token: string): Frets {
  if (token.length !== 6) throw new RangeError(`frets token must have 6 strings: ${token}`);
  return Array.from(token, (c) => (c === 'x' ? -1 : parseInt(c, 36))) as unknown as Frets;
}

function parseFingers(token: string): Fingers {
  return Array.from(token, (c): Finger => {
    if (c === '-') return null;
    if (c === 'T') return 'T';
    const n = Number(c);
    if (n === 1 || n === 2 || n === 3 || n === 4) return n;
    throw new RangeError(`bad finger "${c}"`);
  }) as unknown as Fingers;
}

export interface CuratedEntry {
  /** Chord symbol this shape was written for (validated in tests). */
  chord: string;
  frets: string;
  fingers: string | null;
  barre?: [fret: number, from: number, to: number];
  difficulty?: VoicingDifficulty;
  label?: string;
  tags?: string[];
}

export const CURATED: readonly CuratedEntry[] = [
  // Major
  { chord: 'C', frets: 'x32010', fingers: '-32-1-', label: '開放' },
  { chord: 'C', frets: 'x35553', fingers: '-13331', barre: [3, 1, 5], label: '封閉和弦' },
  { chord: 'D', frets: 'xx0232', fingers: '---132', label: '開放' },
  { chord: 'E', frets: '022100', fingers: '-231--', label: '開放' },
  { chord: 'G', frets: '320003', fingers: '21---3', label: '開放' },
  { chord: 'G', frets: '320033', fingers: '21--34', label: '開放（搖滾式）' },
  { chord: 'A', frets: 'x02220', fingers: '--123-', label: '開放' },
  {
    chord: 'F',
    frets: '133211',
    fingers: '134211',
    barre: [1, 0, 5],
    difficulty: 'intermediate',
    label: '封閉和弦',
  },
  {
    chord: 'F',
    frets: 'xx3211',
    fingers: '--3211',
    barre: [1, 4, 5],
    difficulty: 'easy',
    label: '簡易',
  },
  { chord: 'B', frets: 'x24442', fingers: '-13331', barre: [2, 1, 5], label: '封閉和弦' },
  { chord: 'Bb', frets: 'x13331', fingers: '-13331', barre: [1, 1, 5], label: '封閉和弦' },
  { chord: 'Eb', frets: 'xx1343', fingers: '--1243', label: '高把位簡易' },
  // Minor
  { chord: 'Am', frets: 'x02210', fingers: '--231-', label: '開放' },
  { chord: 'Em', frets: '022000', fingers: '-23---', label: '開放' },
  { chord: 'Dm', frets: 'xx0231', fingers: '---231', label: '開放' },
  { chord: 'Bm', frets: 'x24432', fingers: '-13421', barre: [2, 1, 5], label: '封閉和弦' },
  // Dominant seventh
  { chord: 'C7', frets: 'x32310', fingers: '-3241-', label: '開放' },
  { chord: 'D7', frets: 'xx0212', fingers: '---213', label: '開放' },
  { chord: 'E7', frets: '020100', fingers: '-2-1--', label: '開放' },
  { chord: 'G7', frets: '320001', fingers: '32---1', label: '開放' },
  { chord: 'A7', frets: 'x02020', fingers: '--2-3-', label: '開放' },
  { chord: 'B7', frets: 'x21202', fingers: '-213-4', label: '開放' },
  // Minor seventh
  { chord: 'Am7', frets: 'x02010', fingers: '--2-1-', label: '開放' },
  { chord: 'Em7', frets: '022030', fingers: '-23-4-', label: '開放' },
  { chord: 'Em7', frets: '020000', fingers: '-2----', label: '簡易' },
  { chord: 'Dm7', frets: 'xx0211', fingers: '---211', label: '開放' },
  { chord: 'Bm7', frets: 'x20202', fingers: '-2-3-4', label: '開放' },
  // Major seventh
  { chord: 'Cmaj7', frets: 'x32000', fingers: '-32---', label: '開放' },
  { chord: 'Fmaj7', frets: 'xx3210', fingers: '--321-', label: '簡易' },
  { chord: 'Gmaj7', frets: '320002', fingers: '32---1', label: '開放' },
  { chord: 'Amaj7', frets: 'x02120', fingers: '--213-', label: '開放' },
  { chord: 'Dmaj7', frets: 'xx0222', fingers: '---111', label: '開放' },
  { chord: 'Emaj7', frets: '021100', fingers: '-312--', label: '開放' },
  // Suspended / added
  { chord: 'Dsus2', frets: 'xx0230', fingers: '---13-', label: '開放' },
  { chord: 'Dsus4', frets: 'xx0233', fingers: '---134', label: '開放' },
  { chord: 'Asus2', frets: 'x02200', fingers: '--12--', label: '開放' },
  { chord: 'Asus4', frets: 'x02230', fingers: '--123-', label: '開放' },
  { chord: 'Esus4', frets: '022200', fingers: '-234--', label: '開放' },
  { chord: 'Gsus4', frets: '330013', fingers: '23--14', label: '開放' },
  { chord: 'Cadd9', frets: 'x32033', fingers: '-21-34', label: '開放' },
  { chord: 'Gadd9', frets: '320203', fingers: '21-3-4', label: '開放' },
  { chord: 'D7sus4', frets: 'xx0213', fingers: '---213', label: '開放' },
  { chord: 'A7sus4', frets: 'x02030', fingers: '--2-3-', label: '開放' },
  { chord: 'E7sus4', frets: '020200', fingers: '-2-3--', label: '開放' },
  { chord: 'D9sus4', frets: 'x55555', fingers: '-11111', barre: [5, 1, 5], label: '封閉和弦' },
  // Sixth
  { chord: 'C6', frets: 'x32210', fingers: '-4231-', label: '開放' },
  { chord: 'A6', frets: 'x02222', fingers: '--1111', label: '開放' },
  { chord: 'G6', frets: '320000', fingers: '21----', label: '開放' },
  { chord: 'E6', frets: '022120', fingers: '-2314-', label: '開放' },
  // Diminished / half-diminished
  { chord: 'Bdim', frets: 'x2343x', fingers: '-1342-', label: '開放' },
  { chord: 'Bdim7', frets: 'x2313x', fingers: '-2314-', label: '開放' },
  { chord: 'Bm7b5', frets: 'x2323x', fingers: '-1324-', label: '開放' },
  { chord: 'F#m7b5', frets: '2x221x', fingers: '2-341-', label: '開放' },
  // Slash chords
  { chord: 'G/B', frets: 'x20003', fingers: '-1---3', label: '開放' },
  { chord: 'C/E', frets: '032010', fingers: '-32-1-', label: '開放' },
  { chord: 'C/G', frets: '332010', fingers: '432-1-', label: '開放' },
  { chord: 'D/F#', frets: '2x0232', fingers: 'T--132', label: '拇指按低音' },
  { chord: 'D/A', frets: 'x00232', fingers: '---132', label: '開放' },
  { chord: 'Am/G', frets: '3x2210', fingers: '4-231-', label: '開放' },
  { chord: 'F/C', frets: 'x33211', fingers: '-34211', barre: [1, 4, 5], label: '開放' },
  { chord: 'F/A', frets: 'x03211', fingers: '--3211', barre: [1, 4, 5], label: '開放' },
  { chord: 'Bb/D', frets: 'x5333x', fingers: '-3111-', barre: [3, 2, 4], label: '封閉和弦' },
];

interface Template {
  name: string;
  /** Offsets from the barre fret; -1 = muted. */
  offsets: readonly number[];
  fingers: string;
  barre: [from: number, to: number];
}

const TEMPLATES: readonly Template[] = [
  { name: 'E-shape major', offsets: [0, 2, 2, 1, 0, 0], fingers: '134211', barre: [0, 5] },
  { name: 'E-shape minor', offsets: [0, 2, 2, 0, 0, 0], fingers: '134111', barre: [0, 5] },
  { name: 'E-shape 7', offsets: [0, 2, 0, 1, 0, 0], fingers: '131211', barre: [0, 5] },
  { name: 'E-shape m7', offsets: [0, 2, 0, 0, 0, 0], fingers: '131111', barre: [0, 5] },
  { name: 'E-shape sus4', offsets: [0, 2, 2, 2, 0, 0], fingers: '123411', barre: [0, 5] },
  { name: 'E-shape 7sus4', offsets: [0, 2, 0, 2, 0, 0], fingers: '131411', barre: [0, 5] },
  { name: 'A-shape major', offsets: [-1, 0, 2, 2, 2, 0], fingers: '-13331', barre: [1, 5] },
  { name: 'A-shape minor', offsets: [-1, 0, 2, 2, 1, 0], fingers: '-13421', barre: [1, 5] },
  { name: 'A-shape 7', offsets: [-1, 0, 2, 0, 2, 0], fingers: '-13141', barre: [1, 5] },
  { name: 'A-shape m7', offsets: [-1, 0, 2, 0, 1, 0], fingers: '-13121', barre: [1, 5] },
  { name: 'A-shape maj7', offsets: [-1, 0, 2, 1, 2, 0], fingers: '-13241', barre: [1, 5] },
  { name: 'A-shape sus2', offsets: [-1, 0, 2, 2, 0, 0], fingers: '-13411', barre: [1, 5] },
  { name: 'A-shape sus4', offsets: [-1, 0, 2, 2, 3, 0], fingers: '-12341', barre: [1, 5] },
  { name: 'A-shape m7b5', offsets: [-1, 0, 1, 0, 1, -1], fingers: '-1213-', barre: [1, 3] },
];

function curatedVoicing(entry: CuratedEntry): Voicing {
  const frets = parseFrets(entry.frets);
  const barres: Barre[] = entry.barre
    ? [{ fret: entry.barre[0], fromString: entry.barre[1], toString: entry.barre[2], finger: 1 }]
    : [];
  return {
    id: voicingId(frets),
    frets,
    fingers: entry.fingers === null ? null : parseFingers(entry.fingers),
    barres,
    tags: entry.tags ?? [],
    source: 'curated',
    difficulty: entry.difficulty ?? null,
    label: entry.label ?? null,
  };
}

function templateVoicings(): Voicing[] {
  const out: Voicing[] = [];
  for (const t of TEMPLATES) {
    for (let fret = 1; fret <= 12; fret += 1) {
      const frets = t.offsets.map((o) => (o < 0 ? -1 : o + fret)) as unknown as Frets;
      out.push({
        id: voicingId(frets),
        frets,
        fingers: parseFingers(t.fingers),
        barres: [{ fret, fromString: t.barre[0], toString: t.barre[1], finger: 1 }],
        tags: [t.name],
        source: 'curated_movable',
        difficulty: null,
        label: '封閉和弦',
      });
    }
  }
  return out;
}

let cache: readonly Voicing[] | undefined;

/** All library voicings (curated first; movable duplicates of curated shapes dropped). */
export function voicingLibrary(): readonly Voicing[] {
  if (cache) return cache;
  const byId = new Map<string, Voicing>();
  for (const v of [...CURATED.map(curatedVoicing), ...templateVoicings()]) {
    if (!byId.has(v.id)) byId.set(v.id, v);
  }
  cache = [...byId.values()];
  return cache;
}

export function getVoicingById(id: string): Voicing | null {
  return voicingLibrary().find((v) => v.id === id) ?? null;
}
