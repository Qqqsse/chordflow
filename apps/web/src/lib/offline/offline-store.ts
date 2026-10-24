'use client';

import type { ChartDocument } from '@chordflow/chart-schema';
import {
  createOfflineRecord,
  parseOfflineRecord,
  recordKey,
  type OfflineChartMeta,
  type OfflineChartRecord,
  type ParsedOfflineRecord,
} from './offline-record';

/** IndexedDB access for explicitly saved charts. All functions reject when IndexedDB is unavailable. */

const DB_NAME = 'chordflow-offline';
const DB_VERSION = 1;
const STORE = 'charts';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' }).createIndex('namespace', 'namespace');
      }
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error('IndexedDB open failed'));
    };
  });
}

async function run<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = work(tx.objectStore(STORE));
      tx.oncomplete = () => {
        resolve(request.result);
      };
      tx.onerror = () => {
        reject(tx.error ?? new Error('IndexedDB transaction failed'));
      };
      tx.onabort = () => {
        reject(tx.error ?? new Error('IndexedDB transaction aborted'));
      };
    });
  } finally {
    db.close();
  }
}

export async function saveOfflineChart(
  namespace: string,
  document: ChartDocument,
  meta: OfflineChartMeta,
): Promise<OfflineChartRecord> {
  const record = createOfflineRecord(namespace, document, meta);
  await run('readwrite', (store) => store.put(record));
  return record;
}

/**
 * Records for `namespace`, plus damaged records whose namespace cannot be
 * read (so the user can still see and remove them).
 */
export async function listOfflineCharts(namespace: string): Promise<ParsedOfflineRecord[]> {
  const raw: unknown[] = await run('readonly', (store) => store.getAll());
  return raw
    .filter((value) => {
      const ns =
        typeof value === 'object' && value !== null
          ? (value as { namespace?: unknown }).namespace
          : undefined;
      return ns === namespace || typeof ns !== 'string';
    })
    .map(parseOfflineRecord);
}

export async function getOfflineChart(
  namespace: string,
  arrangementId: string,
): Promise<ParsedOfflineRecord | null> {
  const raw: unknown = await run('readonly', (store) =>
    store.get(recordKey(namespace, arrangementId)),
  );
  return raw === undefined ? null : parseOfflineRecord(raw);
}

export async function removeOfflineChart(key: string): Promise<void> {
  await run('readwrite', (store) => store.delete(key));
}

export async function clearOfflineCharts(namespace: string): Promise<void> {
  const records = await listOfflineCharts(namespace);
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      for (const r of records) {
        const key = r.ok ? r.record.key : r.key;
        if (key !== null) tx.objectStore(STORE).delete(key);
      }
      tx.oncomplete = () => {
        resolve();
      };
      tx.onerror = () => {
        reject(tx.error ?? new Error('IndexedDB clear failed'));
      };
    });
  } finally {
    db.close();
  }
}
