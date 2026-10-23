import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_KINDS,
  ArtifactManifestEntrySchema,
  artifactCacheKey,
  invalidatedBy,
  type ArtifactCacheKeyParts,
} from './artifacts';

const sha = (c: string) => `sha256:${c.repeat(64)}`;

const parts: ArtifactCacheKeyParts = {
  kind: 'chord_timeline',
  inputFingerprint: sha('a'),
  processorId: 'mock-chords',
  processorVersion: '0.1.0',
  configHash: sha('b'),
  schemaVersion: '1.0.0',
};

describe('artifact invalidation graph', () => {
  it('a lyrics change invalidates alignment and fusion only', () => {
    expect(invalidatedBy('reference_lyrics')).toEqual(['aligned_lyrics', 'fusion_draft']);
  });

  it('a chord model change invalidates only its dependents', () => {
    expect(invalidatedBy('chord_timeline')).toEqual(['fusion_draft']);
  });

  it('new audio invalidates every audio-derived artifact but not source metadata', () => {
    expect(invalidatedBy('authorized_audio')).toEqual(
      ARTIFACT_KINDS.filter((kind) => kind !== 'source_metadata'),
    );
  });

  it('fusion has no dependents', () => {
    expect(invalidatedBy('fusion_draft')).toEqual([]);
  });
});

describe('artifactCacheKey', () => {
  it('is deterministic and includes every part', () => {
    const key = artifactCacheKey(parts);
    expect(key).toBe(artifactCacheKey({ ...parts }));
    expect(key).toBe(`chord_timeline|v1.0.0|mock-chords@0.1.0|${sha('b')}|${sha('a')}`);
  });

  it.each<[keyof ArtifactCacheKeyParts, string]>([
    ['processorVersion', '0.2.0'],
    ['configHash', sha('c')],
    ['inputFingerprint', sha('d')],
    ['schemaVersion', '1.1.0'],
  ])('changes when %s changes', (field, value) => {
    expect(artifactCacheKey({ ...parts, [field]: value })).not.toBe(artifactCacheKey(parts));
  });

  it('rejects parts that could make keys ambiguous', () => {
    expect(() => artifactCacheKey({ ...parts, processorId: 'a|b' })).toThrow();
    expect(() => artifactCacheKey({ ...parts, configHash: 'md5:abc' })).toThrow();
  });
});

describe('artifact manifest entries', () => {
  const entry = {
    id: 'art_001',
    kind: 'chord_timeline',
    cacheKey: artifactCacheKey(parts),
    storagePath: 'jobs/job_001/chords.json',
    contentDigest: sha('e'),
    byteSize: 1024,
    mediaType: 'application/json',
    parentArtifactIds: [],
  };

  it('accepts relative storage paths', () => {
    expect(ArtifactManifestEntrySchema.safeParse(entry).success).toBe(true);
  });

  it.each(['/etc/passwd', '../secrets.json', 'jobs/../../x', 'https://evil.example/x'])(
    'rejects unsafe storage path %s',
    (storagePath) => {
      expect(ArtifactManifestEntrySchema.safeParse({ ...entry, storagePath }).success).toBe(false);
    },
  );
});
