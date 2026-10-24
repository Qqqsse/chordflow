import { parseChartDocument, validateChartDocument } from '@chordflow/chart-schema';
import { describe, expect, it } from 'vitest';
import chart from '../../../../../fixtures/charts/demo-basic.chart.json';
import { createEditorState, editorReducer, type EditorState } from './editor-state';

const start = (): EditorState => createEditorState(parseChartDocument(chart));
const verseLine = (state: EditorState) => state.doc.sections[1]?.lines[0];

describe('chart editor reducer', () => {
  it('starts clean with nothing selected', () => {
    const state = start();
    expect(state).toMatchObject({ dirty: false, selected: null, error: null });
  });

  it('moves the selected chord to another character of the same line', () => {
    let state = start();
    state = editorReducer(state, { type: 'select', section: 1, line: 0, chord: 1 });
    state = editorReducer(state, { type: 'moveSelected', section: 1, line: 0, offset: 6 });
    expect(verseLine(state)?.chords.map((c) => [c.symbol, c.anchor?.graphemeOffset])).toEqual([
      ['C', 0],
      ['G/B', 6],
    ]);
    expect(state).toMatchObject({ dirty: true, selected: { section: 1, line: 0, chord: 1 } });
  });

  it('keeps chords ordered by position after a move', () => {
    let state = start();
    state = editorReducer(state, { type: 'select', section: 1, line: 0, chord: 1 });
    state = editorReducer(state, { type: 'moveSelected', section: 1, line: 0, offset: 0 });
    state = editorReducer(state, { type: 'select', section: 1, line: 0, chord: 0 });
    state = editorReducer(state, { type: 'moveSelected', section: 1, line: 0, offset: 7 });
    const offsets = verseLine(state)?.chords.map((c) => c.anchor?.graphemeOffset);
    expect(offsets).toEqual([...(offsets ?? [])].sort((a, b) => (a ?? 0) - (b ?? 0)));
  });

  it('moves a chord into a chord-only line as an unanchored chord', () => {
    let state = start();
    state = editorReducer(state, { type: 'select', section: 1, line: 0, chord: 0 });
    state = editorReducer(state, { type: 'moveSelected', section: 0, line: 0, offset: null });
    expect(state.doc.sections[0]?.lines[0]?.chords.map((c) => [c.symbol, c.anchor])).toEqual([
      ['C', null],
      ['C', null],
    ]);
    expect(verseLine(state)?.chords.map((c) => c.symbol)).toEqual(['G/B']);
  });

  it('adds, renames and removes chords; ids stay unique', () => {
    let state = start();
    state = editorReducer(state, { type: 'add', section: 1, line: 0, offset: 2, symbol: 'Am' });
    state = editorReducer(state, { type: 'add', section: 1, line: 0, offset: 3, symbol: 'F' });
    const ids = state.doc.sections.flatMap((s) => [
      s.id,
      ...s.lines.flatMap((l) => [l.id, ...l.chords.map((c) => c.id)]),
    ]);
    expect(new Set(ids).size).toBe(ids.length);
    state = editorReducer(state, { type: 'select', section: 1, line: 0, chord: 1 });
    state = editorReducer(state, { type: 'renameSelected', symbol: 'Am7' });
    expect(verseLine(state)?.chords[1]?.symbol).toBe('Am7');
    state = editorReducer(state, { type: 'removeSelected' });
    expect(verseLine(state)?.chords.map((c) => c.symbol)).toEqual(['C', 'F', 'G/B']);
    expect(state.selected).toBeNull();
  });

  it('refuses chord names the theory engine cannot read, without changing the chart', () => {
    let state = start();
    state = editorReducer(state, { type: 'select', section: 1, line: 0, chord: 0 });
    const before = state.doc;
    state = editorReducer(state, { type: 'renameSelected', symbol: 'H<b>' });
    expect(state.doc).toBe(before);
    expect(state.error).toMatch(/和弦/);
    state = editorReducer(state, { type: 'add', section: 1, line: 0, offset: 1, symbol: 'Xyz' });
    expect(state.doc).toBe(before);
  });

  it('rejects offsets outside the lyric line', () => {
    let state = start();
    state = editorReducer(state, { type: 'select', section: 1, line: 0, chord: 0 });
    const next = editorReducer(state, { type: 'moveSelected', section: 1, line: 0, offset: 99 });
    expect(next.doc).toBe(state.doc);
    expect(next.error).not.toBeNull();
  });

  it('changes section kind and label', () => {
    let state = start();
    state = editorReducer(state, {
      type: 'setSection',
      section: 1,
      kind: 'chorus',
      label: '副歌 A',
    });
    expect(state.doc.sections[1]).toMatchObject({ kind: 'chorus', label: '副歌 A' });
    state = editorReducer(state, { type: 'setSection', section: 1, kind: 'chorus', label: '' });
    expect(state.doc.sections[1]?.label).toBeUndefined();
  });

  it('every edit keeps a valid chart document', () => {
    let state = start();
    state = editorReducer(state, { type: 'add', section: 1, line: 0, offset: 7, symbol: 'F' });
    state = editorReducer(state, { type: 'select', section: 1, line: 0, chord: 0 });
    state = editorReducer(state, { type: 'moveSelected', section: 0, line: 0, offset: null });
    state = editorReducer(state, {
      type: 'setSection',
      section: 0,
      kind: 'interlude',
      label: null,
    });
    expect(validateChartDocument(state.doc).issues).toEqual([]);
  });
});
