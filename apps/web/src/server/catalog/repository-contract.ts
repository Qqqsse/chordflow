import { describe, expect, it } from 'vitest';
import type { CatalogRepository } from './repository';
import { normalizeSearchText } from './search-text';

/**
 * Behaviour every CatalogRepository adapter must share, run against the
 * in-memory adapter always and against PostgreSQL when a test database is
 * configured. Expects the synthetic demo catalog to be loaded.
 */
export function describeCatalogRepositoryContract(
  name: string,
  getRepo: () => CatalogRepository,
): void {
  describe(`CatalogRepository contract: ${name}`, () => {
    it('serves the published revision for an arrangement', async () => {
      const revision = await getRepo().getPublishedRevision('arr_demo_001');
      expect(revision?.id).toBe('rev_demo_001');
      expect(revision?.status).toBe('published');
      expect(revision?.document.title).toBe('示範歌曲（虛構）');
    });

    it('looks up revisions by number and lists them in order', async () => {
      const repo = getRepo();
      expect((await repo.getRevision('arr_demo_001', 1))?.id).toBe('rev_demo_001');
      expect(await repo.getRevision('arr_demo_001', 2)).toBeNull();
      expect((await repo.listRevisions('arr_demo_001')).map((r) => r.revision)).toEqual([1]);
    });

    it('returns null for unknown ids', async () => {
      const repo = getRepo();
      expect(await repo.getWork('work_missing')).toBeNull();
      expect(await repo.getArrangement('arr_missing')).toBeNull();
      expect(await repo.getPublishedRevision('arr_missing')).toBeNull();
      expect(await repo.getRecording('rec_missing')).toBeNull();
    });

    it('keeps recording-specific syncs separate for one arrangement', async () => {
      const repo = getRepo();
      expect((await repo.getRecordingSync('rec_demo_001', 'rev_demo_001'))?.recordingId).toBe(
        'rec_demo_001',
      );
      expect((await repo.getRecordingSync('rec_demo_002', 'rev_demo_001'))?.recordingId).toBe(
        'rec_demo_002',
      );
      expect(await repo.getRecordingSync('rec_demo_003', 'rev_demo_001')).toBeNull();
    });

    it('distinguishes recordings of one work and lists mappings', async () => {
      const repo = getRepo();
      const recordings = await repo.listRecordingsForWork('work_demo_001');
      expect(recordings.map((r) => r.kind).sort()).toEqual(['cover', 'live', 'studio']);
      const live = recordings.find((r) => r.kind === 'live');
      expect(live?.artistCredits).toEqual([{ artistId: 'art_demo_a', role: 'performer' }]);
      const mappings = await repo.listCompatibilities({ arrangementId: 'arr_demo_001' });
      expect(mappings.map((m) => [m.recordingId, m.provenance])).toEqual([
        ['rec_demo_001', 'human_verified'],
        ['rec_demo_002', 'human_verified'],
        ['rec_demo_003', 'suggested'],
      ]);
      expect(await repo.listCompatibilities({ recordingId: 'rec_demo_003' })).toHaveLength(1);
    });

    it('returns works with ordered credits and sources with permissions', async () => {
      const repo = getRepo();
      const work = await repo.getWork('work_pd_songbie');
      expect(work?.credits).toEqual([
        { artistId: 'art_pd_li_shutong', role: 'lyricist' },
        { artistId: 'art_pd_ordway', role: 'composer' },
      ]);
      const source = await repo.getSource('src_demo_video_001');
      expect(source).toMatchObject({
        platform: 'youtube',
        permission: 'discovery_only',
        url: null,
      });
      expect((await repo.getRecording('rec_demo_001'))?.sourceReferenceIds).toEqual([
        'src_demo_upload_001',
      ]);
    });

    it('finds sources by platform id and the recordings that use them', async () => {
      const repo = getRepo();
      const source = await repo.findSourceByPlatformId('youtube', 'DEMO0000001');
      expect(source?.id).toBe('src_demo_video_001');
      expect((await repo.listRecordingsForSource('src_demo_video_001')).map((r) => r.id)).toEqual([
        'rec_demo_003',
      ]);
      expect(await repo.findSourceByPlatformId('youtube', 'XXXXXXXXXXX')).toBeNull();
    });

    it('returns copies so callers cannot mutate stored revisions', async () => {
      const repo = getRepo();
      const first = await repo.getRevisionById('rev_demo_001');
      if (!first) throw new Error('missing fixture');
      first.document.title = 'tampered';
      expect((await repo.getRevisionById('rev_demo_001'))?.document.title).toBe('示範歌曲（虛構）');
    });

    it.each<[string, string[]]>([
      ['送別', ['work_pd_songbie']],
      ['送别', ['work_pd_songbie']],
      ['李叔同', ['work_pd_songbie']],
      ['paper boats', ['work_demo_en']],
      ['Demo Singer B', ['work_demo_en', 'work_demo_001']],
      ['示範歌手甲', ['work_demo_001', 'work_demo_full_zh']],
      ['奇異恩典', ['work_pd_amazing_grace']],
      ['zzz-not-there', []],
    ])('search %j finds %j', async (query, expected) => {
      const result = await getRepo().searchWorks(normalizeSearchText(query), {
        limit: 10,
        offset: 0,
      });
      expect(result.works.map((w) => w.id).sort()).toEqual([...expected].sort());
    });

    it('pages search results without overlap', async () => {
      const repo = getRepo();
      const q = normalizeSearchText('示範');
      const first = await repo.searchWorks(q, { limit: 1, offset: 0 });
      const second = await repo.searchWorks(q, { limit: 1, offset: 1 });
      expect(first.hasMore).toBe(true);
      expect(first.works[0]?.id).not.toBe(second.works[0]?.id);
      const all = await repo.searchWorks(q, { limit: 50, offset: 0 });
      expect(all.hasMore).toBe(false);
      expect(all.works.slice(0, 2).map((w) => w.id)).toEqual([
        first.works[0]?.id,
        second.works[0]?.id,
      ]);
    });
  });
}
