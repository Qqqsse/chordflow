import { randomUUID } from 'node:crypto';
import type { ContentRightsSchema, VisibilitySchema } from '@chordflow/chart-schema';
import {
  ArrangementSettingsRequestSchema,
  CHART_DOCUMENT_SCHEMA_VERSION,
  NewArrangementRequestSchema,
  checkPublishable,
  rightsAllowVisibility,
  validateChartDocument,
  type ChartDocument,
  type ValidationIssue,
} from '@chordflow/chart-schema';
import { and, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { Database } from '../db/client';
import * as t from '../db/schema';
import { createPgCatalog } from './pg-repository';
import { buildWorkSearchText } from './search-text';

/*
 * Write side of the catalog (database mode only). Revisions are append-only;
 * publishing moves the arrangement's pointer inside one transaction that
 * holds the arrangement row lock, after the contract checks pass.
 */

export class EditorError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'CONFLICT' | 'INVALID' | 'PUBLISH_REJECTED',
    message: string,
    readonly issues: readonly ValidationIssue[] = [],
  ) {
    super(message);
    this.name = 'EditorError';
  }
}

const newId = (prefix: string) => `${prefix}_${randomUUID().replaceAll('-', '')}`;

export const NewArrangementSchema = NewArrangementRequestSchema;
export type NewArrangement = z.infer<typeof NewArrangementSchema>;

function assertVisibilityAllowed(
  visibility: z.infer<typeof VisibilitySchema>,
  rights: z.infer<typeof ContentRightsSchema>,
) {
  if (!rightsAllowVisibility(rights, visibility)) {
    throw new EditorError(
      'PUBLISH_REJECTED',
      `content rights do not permit "${visibility}" visibility (unknown rights stay private)`,
    );
  }
}

export async function createArrangement(
  db: Database,
  input: NewArrangement,
  ownerUserId: string,
): Promise<{ workId: string; arrangementId: string }> {
  assertVisibilityAllowed(input.visibility, input.rights);
  return db.transaction(async (tx) => {
    let workId: string;
    if ('id' in input.work) {
      const [work] = await tx
        .select({ id: t.works.id })
        .from(t.works)
        .where(eq(t.works.id, input.work.id));
      if (!work) throw new EditorError('NOT_FOUND', 'Work was not found');
      workId = work.id;
    } else {
      workId = newId('work');
      const names = [input.work.title, ...input.work.titleAliases];
      let artistId: string | null = null;
      if (input.work.artistName !== null) {
        artistId = newId('art');
        names.push(input.work.artistName);
        await tx
          .insert(t.artists)
          .values({ id: artistId, name: input.work.artistName, aliases: [] });
      }
      await tx.insert(t.works).values({
        id: workId,
        title: input.work.title,
        titleAliases: input.work.titleAliases,
        language: input.work.language,
        searchText: buildWorkSearchText(names),
      });
      if (artistId !== null) {
        await tx
          .insert(t.workCredits)
          .values({ workId, artistId, role: 'original_artist', position: 0 });
      }
    }
    const arrangementId = newId('arr');
    await tx.insert(t.arrangements).values({
      id: arrangementId,
      workId,
      name: input.name,
      variant: input.variant,
      visibility: input.visibility,
      ownerUserId,
      rightsLyrics: input.rights.lyrics,
      rightsChart: input.rights.chart,
      rightsAudio: input.rights.audio,
      rightsAttribution: input.rights.attribution,
      rightsNotes: input.rights.notes,
    });
    return { workId, arrangementId };
  });
}

export const ArrangementSettingsSchema = ArrangementSettingsRequestSchema;

export async function updateArrangementSettings(
  db: Database,
  arrangementId: string,
  input: z.infer<typeof ArrangementSettingsSchema>,
): Promise<void> {
  assertVisibilityAllowed(input.visibility, input.rights);
  const updated = await db
    .update(t.arrangements)
    .set({
      visibility: input.visibility,
      rightsLyrics: input.rights.lyrics,
      rightsChart: input.rights.chart,
      rightsAudio: input.rights.audio,
      rightsAttribution: input.rights.attribution,
      rightsNotes: input.rights.notes,
      updatedAt: sql`now()`,
    })
    .where(eq(t.arrangements.id, arrangementId))
    .returning({ id: t.arrangements.id });
  if (updated.length === 0) throw new EditorError('NOT_FOUND', 'Arrangement was not found');
}

export interface NewRevisionInput {
  arrangementId: string;
  /** Chart content; ids, revision number and schema version are assigned by the server. */
  document: Omit<ChartDocument, 'chartRevisionId' | 'arrangementId' | 'revision' | 'schemaVersion'>;
  origin: 'human' | 'chordpro_import' | 'ai_draft';
  parentRevisionId: string | null;
  /** Optimistic concurrency: the latest revision number the editor saw (null = none). */
  expectedLatestRevision?: number | null;
  createdBy: string;
}

export async function createRevision(db: Database, input: NewRevisionInput) {
  return db.transaction(async (tx) => {
    const [arrangement] = await tx
      .select({ id: t.arrangements.id })
      .from(t.arrangements)
      .where(eq(t.arrangements.id, input.arrangementId))
      .for('update');
    if (!arrangement) throw new EditorError('NOT_FOUND', 'Arrangement was not found');
    const [latest] = await tx
      .select({ max: sql<number | null>`max(${t.chartRevisions.revision})` })
      .from(t.chartRevisions)
      .where(eq(t.chartRevisions.arrangementId, input.arrangementId));
    const current = latest?.max ?? null;
    if (input.expectedLatestRevision !== undefined && input.expectedLatestRevision !== current) {
      throw new EditorError(
        'CONFLICT',
        `latest revision is ${String(current)}, not ${String(input.expectedLatestRevision)}`,
      );
    }
    if (input.parentRevisionId !== null) {
      const [parent] = await tx
        .select({ id: t.chartRevisions.id })
        .from(t.chartRevisions)
        .where(
          and(
            eq(t.chartRevisions.id, input.parentRevisionId),
            eq(t.chartRevisions.arrangementId, input.arrangementId),
          ),
        );
      if (!parent)
        throw new EditorError('INVALID', 'parent revision belongs to another arrangement');
    }
    const id = newId('rev');
    const revision = (current ?? 0) + 1;
    const candidate = {
      ...input.document,
      schemaVersion: CHART_DOCUMENT_SCHEMA_VERSION,
      chartRevisionId: id,
      arrangementId: input.arrangementId,
      revision,
    };
    const validated = validateChartDocument(candidate);
    if (!validated.ok)
      throw new EditorError('INVALID', 'chart document is invalid', validated.issues);
    await tx.insert(t.chartRevisions).values({
      id,
      arrangementId: input.arrangementId,
      revision,
      status: 'draft',
      origin: input.origin,
      parentRevisionId: input.parentRevisionId,
      document: validated.value,
      schemaVersion: validated.value.schemaVersion,
      createdBy: input.createdBy,
    });
    return { id, revision, status: 'draft' as const };
  });
}

/** Publishes a revision: status → published and pointer moved, atomically. Idempotent. */
export async function publishRevision(db: Database, arrangementId: string, revisionId: string) {
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ id: t.arrangements.id, pointer: t.arrangements.publishedRevisionId })
      .from(t.arrangements)
      .where(eq(t.arrangements.id, arrangementId))
      .for('update');
    if (!locked) throw new EditorError('NOT_FOUND', 'Arrangement was not found');
    const repo = createPgCatalog(tx);
    const [arrangement, revision] = await Promise.all([
      repo.getArrangement(arrangementId),
      repo.getRevisionById(revisionId),
    ]);
    if (!arrangement || revision?.arrangementId !== arrangementId) {
      throw new EditorError('NOT_FOUND', 'Revision was not found for this arrangement');
    }
    if (revision.status === 'rejected')
      throw new EditorError('PUBLISH_REJECTED', 'rejected revisions cannot be published');
    if (revision.status === 'published' && locked.pointer === revisionId)
      return { publishedRevisionId: revisionId, changed: false };
    const issues = checkPublishable(arrangement, { ...revision, status: 'published' });
    if (issues.length > 0)
      throw new EditorError('PUBLISH_REJECTED', 'revision cannot be published', issues);
    if (revision.status !== 'published') {
      await tx
        .update(t.chartRevisions)
        .set({ status: 'published' })
        .where(eq(t.chartRevisions.id, revisionId));
    }
    await tx
      .update(t.arrangements)
      .set({ publishedRevisionId: revisionId, updatedAt: sql`now()` })
      .where(eq(t.arrangements.id, arrangementId));
    return { publishedRevisionId: revisionId, changed: true };
  });
}
