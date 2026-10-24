import {
  ChordSymbolTextSchema,
  countGraphemes,
  type ChartDocument,
  type ChartLine,
  type ChordEvent,
  type SectionKind,
} from '@chordflow/chart-schema';
import { parseChord } from '@chordflow/music-theory';

/*
 * In-browser chart editor state (SPEC §16 M9). Edits produce a new document
 * value that is saved as a *new* revision; nothing here mutates a stored
 * revision. Every action either yields a valid chart or leaves it unchanged
 * with an error message.
 */

export interface ChordRef {
  section: number;
  line: number;
  chord: number;
}

export interface EditorState {
  doc: ChartDocument;
  selected: ChordRef | null;
  dirty: boolean;
  error: string | null;
  /** Counter for ids of chords added in this session. */
  nextId: number;
}

export type EditorAction =
  | { type: 'select'; section: number; line: number; chord: number }
  | { type: 'clearSelection' }
  /** `offset: null` places the chord off the lyrics (chord-only lines). */
  | { type: 'moveSelected'; section: number; line: number; offset: number | null }
  | { type: 'add'; section: number; line: number; offset: number | null; symbol: string }
  | { type: 'renameSelected'; symbol: string }
  | { type: 'removeSelected' }
  | { type: 'setSection'; section: number; kind: SectionKind; label: string | null }
  | { type: 'reset'; doc: ChartDocument };

export function createEditorState(doc: ChartDocument): EditorState {
  return { doc, selected: null, dirty: false, error: null, nextId: 1 };
}

/** The chord name must be acceptable to both the schema and the theory engine. */
export function checkChordSymbol(symbol: string): string | null {
  const text = symbol.trim();
  if (!ChordSymbolTextSchema.safeParse(text).success || !parseChord(text).ok) {
    return `無法辨識的和弦名稱「${symbol}」`;
  }
  return null;
}

/** Chords on a lyric line are kept in position order; unanchored ones keep their order. */
function sortChords(chords: ChordEvent[]): ChordEvent[] {
  return chords
    .map((chord, index) => ({ chord, index }))
    .sort(
      (a, b) =>
        (a.chord.anchor?.graphemeOffset ?? Number.MAX_SAFE_INTEGER) -
          (b.chord.anchor?.graphemeOffset ?? Number.MAX_SAFE_INTEGER) || a.index - b.index,
    )
    .map((x) => x.chord);
}

/** A lyric line needs an offset within 0…length; a chord-only line takes none. */
function anchorFor(line: ChartLine, offset: number | null): ChordEvent['anchor'] | 'invalid' {
  if (line.text === '') return null;
  if (offset === null) return 'invalid';
  return Number.isInteger(offset) && offset >= 0 && offset <= countGraphemes(line.text)
    ? { graphemeOffset: offset }
    : 'invalid';
}

function usedIds(doc: ChartDocument): Set<string> {
  return new Set(
    doc.sections.flatMap((s) => [
      s.id,
      ...s.lines.flatMap((l) => [l.id, ...l.chords.map((c) => c.id)]),
    ]),
  );
}

function updateLine(
  doc: ChartDocument,
  section: number,
  line: number,
  update: (line: ChartLine) => ChartLine,
): ChartDocument {
  return {
    ...doc,
    sections: doc.sections.map((s, si) =>
      si !== section ? s : { ...s, lines: s.lines.map((l, li) => (li === line ? update(l) : l)) },
    ),
  };
}

const fail = (state: EditorState, error: string): EditorState => ({ ...state, error });

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  const { doc } = state;
  const lineAt = (section: number, line: number) => doc.sections[section]?.lines[line];
  const selectedChord = () =>
    state.selected === null
      ? undefined
      : lineAt(state.selected.section, state.selected.line)?.chords[state.selected.chord];

  switch (action.type) {
    case 'select':
      return lineAt(action.section, action.line)?.chords[action.chord] === undefined
        ? state
        : { ...state, selected: { ...action }, error: null };
    case 'clearSelection':
      return { ...state, selected: null, error: null };
    case 'moveSelected': {
      const chord = selectedChord();
      const target = lineAt(action.section, action.line);
      if (chord === undefined || state.selected === null || target === undefined) return state;
      const anchor = anchorFor(target, action.offset);
      if (anchor === 'invalid') return fail(state, '這個位置不能放和弦');
      const from = state.selected;
      const moved: ChordEvent = { ...chord, anchor };
      let next = updateLine(doc, from.section, from.line, (l) => ({
        ...l,
        chords: l.chords.filter((_, i) => i !== from.chord),
      }));
      next = updateLine(next, action.section, action.line, (l) => ({
        ...l,
        chords: sortChords([...l.chords, moved]),
      }));
      const index = next.sections[action.section]?.lines[action.line]?.chords.indexOf(moved) ?? -1;
      return {
        ...state,
        doc: next,
        dirty: true,
        error: null,
        selected:
          index === -1 ? null : { section: action.section, line: action.line, chord: index },
      };
    }
    case 'add': {
      const target = lineAt(action.section, action.line);
      if (target === undefined) return state;
      const problem = checkChordSymbol(action.symbol);
      if (problem !== null) return fail(state, problem);
      const anchor = anchorFor(target, action.offset);
      if (anchor === 'invalid') return fail(state, '這個位置不能放和弦');
      const ids = usedIds(doc);
      let n = state.nextId;
      while (ids.has(`ch_edit_${String(n)}`)) n += 1;
      const added: ChordEvent = {
        id: `ch_edit_${String(n)}`,
        symbol: action.symbol.trim(),
        anchor,
      };
      return {
        ...state,
        doc: updateLine(doc, action.section, action.line, (l) => ({
          ...l,
          chords: sortChords([...l.chords, added]),
        })),
        nextId: n + 1,
        dirty: true,
        error: null,
        selected: null,
      };
    }
    case 'renameSelected': {
      const chord = selectedChord();
      if (chord === undefined || state.selected === null) return state;
      const problem = checkChordSymbol(action.symbol);
      if (problem !== null) return fail(state, problem);
      const { section, line, chord: index } = state.selected;
      return {
        ...state,
        doc: updateLine(doc, section, line, (l) => ({
          ...l,
          chords: l.chords.map((c, i) =>
            i === index ? { ...c, symbol: action.symbol.trim() } : c,
          ),
        })),
        dirty: true,
        error: null,
      };
    }
    case 'removeSelected': {
      if (selectedChord() === undefined || state.selected === null) return state;
      const { section, line, chord: index } = state.selected;
      return {
        ...state,
        doc: updateLine(doc, section, line, (l) => ({
          ...l,
          chords: l.chords.filter((_, i) => i !== index),
        })),
        dirty: true,
        error: null,
        selected: null,
      };
    }
    case 'setSection': {
      if (doc.sections[action.section] === undefined) return state;
      const label = action.label?.trim() ?? '';
      if (label.length > 80) return fail(state, '段落名稱最多 80 個字');
      return {
        ...state,
        doc: {
          ...doc,
          sections: doc.sections.map((s, i) => {
            if (i !== action.section) return s;
            const { label: _old, ...rest } = s;
            return { ...rest, kind: action.kind, ...(label === '' ? {} : { label }) };
          }),
        },
        dirty: true,
        error: null,
      };
    }
    case 'reset':
      return createEditorState(action.doc);
  }
}
