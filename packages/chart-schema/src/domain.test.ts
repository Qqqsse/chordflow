import { describe, expect, it } from 'vitest';
import { CatalogSnapshotSchema, type CatalogSnapshot } from './catalog';
import { parseChartDocument } from './chart-document';
import {
  canAnalyzeSource,
  checkCompatibility,
  checkPublishable,
  isVerifiedCompatibility,
  rightsAllowVisibility,
  type ChartRevision,
  type ContentRights,
} from './domain';
import { parseRecordingSync } from './recording-sync';
import { readFixture } from './testing/fixtures';

const catalog: CatalogSnapshot = CatalogSnapshotSchema.parse(
  readFixture('contracts/catalog-demo.json'),
);

function byId<T extends { id: string }>(items: readonly T[], id: string): T {
  const item = items.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`fixture missing ${id}`);
  return item;
}

function revisionWithDocument(id: string): ChartRevision {
  const { documentFixture, ...meta } = byId(catalog.revisions, id);
  return { ...meta, document: parseChartDocument(readFixture(documentFixture)) };
}

describe('catalog snapshot fixture', () => {
  it('references only existing entities', () => {
    const ids = (items: readonly { id: string }[]) => new Set(items.map((i) => i.id));
    const artists = ids(catalog.artists);
    const works = ids(catalog.works);
    const recordings = ids(catalog.recordings);
    const arrangements = ids(catalog.arrangements);
    const sources = ids(catalog.sources);
    const revisions = ids(catalog.revisions);
    for (const work of catalog.works) {
      for (const credit of work.credits) expect(artists).toContain(credit.artistId);
    }
    for (const rec of catalog.recordings) {
      expect(works).toContain(rec.workId);
      for (const s of rec.sourceReferenceIds) expect(sources).toContain(s);
      for (const c of rec.artistCredits) expect(artists).toContain(c.artistId);
    }
    for (const arr of catalog.arrangements) {
      expect(works).toContain(arr.workId);
      if (arr.publishedRevisionId) expect(revisions).toContain(arr.publishedRevisionId);
    }
    for (const c of catalog.compatibilities) {
      expect(arrangements).toContain(c.arrangementId);
      expect(recordings).toContain(c.recordingId);
    }
  });

  it('every revision document matches its revision row', () => {
    for (const { id } of catalog.revisions) {
      const revision = revisionWithDocument(id);
      const arrangement = byId(catalog.arrangements, revision.arrangementId);
      expect(checkPublishable(arrangement, revision)).toEqual([]);
    }
  });

  it('every compatibility row stays within one Work', () => {
    for (const compat of catalog.compatibilities) {
      const issues = checkCompatibility(
        byId(catalog.arrangements, compat.arrangementId),
        byId(catalog.recordings, compat.recordingId),
        compat,
      );
      expect(issues).toEqual([]);
    }
  });

  it('distinguishes studio and live recordings with the same title and artist', () => {
    const studio = byId(catalog.recordings, 'rec_demo_001');
    const live = byId(catalog.recordings, 'rec_demo_002');
    expect(studio.workId).toBe(live.workId);
    expect(studio.artistCredits).toEqual(live.artistCredits);
    expect(studio.kind).toBe('studio');
    expect(live.kind).toBe('live');
  });

  it('one arrangement serves two recordings with independent syncs', () => {
    const syncs = catalog.syncs.filter((s) => s.chartRevisionId === 'rev_demo_001');
    expect(new Set(syncs.map((s) => s.recordingId))).toEqual(
      new Set(['rec_demo_001', 'rec_demo_002']),
    );
    const chart = revisionWithDocument('rev_demo_001').document;
    for (const ref of syncs) {
      const sync = parseRecordingSync(readFixture(ref.syncFixture), { chart });
      expect(sync.recordingId).toBe(ref.recordingId);
    }
  });

  it('treats a suggested cover mapping as unverified', () => {
    const cover = catalog.compatibilities.find((c) => c.recordingId === 'rec_demo_003');
    expect(cover?.provenance).toBe('suggested');
    expect(isVerifiedCompatibility('suggested')).toBe(false);
    expect(isVerifiedCompatibility('unknown')).toBe(false);
    expect(isVerifiedCompatibility('human_verified')).toBe(true);
    expect(isVerifiedCompatibility('exact_audio_match')).toBe(true);
  });
});

describe('rights and publishing invariants', () => {
  const rights = (lyrics: ContentRights['lyrics'], chart = lyrics): ContentRights => ({
    lyrics,
    chart,
    audio: 'unknown',
    attribution: null,
    notes: null,
  });

  it('fails closed for unknown rights beyond private', () => {
    expect(rightsAllowVisibility(rights('unknown'), 'private')).toBe(true);
    expect(rightsAllowVisibility(rights('unknown'), 'shared')).toBe(false);
    expect(rightsAllowVisibility(rights('unknown'), 'public')).toBe(false);
    expect(rightsAllowVisibility(rights('licensed', 'not_permitted'), 'shared')).toBe(false);
    expect(rightsAllowVisibility(rights('licensed'), 'public')).toBe(true);
  });

  it('rejects publishing a draft, another arrangement’s revision or unlicensed public content', () => {
    const revision = revisionWithDocument('rev_demo_001');
    const arrangement = byId(catalog.arrangements, 'arr_demo_001');
    const other = byId(catalog.arrangements, 'arr_demo_en_001');

    expect(checkPublishable(arrangement, { ...revision, status: 'draft' })).toHaveLength(1);
    expect(checkPublishable(other, revision).map((i) => i.path)).toContainEqual(['arrangementId']);
    expect(
      checkPublishable({ ...arrangement, rights: rights('unknown') }, revision).map((i) => i.path),
    ).toContainEqual(['rights']);
  });

  it('detects documents that disagree with their revision row', () => {
    const revision = revisionWithDocument('rev_demo_001');
    const arrangement = byId(catalog.arrangements, 'arr_demo_001');
    const tampered = { ...revision, document: { ...revision.document, revision: 2 } };
    expect(checkPublishable(arrangement, tampered).map((i) => i.path)).toEqual([
      ['document', 'revision'],
    ]);
  });

  it('flags cross-Work compatibility unless explicitly reviewed', () => {
    const arrangement = byId(catalog.arrangements, 'arr_demo_en_001');
    const recording = byId(catalog.recordings, 'rec_demo_001');
    const base = {
      arrangementId: arrangement.id,
      recordingId: recording.id,
      provenance: 'suggested' as const,
      recordedKey: null,
      transposeSemitones: null,
      crossWorkReviewed: false,
      createdAt: '2026-10-23T00:00:00Z',
      updatedAt: '2026-10-23T00:00:00Z',
    };
    expect(checkCompatibility(arrangement, recording, base)).toHaveLength(1);
    expect(
      checkCompatibility(arrangement, recording, { ...base, crossWorkReviewed: true }),
    ).toEqual([]);
  });
});

describe('source permissions', () => {
  it('a public video link is discovery-only, never analyzable', () => {
    expect(canAnalyzeSource(byId(catalog.sources, 'src_demo_video_001'))).toBe(false);
  });

  it('an authorized upload with an audio_analysis grant is analyzable', () => {
    expect(canAnalyzeSource(byId(catalog.sources, 'src_demo_upload_001'))).toBe(true);
  });

  it('analysis permission without the audio_analysis use is not enough', () => {
    const source = byId(catalog.sources, 'src_demo_upload_001');
    expect(canAnalyzeSource({ ...source, permittedUses: ['metadata'] })).toBe(false);
  });

  it('rejects non-https source URLs', () => {
    const source = byId(catalog.sources, 'src_demo_video_001');
    const parsed = CatalogSnapshotSchema.shape.sources.element.safeParse({
      ...source,
      url: 'http://127.0.0.1/admin',
    });
    expect(parsed.success).toBe(false);
  });
});
