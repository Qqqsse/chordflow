import {
  CatalogSnapshotSchema,
  ContractValidationError,
  checkCompatibility,
  checkPublishable,
  checkRevisionDocumentConsistency,
  parseChartDocument,
  parseRecordingSync,
  type Arrangement,
  type ArrangementRecordingCompatibility,
  type CatalogSnapshot,
  type ChartRevision,
  type RecordingSync,
  type ValidationIssue,
} from '@chordflow/chart-schema';
import type { CatalogRepository } from './repository';
import { buildWorkSearchText } from './search-text';

/** Fixture path → parsed JSON content (chart documents and syncs referenced by the snapshot). */
export type FixtureFiles = Readonly<Record<string, unknown>>;

function indexById<T extends { id: string }>(items: readonly T[], what: string): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of items) {
    if (map.has(item.id)) {
      throw new ContractValidationError(`Catalog ${what}`, [
        { code: 'DUPLICATE_ID', path: [what, item.id], message: `duplicate ${what} id` },
      ]);
    }
    map.set(item.id, item);
  }
  return map;
}

function fail(what: string, issues: ValidationIssue[]): never {
  throw new ContractValidationError(what, issues);
}

function copy<T>(value: T): T {
  return structuredClone(value);
}

function requireFile(files: FixtureFiles, path: string): unknown {
  if (!(path in files)) {
    fail('Catalog snapshot', [
      { code: 'UNKNOWN_REFERENCE', path: [path], message: 'referenced fixture file is missing' },
    ]);
  }
  return files[path];
}

/**
 * Validated, read-only in-memory catalog for demo mode and tests. Construction
 * fails loudly on any contract violation instead of serving a broken catalog.
 */
export function createMemoryCatalog(
  snapshotInput: unknown,
  files: FixtureFiles,
): CatalogRepository {
  const parsed = CatalogSnapshotSchema.safeParse(snapshotInput);
  if (!parsed.success) {
    throw new ContractValidationError(
      'Catalog snapshot',
      parsed.error.issues.map((issue) => ({
        code: 'SCHEMA_INVALID',
        path: issue.path.map((p) => (typeof p === 'number' ? p : String(p))),
        message: issue.message,
      })),
    );
  }
  const snapshot: CatalogSnapshot = parsed.data;

  const artists = indexById(snapshot.artists, 'artist');
  const works = indexById(snapshot.works, 'work');
  const recordings = indexById(snapshot.recordings, 'recording');
  const arrangements = indexById(snapshot.arrangements, 'arrangement');
  const sources = indexById(snapshot.sources, 'source');

  const revisions = new Map<string, ChartRevision>();
  for (const { documentFixture, ...meta } of snapshot.revisions) {
    const revision: ChartRevision = {
      ...meta,
      document: parseChartDocument(requireFile(files, documentFixture)),
    };
    const issues = checkRevisionDocumentConsistency(revision);
    if (!arrangements.has(revision.arrangementId)) {
      issues.push({
        code: 'UNKNOWN_REFERENCE',
        path: ['arrangementId'],
        message: 'no arrangement',
      });
    }
    if (issues.length > 0) fail(`Revision ${revision.id}`, issues);
    if (revisions.has(revision.id)) {
      fail('Catalog snapshot', [
        { code: 'DUPLICATE_ID', path: ['revisions', revision.id], message: 'duplicate revision' },
      ]);
    }
    revisions.set(revision.id, revision);
  }

  for (const arrangement of arrangements.values()) {
    if (!works.has(arrangement.workId)) {
      fail(`Arrangement ${arrangement.id}`, [
        { code: 'UNKNOWN_REFERENCE', path: ['workId'], message: 'no such work' },
      ]);
    }
    if (arrangement.publishedRevisionId !== null) {
      const published = revisions.get(arrangement.publishedRevisionId);
      if (!published) {
        fail(`Arrangement ${arrangement.id}`, [
          { code: 'UNKNOWN_REFERENCE', path: ['publishedRevisionId'], message: 'no such revision' },
        ]);
      }
      const issues = checkPublishable(arrangement, published);
      if (issues.length > 0) fail(`Arrangement ${arrangement.id}`, issues);
    }
  }

  for (const compat of snapshot.compatibilities) {
    const arrangement = arrangements.get(compat.arrangementId);
    const recording = recordings.get(compat.recordingId);
    if (!arrangement || !recording) {
      fail('Compatibility', [
        {
          code: 'UNKNOWN_REFERENCE',
          path: [compat.arrangementId, compat.recordingId],
          message: 'missing entity',
        },
      ]);
    }
    const issues = checkCompatibility(arrangement, recording, compat);
    if (issues.length > 0) fail('Compatibility', issues);
  }

  const syncs = new Map<string, RecordingSync>();
  for (const ref of snapshot.syncs) {
    const chart = revisions.get(ref.chartRevisionId)?.document;
    if (!chart || !recordings.has(ref.recordingId)) {
      fail('Recording sync', [
        {
          code: 'UNKNOWN_REFERENCE',
          path: [ref.syncFixture],
          message: 'missing recording or revision',
        },
      ]);
    }
    const sync = parseRecordingSync(requireFile(files, ref.syncFixture), { chart });
    if (sync.recordingId !== ref.recordingId) {
      fail('Recording sync', [
        {
          code: 'REFERENCE_MISMATCH',
          path: ['recordingId'],
          message: 'sync is for another recording',
        },
      ]);
    }
    syncs.set(`${ref.recordingId}|${ref.chartRevisionId}`, sync);
  }

  const compatibilities: readonly ArrangementRecordingCompatibility[] = snapshot.compatibilities;
  const byArrangement = (arrangementId: string) =>
    [...revisions.values()]
      .filter((r) => r.arrangementId === arrangementId)
      .sort((a, b) => a.revision - b.revision);

  const workSearchText = new Map<string, string>();
  for (const work of works.values()) {
    const names: string[] = [work.title, ...work.titleAliases];
    const addArtist = (artistId: string) => {
      const artist = artists.get(artistId);
      if (artist) names.push(artist.name, ...artist.aliases);
    };
    work.credits.forEach((c) => {
      addArtist(c.artistId);
    });
    for (const rec of recordings.values()) {
      if (rec.workId !== work.id) continue;
      if (rec.title !== null) names.push(rec.title);
      rec.artistCredits.forEach((c) => {
        addArtist(c.artistId);
      });
    }
    workSearchText.set(work.id, buildWorkSearchText(names));
  }

  const get = <T>(map: Map<string, T>, id: string): Promise<T | null> =>
    Promise.resolve(map.has(id) ? copy(map.get(id) as T) : null);

  return {
    getArtist: (id) => get(artists, id),
    getWork: (id) => get(works, id),
    getRecording: (id) => get(recordings, id),
    listRecordingsForWork: (workId) =>
      Promise.resolve(copy([...recordings.values()].filter((r) => r.workId === workId))),
    getArrangement: (id) => get(arrangements, id),
    listArrangementsForWork: (workId) =>
      Promise.resolve(
        copy([...arrangements.values()].filter((a: Arrangement) => a.workId === workId)),
      ),
    listCompatibilities: (filter) =>
      Promise.resolve(
        copy(
          compatibilities.filter(
            (c) =>
              (filter.arrangementId === undefined || c.arrangementId === filter.arrangementId) &&
              (filter.recordingId === undefined || c.recordingId === filter.recordingId),
          ),
        ),
      ),
    getRevision: (arrangementId, revision) =>
      Promise.resolve(
        copy(byArrangement(arrangementId).find((r) => r.revision === revision) ?? null),
      ),
    getRevisionById: (id) => get(revisions, id),
    listRevisions: (arrangementId) => Promise.resolve(copy(byArrangement(arrangementId))),
    getPublishedRevision: (arrangementId) => {
      const pointer = arrangements.get(arrangementId)?.publishedRevisionId ?? null;
      return pointer === null ? Promise.resolve(null) : get(revisions, pointer);
    },
    getRecordingSync: (recordingId, chartRevisionId) =>
      get(syncs, `${recordingId}|${chartRevisionId}`),
    getSource: (id) => get(sources, id),
    searchWorks: (query, page) => {
      const matches = [...works.values()]
        .map((work) => ({ work, at: (workSearchText.get(work.id) ?? '').indexOf(query) }))
        .filter((m) => query !== '' && m.at >= 0)
        .sort(
          (a, b) =>
            a.at - b.at ||
            (a.work.title < b.work.title ? -1 : a.work.title > b.work.title ? 1 : 0) ||
            (a.work.id < b.work.id ? -1 : 1),
        );
      const slice = matches.slice(page.offset, page.offset + page.limit);
      return Promise.resolve({
        works: copy(slice.map((m) => m.work)),
        hasMore: matches.length > page.offset + page.limit,
      });
    },
  };
}
