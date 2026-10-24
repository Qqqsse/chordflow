import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import snapshot from '../../../../../fixtures/contracts/catalog-demo.json';
import { openDatabase, type DatabaseHandle } from '../db/client';
import { runMigrations } from '../db/migrate';
import * as t from '../db/schema';
import { DEMO_FIXTURE_FILES } from './demo-catalog';
import { createPgCatalog } from './pg-repository';
import type { CatalogRepository } from './repository';
import { describeCatalogRepositoryContract } from './repository-contract';
import { seedCatalog } from './seed';

/**
 * PostgreSQL integration tests. Run only when TEST_DATABASE_URL points at a
 * disposable database: the public schema is dropped and recreated.
 */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('PostgreSQL catalog', () => {
  let handle: DatabaseHandle;
  let repo: CatalogRepository;

  beforeAll(async () => {
    handle = openDatabase(url ?? '', { max: 4 });
    await handle.db.execute(
      sql.raw(
        'drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;',
      ),
    );
    await runMigrations(handle.db);
    await seedCatalog(handle.db, snapshot, DEMO_FIXTURE_FILES);
    repo = createPgCatalog(handle.db);
  }, 60_000);

  afterAll(async () => {
    await handle.close();
  });

  describeCatalogRepositoryContract('postgres', () => repo);

  const expectDbError = async (work: Promise<unknown>, code: string) => {
    await expect(work).rejects.toSatisfy((error: unknown) => {
      const text = String((error as { cause?: unknown }).cause ?? error);
      return text.includes(code);
    });
  };

  it('keeps revision documents immutable', async () => {
    const revision = await repo.getRevisionById('rev_demo_001');
    if (!revision) throw new Error('missing');
    await expectDbError(
      handle.db
        .update(t.chartRevisions)
        .set({ document: { ...revision.document, title: 'changed' } })
        .where(sql`${t.chartRevisions.id} = 'rev_demo_001'`),
      'CHART_REVISION_IMMUTABLE',
    );
    await expectDbError(
      handle.db.delete(t.chartRevisions).where(sql`${t.chartRevisions.id} = 'rev_demo_001'`),
      'CHART_REVISION_IMMUTABLE',
    );
  });

  it('rejects a published pointer to another arrangement or a draft', async () => {
    await expectDbError(
      handle.db
        .update(t.arrangements)
        .set({ publishedRevisionId: 'rev_demo_en_001' })
        .where(sql`${t.arrangements.id} = 'arr_demo_001'`),
      'PUBLISHED_REVISION_INVALID',
    );
  });

  it('rejects duplicate revision numbers and mismatched documents', async () => {
    const revision = await repo.getRevisionById('rev_demo_001');
    if (!revision) throw new Error('missing');
    const doc = { ...revision.document, chartRevisionId: 'rev_dup' };
    await expectDbError(
      handle.db.insert(t.chartRevisions).values({
        id: 'rev_dup',
        arrangementId: 'arr_demo_001',
        revision: 1,
        status: 'draft',
        origin: 'human',
        document: doc,
        schemaVersion: doc.schemaVersion,
      }),
      'chart_revisions_number',
    );
    await expectDbError(
      handle.db.insert(t.chartRevisions).values({
        id: 'rev_mismatch',
        arrangementId: 'arr_demo_001',
        revision: 2,
        status: 'draft',
        origin: 'human',
        document: doc,
        schemaVersion: doc.schemaVersion,
      }),
      'chart_revisions_document_ids',
    );
  });

  it('rejects cross-work mappings unless reviewed', async () => {
    await expectDbError(
      handle.db.insert(t.arrangementRecordings).values({
        arrangementId: 'arr_demo_en_001',
        recordingId: 'rec_demo_001',
        provenance: 'suggested',
      }),
      'CROSS_WORK_MAPPING',
    );
  });

  it('rejects timing for an unmapped recording', async () => {
    const sync = await repo.getRecordingSync('rec_demo_001', 'rev_demo_001');
    if (!sync) throw new Error('missing');
    await expectDbError(
      handle.db.insert(t.recordingSyncs).values({
        recordingId: 'rec_demo_en_001',
        chartRevisionId: 'rev_demo_001',
        document: { ...sync, recordingId: 'rec_demo_en_001' },
      }),
      'SYNC_WITHOUT_MAPPING',
    );
  });

  it('rejects a second source with the same platform id', async () => {
    await expectDbError(
      handle.db.insert(t.sourceReferences).values({
        id: 'src_dup',
        platform: 'youtube',
        platformSourceId: 'DEMO0000001',
        url: null,
        metadata: { title: null, artist: null, durationMs: null },
        permission: 'discovery_only',
        acquiredAt: '2026-10-24T00:00:00Z',
      }),
      'source_platform_id',
    );
  });
});
