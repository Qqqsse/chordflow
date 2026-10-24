import { ContractValidationError } from '@chordflow/chart-schema';
import { describe, expect, it } from 'vitest';
import snapshot from '../../../../../fixtures/contracts/catalog-demo.json';
import { DEMO_FIXTURE_FILES, getDemoCatalog } from './demo-catalog';
import { createMemoryCatalog } from './memory-repository';
import { describeCatalogRepositoryContract } from './repository-contract';

type Snapshot = typeof snapshot;

function mutated(change: (s: Snapshot) => void): Snapshot {
  const copy = structuredClone(snapshot);
  change(copy);
  return copy;
}

describeCatalogRepositoryContract('memory', getDemoCatalog);

describe('demo catalog', () => {
  const catalog = getDemoCatalog();

  it('serves the published revision for an arrangement', async () => {
    const revision = await catalog.getPublishedRevision('arr_demo_001');
    expect(revision?.id).toBe('rev_demo_001');
    expect(revision?.document.title).toBe('示範歌曲（虛構）');
  });

  it('looks up revisions by number and lists them in order', async () => {
    expect((await catalog.getRevision('arr_demo_001', 1))?.id).toBe('rev_demo_001');
    expect(await catalog.getRevision('arr_demo_001', 2)).toBeNull();
    expect((await catalog.listRevisions('arr_demo_001')).map((r) => r.revision)).toEqual([1]);
  });

  it('returns null for unknown ids', async () => {
    expect(await catalog.getWork('work_missing')).toBeNull();
    expect(await catalog.getArrangement('arr_missing')).toBeNull();
    expect(await catalog.getPublishedRevision('arr_missing')).toBeNull();
  });

  it('keeps recording-specific syncs separate for one arrangement', async () => {
    const studio = await catalog.getRecordingSync('rec_demo_001', 'rev_demo_001');
    const live = await catalog.getRecordingSync('rec_demo_002', 'rev_demo_001');
    const cover = await catalog.getRecordingSync('rec_demo_003', 'rev_demo_001');
    expect(studio?.recordingId).toBe('rec_demo_001');
    expect(live?.recordingId).toBe('rec_demo_002');
    expect(cover).toBeNull(); // suggested mapping: no timing reused
  });

  it('lists recordings and arrangement mappings for a work', async () => {
    const recordings = await catalog.listRecordingsForWork('work_demo_001');
    expect(recordings.map((r) => r.kind).sort()).toEqual(['cover', 'live', 'studio']);
    const mappings = await catalog.listCompatibilities({ arrangementId: 'arr_demo_001' });
    expect(mappings).toHaveLength(3);
  });

  it('returns copies so callers cannot mutate stored revisions', async () => {
    const first = await catalog.getRevisionById('rev_demo_001');
    if (!first) throw new Error('missing fixture');
    first.document.title = 'tampered';
    const second = await catalog.getRevisionById('rev_demo_001');
    expect(second?.document.title).toBe('示範歌曲（虛構）');
  });
});

describe('createMemoryCatalog validation', () => {
  it('rejects a snapshot that breaks the schema', () => {
    expect(() => createMemoryCatalog({ ...snapshot, works: 'nope' }, DEMO_FIXTURE_FILES)).toThrow(
      ContractValidationError,
    );
  });

  it('rejects a missing document fixture', () => {
    expect(() => createMemoryCatalog(snapshot, {})).toThrow(/fixture file is missing/);
  });

  it('rejects a published pointer to a draft revision', () => {
    const bad = mutated((s) => {
      const rev = s.revisions[0];
      if (rev) rev.status = 'draft';
    });
    expect(() => createMemoryCatalog(bad, DEMO_FIXTURE_FILES)).toThrow(/published/);
  });

  it('rejects public visibility with unknown rights', () => {
    const bad = mutated((s) => {
      const arr = s.arrangements[0];
      if (arr) arr.rights.lyrics = 'unknown';
    });
    expect(() => createMemoryCatalog(bad, DEMO_FIXTURE_FILES)).toThrow(/rights/);
  });

  it('rejects duplicate ids', () => {
    const bad = mutated((s) => {
      const first = s.works[0];
      if (first) s.works.push(structuredClone(first));
    });
    expect(() => createMemoryCatalog(bad, DEMO_FIXTURE_FILES)).toThrow(/duplicate/);
  });

  it('rejects a sync registered for the wrong recording', () => {
    const bad = mutated((s) => {
      const sync = s.syncs[0];
      if (sync) sync.recordingId = 'rec_demo_003';
    });
    expect(() => createMemoryCatalog(bad, DEMO_FIXTURE_FILES)).toThrow(/another recording/);
  });
});
