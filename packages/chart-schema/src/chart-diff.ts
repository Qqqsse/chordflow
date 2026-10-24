import type { ChartDocument, ChartLine, ChartSection, ChordEvent } from './chart-document';

/*
 * Semantic diff between two chart revisions, for review (SPEC §11 step 8,
 * §16 M9 "review diff"). Revisions edited through ChordPro get fresh ids, so
 * sections and lines are aligned by id *or* content (longest common
 * subsequence), and chords within a line by position, then by symbol.
 *
 * Paths are indexes: removed items point into `before`, everything else
 * into `after`. Offsets are grapheme offsets (`null` = unanchored chord).
 */

export type DiffableChart = Pick<
  ChartDocument,
  'title' | 'language' | 'concertKey' | 'timeSignature' | 'defaultBpm' | 'sections'
>;

type Section = Pick<ChartSection, 'id' | 'kind' | 'label'> & { lines: readonly Line[] };
type Line = Pick<ChartLine, 'id' | 'text'> & { chords: readonly Chord[] };
type Chord = Pick<ChordEvent, 'symbol' | 'anchor'>;

const METADATA_FIELDS = ['title', 'language', 'concertKey', 'timeSignature', 'defaultBpm'] as const;

export type ChartChange =
  | {
      kind: 'metadata_changed';
      field: (typeof METADATA_FIELDS)[number];
      from: string | number | null;
      to: string | number | null;
    }
  | {
      kind: 'section_added' | 'section_removed';
      path: [number];
      sectionKind: ChartSection['kind'];
      label: string | null;
      lines: number;
    }
  | {
      kind: 'section_changed';
      path: [number];
      from: { sectionKind: ChartSection['kind']; label: string | null };
      to: { sectionKind: ChartSection['kind']; label: string | null };
    }
  | { kind: 'line_added' | 'line_removed'; path: [number, number]; text: string }
  | { kind: 'lyrics_changed'; path: [number, number]; from: string; to: string }
  | {
      kind: 'chord_added' | 'chord_removed';
      path: [number, number];
      offset: number | null;
      symbol: string;
    }
  | {
      kind: 'chord_changed';
      path: [number, number];
      offset: number | null;
      from: string;
      to: string;
    }
  | {
      kind: 'chord_moved';
      path: [number, number];
      symbol: string;
      fromOffset: number;
      toOffset: number;
    };

/**
 * Pairs items of `a` and `b`: an LCS over `same`, then the unmatched items
 * between two matches are paired in order (edits); leftovers are removals
 * (`[i, null]`) or additions (`[null, j]`).
 */
export function alignSequences<T>(
  a: readonly T[],
  b: readonly T[],
  same: (x: T, y: T) => boolean,
): [number | null, number | null][] {
  const n = a.length;
  const m = b.length;
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  const at = (i: number, j: number) => table[i]?.[j] ?? 0;
  for (let i = n - 1; i >= 0; i -= 1) {
    const row = table[i];
    if (row === undefined) continue;
    for (let j = m - 1; j >= 0; j -= 1) {
      const x = a[i];
      const y = b[j];
      row[j] =
        x !== undefined && y !== undefined && same(x, y)
          ? at(i + 1, j + 1) + 1
          : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  const pairs: [number | null, number | null][] = [];
  let gapA: number[] = [];
  let gapB: number[] = [];
  const flush = () => {
    const k = Math.min(gapA.length, gapB.length);
    for (let g = 0; g < k; g += 1) pairs.push([gapA[g] ?? null, gapB[g] ?? null]);
    for (const i of gapA.slice(k)) pairs.push([i, null]);
    for (const j of gapB.slice(k)) pairs.push([null, j]);
    gapA = [];
    gapB = [];
  };
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    const x = a[i];
    const y = b[j];
    if (x !== undefined && y !== undefined && same(x, y) && at(i, j) === at(i + 1, j + 1) + 1) {
      flush();
      pairs.push([i, j]);
      i += 1;
      j += 1;
    } else if (j >= m || (i < n && at(i + 1, j) >= at(i, j + 1))) {
      gapA.push(i);
      i += 1;
    } else {
      gapB.push(j);
      j += 1;
    }
  }
  flush();
  return pairs;
}

const ORDER: Readonly<Record<string, number>> = {
  chord_changed: 0,
  chord_moved: 1,
  chord_removed: 2,
  chord_added: 3,
};

function diffChords(
  before: readonly Chord[],
  after: readonly Chord[],
  path: [number, number],
): ChartChange[] {
  const anchored = (list: readonly Chord[]) =>
    list
      .filter((c) => c.anchor !== null)
      .map((c) => ({ symbol: c.symbol, offset: c.anchor?.graphemeOffset ?? 0 }));
  const b = anchored(before);
  const a = anchored(after);
  const usedB = new Set<number>();
  const usedA = new Set<number>();
  const changes: (ChartChange & { sortKey: number })[] = [];

  // 1. Same position: unchanged, or a different chord.
  a.forEach((chord, ai) => {
    const bi = b.findIndex((c, k) => !usedB.has(k) && c.offset === chord.offset);
    if (bi === -1) return;
    usedA.add(ai);
    usedB.add(bi);
    const old = b[bi];
    if (old !== undefined && old.symbol !== chord.symbol) {
      changes.push({
        kind: 'chord_changed',
        path,
        offset: chord.offset,
        from: old.symbol,
        to: chord.symbol,
        sortKey: chord.offset,
      });
    }
  });
  // 2. Same chord elsewhere: moved.
  a.forEach((chord, ai) => {
    if (usedA.has(ai)) return;
    const bi = b.findIndex((c, k) => !usedB.has(k) && c.symbol === chord.symbol);
    if (bi === -1) return;
    usedA.add(ai);
    usedB.add(bi);
    changes.push({
      kind: 'chord_moved',
      path,
      symbol: chord.symbol,
      fromOffset: b[bi]?.offset ?? 0,
      toOffset: chord.offset,
      sortKey: chord.offset,
    });
  });
  // 3. Everything else.
  b.forEach((chord, bi) => {
    if (!usedB.has(bi)) {
      changes.push({
        kind: 'chord_removed',
        path,
        offset: chord.offset,
        symbol: chord.symbol,
        sortKey: chord.offset,
      });
    }
  });
  a.forEach((chord, ai) => {
    if (!usedA.has(ai)) {
      changes.push({
        kind: 'chord_added',
        path,
        offset: chord.offset,
        symbol: chord.symbol,
        sortKey: chord.offset,
      });
    }
  });
  changes.sort((x, y) => x.sortKey - y.sortKey || (ORDER[x.kind] ?? 0) - (ORDER[y.kind] ?? 0));
  const result: ChartChange[] = changes.map(({ sortKey: _key, ...change }) => change);

  // Unanchored (instrumental) chords: compared in order.
  const ub = before.filter((c) => c.anchor === null).map((c) => c.symbol);
  const ua = after.filter((c) => c.anchor === null).map((c) => c.symbol);
  for (let k = 0; k < Math.max(ub.length, ua.length); k += 1) {
    const from = ub[k];
    const to = ua[k];
    if (from !== undefined && to !== undefined) {
      if (from !== to) result.push({ kind: 'chord_changed', path, offset: null, from, to });
    } else if (to !== undefined) {
      result.push({ kind: 'chord_added', path, offset: null, symbol: to });
    } else if (from !== undefined) {
      result.push({ kind: 'chord_removed', path, offset: null, symbol: from });
    }
  }
  return result;
}

function diffLines(before: Section, after: Section, si: number, bsi: number): ChartChange[] {
  const changes: ChartChange[] = [];
  const pairs = alignSequences(
    before.lines,
    after.lines,
    (x, y) => x.id === y.id || x.text === y.text,
  );
  for (const [bi, ai] of pairs) {
    const old = bi === null ? undefined : before.lines[bi];
    const now = ai === null ? undefined : after.lines[ai];
    if (old !== undefined && now !== undefined && ai !== null) {
      if (old.text !== now.text) {
        changes.push({ kind: 'lyrics_changed', path: [si, ai], from: old.text, to: now.text });
      }
      changes.push(...diffChords(old.chords, now.chords, [si, ai]));
    } else if (now !== undefined && ai !== null) {
      changes.push({ kind: 'line_added', path: [si, ai], text: now.text });
    } else if (old !== undefined && bi !== null) {
      changes.push({ kind: 'line_removed', path: [bsi, bi], text: old.text });
    }
  }
  return changes;
}

export function diffCharts(before: DiffableChart, after: DiffableChart): ChartChange[] {
  const changes: ChartChange[] = [];
  for (const field of METADATA_FIELDS) {
    if (before[field] !== after[field]) {
      changes.push({ kind: 'metadata_changed', field, from: before[field], to: after[field] });
    }
  }
  const pairs = alignSequences<Section>(
    before.sections,
    after.sections,
    (x, y) => x.id === y.id || x.kind === y.kind,
  );
  for (const [bi, ai] of pairs) {
    const old = bi === null ? undefined : before.sections[bi];
    const now = ai === null ? undefined : after.sections[ai];
    if (old !== undefined && now !== undefined && ai !== null && bi !== null) {
      if (old.kind !== now.kind || (old.label ?? null) !== (now.label ?? null)) {
        changes.push({
          kind: 'section_changed',
          path: [ai],
          from: { sectionKind: old.kind, label: old.label ?? null },
          to: { sectionKind: now.kind, label: now.label ?? null },
        });
      }
      changes.push(...diffLines(old, now, ai, bi));
    } else if (now !== undefined && ai !== null) {
      changes.push({
        kind: 'section_added',
        path: [ai],
        sectionKind: now.kind,
        label: now.label ?? null,
        lines: now.lines.length,
      });
    } else if (old !== undefined && bi !== null) {
      changes.push({
        kind: 'section_removed',
        path: [bi],
        sectionKind: old.kind,
        label: old.label ?? null,
        lines: old.lines.length,
      });
    }
  }
  return changes;
}
