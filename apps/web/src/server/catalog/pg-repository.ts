import type {
  Arrangement,
  ArrangementRecordingCompatibility,
  Artist,
  ChartRevision,
  Recording,
  SourceReference,
  Work,
} from '@chordflow/chart-schema';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import * as t from '../db/schema';
import type { CatalogRepository } from './repository';

/** PostgreSQL implementation of the catalog read port (SPEC §4, §9). */

const iso = (value: string): string => new Date(value).toISOString();

type ArrangementRow = typeof t.arrangements.$inferSelect;
type RevisionRow = typeof t.chartRevisions.$inferSelect;

function toArrangement(row: ArrangementRow): Arrangement {
  return {
    id: row.id,
    workId: row.workId,
    name: row.name,
    variant: row.variant as Arrangement['variant'],
    publishedRevisionId: row.publishedRevisionId,
    visibility: row.visibility as Arrangement['visibility'],
    rights: {
      lyrics: row.rightsLyrics as Arrangement['rights']['lyrics'],
      chart: row.rightsChart as Arrangement['rights']['chart'],
      audio: row.rightsAudio as Arrangement['rights']['audio'],
      attribution: row.rightsAttribution,
      notes: row.rightsNotes,
    },
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function toRevision(row: RevisionRow): ChartRevision {
  return {
    id: row.id,
    arrangementId: row.arrangementId,
    revision: row.revision,
    status: row.status as ChartRevision['status'],
    origin: row.origin as ChartRevision['origin'],
    parentRevisionId: row.parentRevisionId,
    document: row.document,
    createdBy: row.createdBy,
    createdAt: iso(row.createdAt),
  };
}

function toSource(row: typeof t.sourceReferences.$inferSelect): SourceReference {
  return {
    id: row.id,
    platform: row.platform as SourceReference['platform'],
    platformSourceId: row.platformSourceId,
    url: row.url,
    metadata: row.metadata,
    permission: row.permission as SourceReference['permission'],
    permittedUses: row.permittedUses as SourceReference['permittedUses'],
    acquiredAt: iso(row.acquiredAt),
  };
}

export function createPgCatalog(db: Database): CatalogRepository {
  const loadWork = async (id: string): Promise<Work | null> => {
    const [row] = await db.select().from(t.works).where(eq(t.works.id, id));
    if (!row) return null;
    const credits = await db
      .select()
      .from(t.workCredits)
      .where(eq(t.workCredits.workId, id))
      .orderBy(asc(t.workCredits.position));
    return {
      id: row.id,
      title: row.title,
      titleAliases: row.titleAliases,
      language: row.language,
      credits: credits.map((c) => ({
        artistId: c.artistId,
        role: c.role as Work['credits'][number]['role'],
      })),
      externalIds: row.externalIds,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    };
  };

  const loadRecording = async (row: typeof t.recordings.$inferSelect): Promise<Recording> => {
    const [credits, sources] = await Promise.all([
      db
        .select()
        .from(t.recordingArtists)
        .where(eq(t.recordingArtists.recordingId, row.id))
        .orderBy(asc(t.recordingArtists.position)),
      db
        .select()
        .from(t.recordingSources)
        .where(eq(t.recordingSources.recordingId, row.id))
        .orderBy(asc(t.recordingSources.position)),
    ]);
    return {
      id: row.id,
      workId: row.workId,
      title: row.title,
      artistCredits: credits.map((c) => ({
        artistId: c.artistId,
        role: c.role as 'performer' | 'featured',
      })),
      kind: row.kind as Recording['kind'],
      durationMs: row.durationMs,
      externalIds: row.externalIds,
      sourceReferenceIds: sources.map((s) => s.sourceId),
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    };
  };

  return {
    async getArtist(id): Promise<Artist | null> {
      const [row] = await db.select().from(t.artists).where(eq(t.artists.id, id));
      return row
        ? {
            id: row.id,
            name: row.name,
            aliases: row.aliases,
            createdAt: iso(row.createdAt),
            updatedAt: iso(row.updatedAt),
          }
        : null;
    },
    getWork: loadWork,
    async getRecording(id) {
      const [row] = await db.select().from(t.recordings).where(eq(t.recordings.id, id));
      return row ? loadRecording(row) : null;
    },
    async listRecordingsForWork(workId) {
      const rows = await db
        .select()
        .from(t.recordings)
        .where(eq(t.recordings.workId, workId))
        .orderBy(asc(t.recordings.id));
      return Promise.all(rows.map(loadRecording));
    },
    async getArrangement(id) {
      const [row] = await db.select().from(t.arrangements).where(eq(t.arrangements.id, id));
      return row ? toArrangement(row) : null;
    },
    async getArrangementOwnerId(id) {
      const [row] = await db
        .select({ owner: t.arrangements.ownerUserId })
        .from(t.arrangements)
        .where(eq(t.arrangements.id, id));
      return row?.owner ?? null;
    },
    async listArrangementsForWork(workId) {
      const rows = await db
        .select()
        .from(t.arrangements)
        .where(eq(t.arrangements.workId, workId))
        .orderBy(asc(t.arrangements.id));
      return rows.map(toArrangement);
    },
    async listCompatibilities(filter): Promise<ArrangementRecordingCompatibility[]> {
      const conditions = [
        filter.arrangementId === undefined
          ? undefined
          : eq(t.arrangementRecordings.arrangementId, filter.arrangementId),
        filter.recordingId === undefined
          ? undefined
          : eq(t.arrangementRecordings.recordingId, filter.recordingId),
      ].filter((c) => c !== undefined);
      const rows = await db
        .select()
        .from(t.arrangementRecordings)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(
          asc(t.arrangementRecordings.arrangementId),
          asc(t.arrangementRecordings.recordingId),
        );
      return rows.map((r) => ({
        arrangementId: r.arrangementId,
        recordingId: r.recordingId,
        provenance: r.provenance as ArrangementRecordingCompatibility['provenance'],
        recordedKey: r.recordedKey,
        transposeSemitones: r.transposeSemitones,
        crossWorkReviewed: r.crossWorkReviewed,
        createdAt: iso(r.createdAt),
        updatedAt: iso(r.updatedAt),
      }));
    },
    async getRevision(arrangementId, revision) {
      const [row] = await db
        .select()
        .from(t.chartRevisions)
        .where(
          and(
            eq(t.chartRevisions.arrangementId, arrangementId),
            eq(t.chartRevisions.revision, revision),
          ),
        );
      return row ? toRevision(row) : null;
    },
    async getRevisionById(id) {
      const [row] = await db.select().from(t.chartRevisions).where(eq(t.chartRevisions.id, id));
      return row ? toRevision(row) : null;
    },
    async listRevisions(arrangementId) {
      const rows = await db
        .select()
        .from(t.chartRevisions)
        .where(eq(t.chartRevisions.arrangementId, arrangementId))
        .orderBy(asc(t.chartRevisions.revision));
      return rows.map(toRevision);
    },
    async getPublishedRevision(arrangementId) {
      const [row] = await db
        .select({ revision: t.chartRevisions })
        .from(t.arrangements)
        .innerJoin(t.chartRevisions, eq(t.chartRevisions.id, t.arrangements.publishedRevisionId))
        .where(eq(t.arrangements.id, arrangementId));
      return row ? toRevision(row.revision) : null;
    },
    async getRecordingSync(recordingId, chartRevisionId) {
      const [row] = await db
        .select()
        .from(t.recordingSyncs)
        .where(
          and(
            eq(t.recordingSyncs.recordingId, recordingId),
            eq(t.recordingSyncs.chartRevisionId, chartRevisionId),
          ),
        );
      return row ? row.document : null;
    },
    async getSource(id) {
      const [row] = await db.select().from(t.sourceReferences).where(eq(t.sourceReferences.id, id));
      return row ? toSource(row) : null;
    },
    async findSourceByPlatformId(platform, platformSourceId) {
      const [row] = await db
        .select()
        .from(t.sourceReferences)
        .where(
          and(
            eq(t.sourceReferences.platform, platform),
            eq(t.sourceReferences.platformSourceId, platformSourceId),
          ),
        );
      return row ? toSource(row) : null;
    },
    async listRecordingsForSource(sourceId) {
      const rows = await db
        .select({ recording: t.recordings })
        .from(t.recordingSources)
        .innerJoin(t.recordings, eq(t.recordings.id, t.recordingSources.recordingId))
        .where(eq(t.recordingSources.sourceId, sourceId))
        .orderBy(asc(t.recordings.id));
      return Promise.all(rows.map((r) => loadRecording(r.recording)));
    },
    async searchWorks(query, page) {
      if (query === '') return { works: [], hasMore: false };
      const pattern = `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const rows = await db
        .select({ id: t.works.id })
        .from(t.works)
        .where(sql`${t.works.searchText} like ${pattern}`)
        .orderBy(
          sql`strpos(${t.works.searchText}, ${query})`,
          sql`${t.works.title} collate "C"`,
          sql`${t.works.id} collate "C"`,
        )
        .limit(page.limit + 1)
        .offset(page.offset);
      const works = await Promise.all(rows.slice(0, page.limit).map((r) => loadWork(r.id)));
      return {
        works: works.filter((w): w is Work => w !== null),
        hasMore: rows.length > page.limit,
      };
    },
  };
}
