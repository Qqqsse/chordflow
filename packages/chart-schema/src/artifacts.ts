import { z } from 'zod';
import { OpaqueIdSchema, SemVerSchema } from './primitives';

/*
 * Layered analysis cache (SPEC §9). Each derived artifact is keyed by input
 * fingerprint + processor id/version + config hash + schema version, and a
 * change invalidates only its own branch and dependents.
 */

export const ARTIFACT_KINDS = [
  'source_metadata',
  'audio_preprocess',
  'separated_stems',
  'chord_timeline',
  'asr_transcript',
  'aligned_lyrics',
  'fusion_draft',
] as const;
export const ArtifactKindSchema = z.enum(ARTIFACT_KINDS);
export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;

/** External inputs that are not artifacts but feed the graph. */
export const PIPELINE_INPUTS = ['authorized_audio', 'reference_lyrics'] as const;
export type PipelineInput = (typeof PIPELINE_INPUTS)[number];
export type PipelineNode = ArtifactKind | PipelineInput;

/** Direct upstream dependencies of each artifact kind. */
export const ARTIFACT_DEPENDENCIES: Readonly<Record<ArtifactKind, readonly PipelineNode[]>> = {
  source_metadata: [],
  audio_preprocess: ['authorized_audio'],
  separated_stems: ['audio_preprocess'],
  // Chord recognition may run on the original mix or on stems (compared in M8).
  chord_timeline: ['audio_preprocess', 'separated_stems'],
  asr_transcript: ['audio_preprocess', 'separated_stems'],
  aligned_lyrics: ['asr_transcript', 'reference_lyrics', 'audio_preprocess'],
  fusion_draft: ['chord_timeline', 'aligned_lyrics', 'source_metadata'],
};

/** Every artifact kind that must be recomputed when `node` changes (transitive). */
export function invalidatedBy(node: PipelineNode): ArtifactKind[] {
  const result = new Set<ArtifactKind>();
  const visit = (changed: PipelineNode) => {
    for (const kind of ARTIFACT_KINDS) {
      if (!result.has(kind) && ARTIFACT_DEPENDENCIES[kind].includes(changed)) {
        result.add(kind);
        visit(kind);
      }
    }
  };
  visit(node);
  return ARTIFACT_KINDS.filter((kind) => result.has(kind));
}

export const FingerprintSchema = z
  .string()
  .regex(/^sha256:[0-9a-f]{64}$/, 'must be sha256:<64 lowercase hex>');

export const ArtifactCacheKeyPartsSchema = z.strictObject({
  kind: ArtifactKindSchema,
  /** Fingerprint of the inputs: audio digest, or digest of upstream artifact keys. */
  inputFingerprint: FingerprintSchema,
  processorId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/),
  processorVersion: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9._+-]+$/),
  configHash: FingerprintSchema,
  schemaVersion: SemVerSchema,
});
export type ArtifactCacheKeyParts = z.infer<typeof ArtifactCacheKeyPartsSchema>;

/** Deterministic, human-readable cache key. Parts are validated so the format is unambiguous. */
export function artifactCacheKey(parts: ArtifactCacheKeyParts): string {
  const p = ArtifactCacheKeyPartsSchema.parse(parts);
  return [
    p.kind,
    `v${p.schemaVersion}`,
    `${p.processorId}@${p.processorVersion}`,
    p.configHash,
    p.inputFingerprint,
  ].join('|');
}

export const ArtifactManifestEntrySchema = z.strictObject({
  id: OpaqueIdSchema,
  kind: ArtifactKindSchema,
  cacheKey: z.string().min(1).max(1024),
  /** Storage-relative path inside the artifact store; never an absolute host path or URL. */
  storagePath: z
    .string()
    .min(1)
    .max(512)
    .regex(/^(?!\/)(?!.*\.\.)[A-Za-z0-9._/-]+$/, 'must be a relative path without ".."'),
  contentDigest: FingerprintSchema,
  byteSize: z.int().min(0),
  mediaType: z.string().regex(/^[a-z]+\/[a-z0-9.+-]+$/),
  parentArtifactIds: z.array(OpaqueIdSchema).max(32),
});
export type ArtifactManifestEntry = z.infer<typeof ArtifactManifestEntrySchema>;
