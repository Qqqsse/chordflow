import { parseChartDocument } from '@chordflow/chart-schema';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import chart from '../../../../../fixtures/charts/pd-songbie.chart.json';
import { authUsers } from '../db/auth-schema';
import type { DatabaseHandle } from '../db/client';
import * as t from '../db/schema';
import {
  EditorError,
  createArrangement,
  createRevision,
  publishRevision,
  updateArrangementSettings,
} from './editor';
import { createPgCatalog } from './pg-repository';
import { normalizeSearchText } from './search-text';

const {
  chartRevisionId: _r,
  arrangementId: _a,
  revision: _n,
  schemaVersion: _s,
  ...content
} = parseChartDocument(chart);
const synthetic = {
  lyrics: 'public_domain',
  chart: 'owner_original',
  audio: 'unknown',
  attribution: null,
  notes: null,
} as const;
const unknownRights = {
  lyrics: 'unknown',
  chart: 'unknown',
  audio: 'unknown',
  attribution: null,
  notes: null,
} as const;

const expectEditorError = async (work: Promise<unknown>, code: EditorError['code']) => {
  await expect(work).rejects.toSatisfy((e: unknown) => e instanceof EditorError && e.code === code);
};

/** Write-side suite; registered by `../db.integration.test.ts` after the accounts suite. */
export function editorIntegrationSuite(getHandle: () => DatabaseHandle): void {
  describe('catalog editor', () => {
    let handle: DatabaseHandle;
    let userId: string;
    let arrangementId: string;

    beforeAll(async () => {
      handle = getHandle();
      const [admin] = await handle.db
        .select({ id: authUsers.id })
        .from(authUsers)
        .where(eq(authUsers.role, 'admin'))
        .limit(1);
      if (!admin) throw new Error('accounts suite must create an admin first');
      userId = admin.id;
    });

    it('creates a work and arrangement that search can find by artist', async () => {
      const created = await createArrangement(
        handle.db,
        {
          work: {
            title: '新歌（測試）',
            titleAliases: ['新歌'],
            language: 'zh-TW',
            artistName: '測試歌手',
          },
          name: '原調',
          variant: 'original',
          visibility: 'private',
          rights: synthetic,
        },
        userId,
      );
      arrangementId = created.arrangementId;
      const repo = createPgCatalog(handle.db);
      const found = await repo.searchWorks(normalizeSearchText('測試歌手'), {
        limit: 5,
        offset: 0,
      });
      expect(found.works.map((w) => w.id)).toEqual([created.workId]);
      expect(await repo.getArrangementOwnerId(arrangementId)).toBe(userId);
    });

    it('refuses visibility that the rights do not allow', async () => {
      await expectEditorError(
        createArrangement(
          handle.db,
          {
            work: { title: 'x', titleAliases: [], language: null, artistName: null },
            name: 'x',
            variant: 'original',
            visibility: 'public',
            rights: unknownRights,
          },
          userId,
        ),
        'PUBLISH_REJECTED',
      );
      await expectEditorError(
        updateArrangementSettings(handle.db, arrangementId, {
          visibility: 'shared',
          rights: unknownRights,
        }),
        'PUBLISH_REJECTED',
      );
    });

    it('numbers revisions, validates documents and checks parents', async () => {
      const first = await createRevision(handle.db, {
        arrangementId,
        document: content,
        origin: 'human',
        parentRevisionId: null,
        createdBy: userId,
      });
      expect(first.revision).toBe(1);
      const second = await createRevision(handle.db, {
        arrangementId,
        document: { ...content, title: '新歌（第二版）' },
        origin: 'human',
        parentRevisionId: first.id,
        expectedLatestRevision: 1,
        createdBy: userId,
      });
      expect(second.revision).toBe(2);
      await expectEditorError(
        createRevision(handle.db, {
          arrangementId,
          document: content,
          origin: 'human',
          parentRevisionId: null,
          expectedLatestRevision: 1,
          createdBy: userId,
        }),
        'CONFLICT',
      );
      await expectEditorError(
        createRevision(handle.db, {
          arrangementId,
          document: { ...content, sections: [] },
          origin: 'human',
          parentRevisionId: null,
          createdBy: userId,
        }),
        'INVALID',
      );
      await expectEditorError(
        createRevision(handle.db, {
          arrangementId,
          document: content,
          origin: 'human',
          parentRevisionId: 'rev_demo_001',
          createdBy: userId,
        }),
        'INVALID',
      );
    });

    it('serializes concurrent revisions: numbers never collide and stale editors get a conflict', async () => {
      const make = (expected?: number) =>
        createRevision(handle.db, {
          arrangementId,
          document: content,
          origin: 'human',
          parentRevisionId: null,
          ...(expected === undefined ? {} : { expectedLatestRevision: expected }),
          createdBy: userId,
        });
      const results = await Promise.allSettled([make(2), make(2)]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const both = await Promise.all([make(), make()]);
      expect(both.map((r) => r.revision).sort()).toEqual([4, 5]);
    });

    it('publishes atomically, keeps history, and is idempotent', async () => {
      const repo = createPgCatalog(handle.db);
      const revisions = await repo.listRevisions(arrangementId);
      const [r1, r2] = revisions;
      if (!r1 || !r2) throw new Error('missing revisions');
      expect(await publishRevision(handle.db, arrangementId, r1.id)).toEqual({
        publishedRevisionId: r1.id,
        changed: true,
      });
      expect((await repo.getPublishedRevision(arrangementId))?.id).toBe(r1.id);
      await publishRevision(handle.db, arrangementId, r2.id);
      expect((await repo.getPublishedRevision(arrangementId))?.document.title).toBe(
        '新歌（第二版）',
      );
      expect((await repo.getRevisionById(r1.id))?.status).toBe('published');
      expect(await publishRevision(handle.db, arrangementId, r2.id)).toEqual({
        publishedRevisionId: r2.id,
        changed: false,
      });
    });

    it('refuses to publish rejected revisions or revisions of another arrangement', async () => {
      const draft = await createRevision(handle.db, {
        arrangementId,
        document: content,
        origin: 'human',
        parentRevisionId: null,
        createdBy: userId,
      });
      await handle.db
        .update(t.chartRevisions)
        .set({ status: 'rejected' })
        .where(eq(t.chartRevisions.id, draft.id));
      await expectEditorError(
        publishRevision(handle.db, arrangementId, draft.id),
        'PUBLISH_REJECTED',
      );
      await expectEditorError(
        publishRevision(handle.db, arrangementId, 'rev_demo_001'),
        'NOT_FOUND',
      );
      await expectEditorError(publishRevision(handle.db, 'arr_missing', draft.id), 'NOT_FOUND');
    });
  });
}
