import { describe, expect, it } from 'vitest';
import chart from '../../../../../fixtures/charts/pd-songbie.chart.json';
import { createOfflineRecord, parseOfflineRecord, recordKey } from './offline-record';
import { parseChartDocument } from '@chordflow/chart-schema';

const doc = parseChartDocument(chart);
const meta = { arrangementName: 'C 調（簡易）', credits: '詞：李叔同' };

describe('offline records', () => {
  it('round-trips a saved chart', () => {
    const record = createOfflineRecord('guest', doc, meta, new Date('2026-10-24T00:00:00Z'));
    expect(record.key).toBe(recordKey('guest', doc.arrangementId));
    const parsed = parseOfflineRecord(JSON.parse(JSON.stringify(record)));
    expect(parsed).toEqual({ ok: true, record });
  });

  it.each<[string, unknown, string]>([
    ['non-object', 'oops', 'NOT_A_RECORD'],
    [
      'future record version',
      { recordVersion: 2, key: 'guest:x', title: 'T' },
      'UNSUPPORTED_RECORD_VERSION',
    ],
    [
      'chart from a newer schema major',
      { ...createOfflineRecord('guest', doc, meta), document: { ...doc, schemaVersion: '2.0.0' } },
      'CHART_INVALID',
    ],
    [
      'corrupted chart',
      { ...createOfflineRecord('guest', doc, meta), document: { ...doc, sections: 'x' } },
      'CHART_INVALID',
    ],
    [
      'record stored under another key',
      { ...createOfflineRecord('guest', doc, meta), key: 'other:x' },
      'KEY_MISMATCH',
    ],
  ])('rejects %s', (_name, raw, reason) => {
    const parsed = parseOfflineRecord(raw);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toBe(reason);
  });

  it('keeps the title of an invalid record for the recovery notice', () => {
    const parsed = parseOfflineRecord({ recordVersion: 9, key: 'guest:a', title: '舊格式' });
    expect(parsed).toMatchObject({ ok: false, key: 'guest:a', title: '舊格式' });
  });
});
