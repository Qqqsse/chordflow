import { validateChartDocument, type ChartDocument } from '@chordflow/chart-schema';

/*
 * Offline chart records (SPEC §13). Stored only after an explicit
 * "save offline" action, validated again on every read, and never rendered
 * when invalid — the user gets a recoverable notice instead.
 */

export const OFFLINE_RECORD_VERSION = 1;
/** Until accounts exist (M6) everything is stored under the guest namespace. */
export const GUEST_NAMESPACE = 'guest';

export interface OfflineChartMeta {
  arrangementName: string | null;
  credits: string | null;
}

export interface OfflineChartRecord {
  key: string;
  recordVersion: typeof OFFLINE_RECORD_VERSION;
  namespace: string;
  arrangementId: string;
  chartRevisionId: string;
  title: string;
  schemaVersion: string;
  savedAt: string;
  meta: OfflineChartMeta;
  document: ChartDocument;
}

export type OfflineInvalidReason =
  'NOT_A_RECORD' | 'UNSUPPORTED_RECORD_VERSION' | 'CHART_INVALID' | 'KEY_MISMATCH';

export type ParsedOfflineRecord =
  | { ok: true; record: OfflineChartRecord }
  | { ok: false; key: string | null; title: string | null; reason: OfflineInvalidReason };

export function recordKey(namespace: string, arrangementId: string): string {
  return `${namespace}:${arrangementId}`;
}

export function createOfflineRecord(
  namespace: string,
  document: ChartDocument,
  meta: OfflineChartMeta,
  now: Date = new Date(),
): OfflineChartRecord {
  return {
    key: recordKey(namespace, document.arrangementId),
    recordVersion: OFFLINE_RECORD_VERSION,
    namespace,
    arrangementId: document.arrangementId,
    chartRevisionId: document.chartRevisionId,
    title: document.title,
    schemaVersion: document.schemaVersion,
    savedAt: now.toISOString(),
    meta,
    document,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validates a raw IndexedDB value; there is no migration from unknown versions yet. */
export function parseOfflineRecord(raw: unknown): ParsedOfflineRecord {
  if (!isObject(raw)) return { ok: false, key: null, title: null, reason: 'NOT_A_RECORD' };
  const key = typeof raw.key === 'string' ? raw.key : null;
  const title = typeof raw.title === 'string' ? raw.title : null;
  if (raw.recordVersion !== OFFLINE_RECORD_VERSION) {
    return { ok: false, key, title, reason: 'UNSUPPORTED_RECORD_VERSION' };
  }
  const chart = validateChartDocument(raw.document);
  if (!chart.ok) return { ok: false, key, title, reason: 'CHART_INVALID' };
  const namespace = typeof raw.namespace === 'string' ? raw.namespace : '';
  if (key !== recordKey(namespace, chart.value.arrangementId)) {
    return { ok: false, key, title, reason: 'KEY_MISMATCH' };
  }
  const meta = isObject(raw.meta) ? raw.meta : {};
  return {
    ok: true,
    record: {
      key,
      recordVersion: OFFLINE_RECORD_VERSION,
      namespace,
      arrangementId: chart.value.arrangementId,
      chartRevisionId: chart.value.chartRevisionId,
      title: chart.value.title,
      schemaVersion: chart.value.schemaVersion,
      savedAt: typeof raw.savedAt === 'string' ? raw.savedAt : '',
      meta: {
        arrangementName: typeof meta.arrangementName === 'string' ? meta.arrangementName : null,
        credits: typeof meta.credits === 'string' ? meta.credits : null,
      },
      document: chart.value,
    },
  };
}
