import { validateChartDocument } from '@chordflow/chart-schema';
import { describe, expect, it } from 'vitest';
import { MAX_INPUT_LENGTH, importChordPro, type ImportOptions, type ImportResult } from './import';
import { readText } from './testing';

const OPTIONS: ImportOptions = { chartRevisionId: 'rev_import', arrangementId: 'arr_import' };

function ok(source: string, options: Partial<ImportOptions> = {}) {
  const result = importChordPro(source, { ...OPTIONS, ...options });
  if (!result.ok) throw new Error(JSON.stringify(result.issues, null, 2));
  return result;
}

function codes(result: ImportResult): string[] {
  return result.issues.map((i) => i.code);
}

function line(result: ImportResult & { ok: true }, s = 0, l = 0) {
  const found = result.document.sections[s]?.lines[l];
  if (!found) throw new Error('missing line');
  return found;
}

describe('importChordPro: lyrics and chords', () => {
  it('anchors chords on Traditional Chinese lyrics by grapheme', () => {
    const r = ok('{title: 測試}\n[C]微風帶我[G/B]向前走');
    expect(line(r)).toEqual({
      id: 's1_l1',
      text: '微風帶我向前走',
      chords: [
        { id: 's1_l1_c1', symbol: 'C', anchor: { graphemeOffset: 0 } },
        { id: 's1_l1_c2', symbol: 'G/B', anchor: { graphemeOffset: 4 } },
      ],
    });
    expect(r.document.sections[0]?.kind).toBe('other');
  });

  it('keeps Western spaces and apostrophes', () => {
    const r = ok("{title: T}\nWe [Am]don't [F]stop, we're [C]home");
    expect(line(r).text).toBe("We don't stop, we're home");
    expect(line(r).chords.map((c) => c.anchor?.graphemeOffset)).toEqual([3, 9, 21]);
  });

  it('counts emoji and combining marks as single graphemes', () => {
    const r = ok('{title: T}\n👍🏽[D]好 café[E]!');
    expect(line(r).text).toBe('👍🏽好 café!');
    expect(line(r).chords.map((c) => c.anchor?.graphemeOffset)).toEqual([1, 7]);
  });

  it('rejects a chord placed inside a grapheme (before a combining mark)', () => {
    const r = importChordPro('{title: T}\ncafe[C]́', OPTIONS);
    expect(codes(r)).toEqual(['CHORD_INSIDE_GRAPHEME']);
  });

  it('turns chord-only lines into unanchored instrumental chords', () => {
    const r = ok('{title: T}\n[C]  [G]   [Am] [F]');
    expect(line(r)).toMatchObject({ text: '', chords: [{ anchor: null }, {}, {}, {}] });
    expect(line(r).chords.map((c) => c.symbol)).toEqual(['C', 'G', 'Am', 'F']);
  });

  it('accepts lyrics without chords and repeated chords', () => {
    const r = ok('{title: T}\n只有歌詞\n[C]啦[C]啦[C]啦');
    expect(line(r, 0, 0)).toMatchObject({ text: '只有歌詞', chords: [] });
    expect(line(r, 0, 1).chords.map((c) => c.anchor?.graphemeOffset)).toEqual([0, 1, 2]);
  });

  it('supports leading and trailing chord marks', () => {
    const r = ok('{title: T}\n[C]走吧[G]');
    expect(line(r).chords.map((c) => c.anchor?.graphemeOffset)).toEqual([0, 2]);
  });

  it('resolves escapes for literal brackets, braces and backslashes', () => {
    const r = ok('{title: T}\n\\# not a comment \\[x\\] \\{y\\} a\\\\b [C]go');
    expect(line(r).text).toBe('# not a comment [x] {y} a\\b go');
  });

  it('ignores # comment lines', () => {
    const r = ok('# header comment\n{title: T}\n# another\n歌');
    expect(r.document.sections[0]?.lines.map((l) => l.text)).toEqual(['歌']);
  });

  it('trims trailing whitespace but keeps leading spaces', () => {
    const r = ok('{title: T}\n  [C]縮排   \t');
    expect(line(r)).toMatchObject({ text: '  縮排', chords: [{ anchor: { graphemeOffset: 2 } }] });
  });

  it('normalizes lyrics to NFC', () => {
    const r = ok('{title: T}\nCafé');
    expect(line(r).text).toBe('Café');
    expect(validateChartDocument(r.document).ok).toBe(true);
  });

  it('warns about unsupported chord symbols but keeps them verbatim', () => {
    const r = ok('{title: T}\n[N.C.]停[C7alt]');
    expect(line(r).chords.map((c) => c.symbol)).toEqual(['N.C.', 'C7alt']);
    expect(codes(r)).toEqual(['UNSUPPORTED_CHORD', 'UNSUPPORTED_CHORD']);
    expect(r.issues.every((i) => i.severity === 'warning' && i.line === 2)).toBe(true);
  });
});

describe('importChordPro: directives and sections', () => {
  it('maps metadata directives and aliases', () => {
    const r = ok('{t: 標題}\n{st: 副標}\n{artist: 歌手}\n{key: Bb}\n{time: 6/8}\n{tempo: 92}\n歌');
    expect(r.metadata).toEqual({
      title: '標題',
      subtitles: ['副標'],
      artists: ['歌手'],
      key: 'Bb',
      capo: null,
      tempo: 92,
      time: '6/8',
    });
    expect(r.document).toMatchObject({
      title: '標題',
      concertKey: 'Bb',
      timeSignature: '6/8',
      defaultBpm: 92,
    });
    expect(r.document.importMetadata.format).toBe('chordpro');
  });

  it('reads verse, chorus and bridge environments with labels and aliases', () => {
    const r = ok(
      '{title: T}\n{sov}\n主歌\n{eov}\n{soc: 副歌 2}\n副歌\n{eoc}\n{start_of_bridge}\n橋段\n{end_of_bridge}',
    );
    expect(r.document.sections.map((s) => [s.kind, s.label ?? null])).toEqual([
      ['verse', null],
      ['chorus', '副歌 2'],
      ['bridge', null],
    ]);
  });

  it('reads chordflow section kinds via start_of_<kind>', () => {
    const r = ok(
      '{title: T}\n{start_of_intro}\n[C] [G]\n{end_of_intro}\n{start_of_pre_chorus}\n導\n{end_of_pre_chorus}',
    );
    expect(r.document.sections.map((s) => s.kind)).toEqual(['intro', 'pre_chorus']);
  });

  it('keeps blank lines inside sections but trims them at the edges', () => {
    const r = ok('{title: T}\n{sov}\n\n一\n\n二\n\n{eov}');
    expect(r.document.sections[0]?.lines.map((l) => l.text)).toEqual(['一', '', '二']);
  });

  it('preserves unknown directives with line numbers', () => {
    const r = ok('{title: T}\n{c: 輕柔地}\n{x_custom}\n歌');
    expect(r.document.importMetadata.unhandledDirectives).toEqual([
      { line: 2, name: 'c', value: '輕柔地' },
      { line: 3, name: 'x_custom', value: null },
    ]);
    expect(r.issues.filter((i) => i.code === 'UNKNOWN_DIRECTIVE').map((i) => i.line)).toEqual([
      2, 3,
    ]);
    expect(r.document.sections[0]?.lines.map((l) => l.text)).toEqual(['歌']);
  });

  it('uses defaultTitle only when the source has none', () => {
    expect(ok('歌', { defaultTitle: '未命名' }).document.title).toBe('未命名');
    expect(ok('{title: 有}\n歌', { defaultTitle: '未命名' }).document.title).toBe('有');
  });
});

describe('importChordPro: capo interpretation is explicit', () => {
  const source = '{title: T}\n{key: C}\n{capo: 2}\n[C]你[G/B]好[Am]';

  it('requires a choice when a capo is declared', () => {
    const r = importChordPro(source, OPTIONS);
    expect(r.ok).toBe(false);
    expect(codes(r)).toEqual(['CAPO_INTERPRETATION_REQUIRED']);
  });

  it('capo_shapes moves chords and key up to concert pitch', () => {
    const r = ok(source, { chordsWrittenAs: 'capo_shapes' });
    expect(r.document.concertKey).toBe('D');
    expect(line(r).chords.map((c) => c.symbol)).toEqual(['D', 'A/C#', 'Bm']);
    expect(r.metadata.capo).toBe(2);
  });

  it('concert keeps chords as written', () => {
    const r = ok(source, { chordsWrittenAs: 'concert' });
    expect(r.document.concertKey).toBe('C');
    expect(line(r).chords.map((c) => c.symbol)).toEqual(['C', 'G/B', 'Am']);
  });

  it('capo 0 needs no choice', () => {
    expect(ok('{title: T}\n{capo: 0}\n[C]歌').document.concertKey).toBeNull();
  });
});

describe('importChordPro: errors carry line numbers and nothing is guessed', () => {
  it.each<[string, string, string, number]>([
    ['empty input', '', 'EMPTY_DOCUMENT', 0],
    ['only directives', '{title: T}\n{key: C}', 'EMPTY_DOCUMENT', 0],
    ['missing title', '歌', 'TITLE_MISSING', 0],
    ['unclosed chord', '{title: T}\n[C歌', 'MALFORMED_CHORD', 2],
    ['empty chord', '{title: T}\n[]歌', 'MALFORMED_CHORD', 2],
    ['stray bracket', '{title: T}\n歌]', 'UNEXPECTED_BRACKET', 2],
    ['brace in lyrics', '{title: T}\n歌{x}', 'UNEXPECTED_BRACE', 2],
    ['annotation', '{title: T}\n[*Ritard]歌', 'UNSUPPORTED_ANNOTATION', 2],
    ['bad escape', '{title: T}\n\\n', 'BAD_ESCAPE', 2],
    ['malformed directive', '{title: T\n歌', 'MALFORMED_DIRECTIVE', 1],
    ['two directives on one line', '{title: T}{key: C}\n歌', 'MALFORMED_DIRECTIVE', 1],
    ['bad directive name', '{tit le: T}\n歌', 'MALFORMED_DIRECTIVE', 1],
    ['duplicate title', '{title: A}\n{title: B}\n歌', 'DUPLICATE_DIRECTIVE', 2],
    ['bad key', '{title: T}\n{key: H}\n歌', 'INVALID_KEY', 2],
    ['bad tempo', '{title: T}\n{tempo: fast}\n歌', 'INVALID_TEMPO', 2],
    ['bad time', '{title: T}\n{time: 4/5}\n歌', 'INVALID_TIME', 2],
    ['bad capo', '{title: T}\n{capo: 14}\n歌', 'INVALID_CAPO', 2],
    ['unclosed section', '{title: T}\n{soc}\n歌', 'SECTION_NOT_CLOSED', 2],
    ['mismatched end', '{title: T}\n{soc}\n歌\n{eov}', 'SECTION_MISMATCH', 4],
    ['end without start', '{title: T}\n歌\n{eoc}', 'SECTION_MISMATCH', 3],
    ['nested section', '{title: T}\n{soc}\n{sov}\n歌\n{eov}\n{eoc}', 'NESTED_SECTION', 3],
    [
      'tab environment',
      '{title: T}\n{start_of_tab}\ne|--0--|\n{end_of_tab}',
      'UNSUPPORTED_ENVIRONMENT',
      2,
    ],
    [
      'unknown environment',
      '{title: T}\n{start_of_solo}\n歌\n{end_of_solo}',
      'UNSUPPORTED_ENVIRONMENT',
      2,
    ],
    ['chord symbol with whitespace', '{title: T}\n[C maj]歌', 'DOCUMENT_INVALID', 0],
  ])('%s → %s', (_name, source, code, lineNo) => {
    const r = importChordPro(source, OPTIONS);
    expect(r.ok).toBe(false);
    const issue = r.issues.find((i) => i.code === code);
    expect(issue, JSON.stringify(r.issues)).toBeDefined();
    expect(issue?.line).toBe(lineNo);
    expect(issue?.severity).toBe('error');
  });

  it('reports every error, not just the first', () => {
    const r = importChordPro('{title: T}\n[C歌\n歌]\n{key: H}', OPTIONS);
    expect(codes(r)).toEqual(['MALFORMED_CHORD', 'UNEXPECTED_BRACKET', 'INVALID_KEY']);
  });

  it('enforces input size limits', () => {
    const big = importChordPro('a'.repeat(MAX_INPUT_LENGTH + 1), OPTIONS);
    expect(codes(big)).toEqual(['INPUT_TOO_LARGE']);
    const many = importChordPro(`{title: T}\n${'歌\n'.repeat(5_001)}`, OPTIONS);
    expect(codes(many)).toEqual(['INPUT_TOO_LARGE']);
    const long = importChordPro(`{title: T}\n${'長'.repeat(1_001)}`, OPTIONS);
    expect(codes(long)).toEqual(['LINE_TOO_LONG']);
  });
});

describe('importChordPro: line endings and real-world files', () => {
  it('treats CRLF, CR and LF identically and strips a BOM', () => {
    const lf = ok('{title: T}\n[C]一\n二');
    expect(ok('﻿{title: T}\r\n[C]一\r\n二').document).toEqual(lf.document);
    expect(ok('{title: T}\r[C]一\r二').document).toEqual(lf.document);
  });

  it('imports the CRLF Amazing Grace fixture', () => {
    const r = ok(readText('chordpro/crlf-amazing-grace.cho'));
    expect(r.document.sections[0]).toMatchObject({ kind: 'verse', label: 'Verse 1' });
    expect(r.document.sections[0]?.lines).toHaveLength(4);
  });

  it('imports the hand-written 送別 fixture with aliases, comments and unknown directives', () => {
    const r = ok(readText('chordpro/handwritten-songbie.cho'));
    expect(r.document.title).toBe('送別');
    expect(r.metadata.artists).toEqual(['李叔同']);
    expect(r.document.sections.map((s) => s.kind)).toEqual(['other', 'verse', 'verse']);
    expect(r.document.sections[0]?.lines[0]?.chords.every((c) => c.anchor === null)).toBe(true);
    expect(r.document.importMetadata.unhandledDirectives).toEqual([
      { line: 9, name: 'c', value: '輕柔地' },
    ]);
  });
});
