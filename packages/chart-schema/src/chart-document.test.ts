import { describe, expect, it } from 'vitest';
import {
  CHART_DOCUMENT_SCHEMA_VERSION,
  ChartDocumentSchema,
  listChordOccurrences,
  parseChartDocument,
  validateChartDocument,
  type ChartDocument,
} from './chart-document';
import { ContractValidationError } from './issues';
import { listFixtures, readFixture, readInvalidCase } from './testing/fixtures';

const VALID = listFixtures('charts', '.chart.json');
const INVALID = listFixtures('charts/invalid', '.case.json');

function basic(): ChartDocument {
  return parseChartDocument(readFixture('charts/demo-basic.chart.json'));
}

describe('valid chart fixtures', () => {
  it('includes the SPEC §4 example, invented songs and public-domain songs', () => {
    expect(VALID).toEqual([
      'charts/demo-basic.chart.json',
      'charts/demo-english.chart.json',
      'charts/demo-full-zh.chart.json',
      'charts/pd-amazing-grace.chart.json',
      'charts/pd-songbie.chart.json',
    ]);
  });

  it.each(VALID)('%s is valid', (path) => {
    const result = validateChartDocument(readFixture(path));
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('accepts the SPEC §4 example exactly as written', () => {
    const doc = basic();
    expect(doc.schemaVersion).toBe(CHART_DOCUMENT_SCHEMA_VERSION);
    expect(listChordOccurrences(doc).map(({ chord }) => chord.symbol)).toEqual(['C', 'C', 'G/B']);
  });
});

describe('invalid chart fixtures', () => {
  it('has a broad set of cases', () => {
    expect(INVALID.length).toBeGreaterThanOrEqual(15);
  });

  it.each(INVALID)('%s is rejected with its expected issue', (path) => {
    const testCase = readInvalidCase(path);
    const result = validateChartDocument(testCase.document);
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain(testCase.expectedIssue);
    // Structural cases must fail the JSON-Schema-expressible layer; semantic ones must pass it.
    expect(ChartDocumentSchema.safeParse(testCase.document).success).toBe(
      testCase.layer === 'semantic',
    );
  });
});

describe('chart semantics', () => {
  it('allows offset equal to the grapheme length (after the last grapheme)', () => {
    const doc = structuredClone(basic());
    const line = doc.sections[1]?.lines[0];
    if (!line?.chords[1]?.anchor) throw new Error('fixture shape changed');
    line.chords[1].anchor.graphemeOffset = 7;
    expect(validateChartDocument(doc).ok).toBe(true);
  });

  it('counts combining sequences and emoji as single graphemes', () => {
    const doc = structuredClone(basic());
    const line = doc.sections[1]?.lines[0];
    if (!line?.chords[1]?.anchor) throw new Error('fixture shape changed');
    line.text = 'é👍🏽'; // NFC é + emoji with skin tone modifier = 2 graphemes
    line.chords[1].anchor.graphemeOffset = 2;
    expect(validateChartDocument(doc).ok).toBe(true);
    line.chords[1].anchor.graphemeOffset = 3;
    expect(validateChartDocument(doc).issues.map((i) => i.code)).toEqual(['ANCHOR_OUT_OF_BOUNDS']);
  });

  it('accepts minor version bumps within major 1', () => {
    const doc = { ...basic(), schemaVersion: '1.4.2' };
    expect(validateChartDocument(doc).ok).toBe(true);
  });

  it('accepts namespaced extensions with JSON values', () => {
    const doc = { ...basic(), extensions: { 'x-demo.note': { reviewed: true, tags: ['a'] } } };
    expect(validateChartDocument(doc).ok).toBe(true);
  });

  it('reports issue paths for precise error messages', () => {
    const doc = structuredClone(basic());
    const chord = doc.sections[1]?.lines[0]?.chords[1];
    if (!chord?.anchor) throw new Error('fixture shape changed');
    chord.anchor.graphemeOffset = 99;
    const result = validateChartDocument(doc);
    expect(result.issues[0]?.path).toEqual([
      'sections',
      1,
      'lines',
      0,
      'chords',
      1,
      'anchor',
      'graphemeOffset',
    ]);
  });

  it('rejects non-NFC titles', () => {
    const doc = { ...basic(), title: 'Café' };
    expect(validateChartDocument(doc).issues.map((i) => i.code)).toEqual(['TEXT_NOT_NFC']);
  });

  it('parseChartDocument throws a typed error', () => {
    expect(() => parseChartDocument({})).toThrow(ContractValidationError);
    try {
      parseChartDocument({ ...basic(), schemaVersion: '9.0.0' });
    } catch (error) {
      expect(error).toBeInstanceOf(ContractValidationError);
      expect((error as ContractValidationError).issues[0]?.code).toBe('UNSUPPORTED_SCHEMA_VERSION');
    }
  });

  it.each([null, 42, 'chart', [], { schemaVersion: '1.0.0' }])(
    'rejects non-chart input %j without throwing',
    (input) => {
      const result = validateChartDocument(input);
      expect(result.ok).toBe(false);
      expect(result.issues[0]?.code).toBe('SCHEMA_INVALID');
    },
  );
});
