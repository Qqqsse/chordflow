import {
  CatalogSnapshotSchema,
  parseChartDocument,
  parseRecordingSync,
  type CatalogSnapshot,
} from '@chordflow/chart-schema';
import { eq } from 'drizzle-orm';
import type { Database } from '../db/client';
import * as t from '../db/schema';
import { createMemoryCatalog, type FixtureFiles } from './memory-repository';
import { buildWorkSearchText } from './search-text';

/**
 * Loads a catalog snapshot (e.g. the synthetic demo catalog) into PostgreSQL
 * in one transaction. The snapshot is first validated through the in-memory
 * adapter, so the database never receives data that breaks a contract rule.
 */
export async function seedCatalog(
  db: Database,
  snapshotInput: unknown,
  files: FixtureFiles,
): Promise<void> {
  createMemoryCatalog(snapshotInput, files); // throws on any contract violation
  const s: CatalogSnapshot = CatalogSnapshotSchema.parse(snapshotInput);
  const artistNames = new Map(s.artists.map((a) => [a.id, [a.name, ...a.aliases]]));

  await db.transaction(async (tx) => {
    if (s.artists.length > 0) {
      await tx.insert(t.artists).values(
        s.artists.map((a) => ({
          id: a.id,
          name: a.name,
          aliases: a.aliases,
          createdAt: a.createdAt,
          updatedAt: a.updatedAt,
        })),
      );
    }
    for (const w of s.works) {
      const names = [
        w.title,
        ...w.titleAliases,
        ...w.credits.flatMap((c) => artistNames.get(c.artistId) ?? []),
      ];
      for (const r of s.recordings.filter((rec) => rec.workId === w.id)) {
        if (r.title !== null) names.push(r.title);
        names.push(...r.artistCredits.flatMap((c) => artistNames.get(c.artistId) ?? []));
      }
      await tx.insert(t.works).values({
        id: w.id,
        title: w.title,
        titleAliases: w.titleAliases,
        language: w.language,
        externalIds: w.externalIds,
        searchText: buildWorkSearchText(names),
        createdAt: w.createdAt,
        updatedAt: w.updatedAt,
      });
      if (w.credits.length > 0) {
        await tx.insert(t.workCredits).values(
          w.credits.map((c, position) => ({
            workId: w.id,
            artistId: c.artistId,
            role: c.role,
            position,
          })),
        );
      }
    }
    for (const src of s.sources) {
      await tx.insert(t.sourceReferences).values({
        id: src.id,
        platform: src.platform,
        platformSourceId: src.platformSourceId,
        url: src.url,
        metadata: src.metadata,
        permission: src.permission,
        permittedUses: src.permittedUses,
        acquiredAt: src.acquiredAt,
      });
    }
    for (const r of s.recordings) {
      await tx.insert(t.recordings).values({
        id: r.id,
        workId: r.workId,
        title: r.title,
        kind: r.kind,
        durationMs: r.durationMs,
        externalIds: r.externalIds,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      });
      await tx.insert(t.recordingArtists).values(
        r.artistCredits.map((c, position) => ({
          recordingId: r.id,
          artistId: c.artistId,
          role: c.role,
          position,
        })),
      );
      if (r.sourceReferenceIds.length > 0) {
        await tx.insert(t.recordingSources).values(
          r.sourceReferenceIds.map((sourceId, position) => ({
            recordingId: r.id,
            sourceId,
            position,
          })),
        );
      }
    }
    for (const a of s.arrangements) {
      await tx.insert(t.arrangements).values({
        id: a.id,
        workId: a.workId,
        name: a.name,
        variant: a.variant,
        publishedRevisionId: null,
        visibility: a.visibility,
        rightsLyrics: a.rights.lyrics,
        rightsChart: a.rights.chart,
        rightsAudio: a.rights.audio,
        rightsAttribution: a.rights.attribution,
        rightsNotes: a.rights.notes,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
      });
    }
    for (const { documentFixture, ...rev } of s.revisions) {
      const document = parseChartDocument(files[documentFixture]);
      await tx
        .insert(t.chartRevisions)
        .values({ ...rev, document, schemaVersion: document.schemaVersion });
    }
    for (const a of s.arrangements) {
      if (a.publishedRevisionId !== null) {
        await tx
          .update(t.arrangements)
          .set({ publishedRevisionId: a.publishedRevisionId })
          .where(eq(t.arrangements.id, a.id));
      }
    }
    if (s.compatibilities.length > 0)
      await tx.insert(t.arrangementRecordings).values(s.compatibilities);
    for (const sync of s.syncs) {
      const document = parseRecordingSync(files[sync.syncFixture]);
      await tx
        .insert(t.recordingSyncs)
        .values({ recordingId: sync.recordingId, chartRevisionId: sync.chartRevisionId, document });
    }
  });
}
