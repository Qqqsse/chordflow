import { describe, expect, it } from 'vitest';
import { parseChartDocument } from './chart-document';
import { RecordingSyncSchema, parseRecordingSync, validateRecordingSync } from './recording-sync';
import { listFixtures, readFixture, readInvalidCase } from './testing/fixtures';

const chart = parseChartDocument(readFixture('charts/demo-basic.chart.json'));
const INVALID = listFixtures('ai/invalid', '.case.json');

describe('valid recording syncs', () => {
  it.each(['ai/demo-basic.studio.sync.json', 'ai/demo-basic.live.sync.json'])(
    '%s is valid against its chart revision',
    (path) => {
      const result = validateRecordingSync(readFixture(path), { chart });
      expect(result.issues).toEqual([]);
    },
  );

  it('two recordings of one arrangement keep independent timing', () => {
    const studio = parseRecordingSync(readFixture('ai/demo-basic.studio.sync.json'), { chart });
    const live = parseRecordingSync(readFixture('ai/demo-basic.live.sync.json'), { chart });
    expect(studio.chartRevisionId).toBe(live.chartRevisionId);
    expect(studio.recordingId).not.toBe(live.recordingId);
    expect(studio.alignedChords[0]?.startMs).not.toBe(live.alignedChords[0]?.startMs);
  });
});

describe('invalid recording syncs', () => {
  it.each(INVALID)('%s is rejected with its expected issue', (path) => {
    const testCase = readInvalidCase(path);
    const context = testCase.chartFixture
      ? { chart: parseChartDocument(readFixture(testCase.chartFixture)) }
      : {};
    const result = validateRecordingSync(testCase.document, context);
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain(testCase.expectedIssue);
    expect(RecordingSyncSchema.safeParse(testCase.document).success).toBe(
      testCase.layer === 'semantic',
    );
  });
});

describe('sync semantics', () => {
  const base = () =>
    structuredClone(parseRecordingSync(readFixture('ai/demo-basic.studio.sync.json')));

  it('allows chord and lyric tracks to overlap each other', () => {
    const sync = base();
    // lyric 12040..12800 sits inside chord 12000..13700: valid across tracks
    expect(validateRecordingSync(sync, { chart }).ok).toBe(true);
  });

  it('allows overlapping intervals within the chord track when starts are ordered', () => {
    const sync = base();
    const first = sync.alignedChords[0];
    if (!first) throw new Error('fixture shape changed');
    first.endMs = 14000; // overlaps the next chord (13700..)
    expect(validateRecordingSync(sync).ok).toBe(true);
  });

  it('applies offsetMs before duration bounds', () => {
    const sync = { ...base(), offsetMs: -12000, recordingDurationMs: 4000 };
    // unmatched interval 0..11800 shifted by -12000 starts before 0
    expect(validateRecordingSync(sync).issues.map((i) => i.code)).toContain(
      'INTERVAL_OUT_OF_RANGE',
    );
  });

  it('checks unaligned references against the chart', () => {
    const sync = { ...base(), unaligned: { chordOccurrenceIds: ['nope'], lineIds: ['nada'] } };
    const codes = validateRecordingSync(sync, { chart }).issues.map((i) => i.code);
    expect(codes).toEqual(['UNKNOWN_REFERENCE', 'UNKNOWN_REFERENCE']);
  });

  it('rejects unsupported major versions', () => {
    const sync = { ...base(), schemaVersion: '2.0.0' };
    expect(validateRecordingSync(sync).issues[0]?.code).toBe('UNSUPPORTED_SCHEMA_VERSION');
  });
});
