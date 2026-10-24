import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { artifactCacheKey, type ArtifactManifestEntry } from './artifacts';
import { validateChartDocument } from './chart-document';
import {
  GenerationJobCreateRequestSchema,
  QualityReportSchema,
  WorkerClaimDataSchema,
  WorkerClaimRequestSchema,
  WorkerCompleteRequestSchema,
  WorkerFailRequestSchema,
  WorkerHeartbeatRequestSchema,
  checkArtifactManifest,
  checkQualityTargets,
  type QualityReport,
} from './generation';

const DIR = fileURLToPath(new URL('../../../fixtures/contracts/worker/', import.meta.url));
const load = (name: string): unknown => JSON.parse(readFileSync(`${DIR}${name}`, 'utf8'));

const SCHEMAS: Record<string, z.ZodType> = {
  WorkerClaimRequest: WorkerClaimRequestSchema,
  WorkerHeartbeatRequest: WorkerHeartbeatRequestSchema,
  WorkerCompleteRequest: WorkerCompleteRequestSchema,
  WorkerFailRequest: WorkerFailRequestSchema,
};

describe('worker contract fixtures (shared with the Python worker)', () => {
  it.each([
    ['claim-request.json', WorkerClaimRequestSchema],
    ['claim-response.json', WorkerClaimDataSchema],
    ['claim-response-empty.json', WorkerClaimDataSchema],
    ['heartbeat-request.json', WorkerHeartbeatRequestSchema],
    ['complete-request.json', WorkerCompleteRequestSchema],
    ['fail-request.json', WorkerFailRequestSchema],
    ['job-create-request.json', GenerationJobCreateRequestSchema],
  ] as const)('%s is valid', (name, schema: z.ZodType) => {
    const result = schema.safeParse(load(name));
    expect(result.error?.issues ?? []).toEqual([]);
  });

  const invalid = readdirSync(`${DIR}invalid`).filter((f) => f.endsWith('.case.json'));

  it('has invalid cases for both layers', () => {
    const layers = invalid.map((f) => (load(`invalid/${f}`) as { layer: string }).layer);
    expect(layers).toContain('structural');
    expect(layers).toContain('model');
  });

  it.each(invalid)('invalid/%s is rejected', (name) => {
    const fixture = load(`invalid/${name}`) as { schema: string; payload: unknown };
    const schema = SCHEMAS[fixture.schema];
    expect(schema).toBeDefined();
    expect(schema?.safeParse(fixture.payload).success).toBe(false);
  });

  it('the draft in the completion fixture is a valid chart once ids are assigned', () => {
    const complete = WorkerCompleteRequestSchema.parse(load('complete-request.json'));
    const result = validateChartDocument({
      ...complete.draft.document,
      chartRevisionId: 'rev_x',
      arrangementId: 'arr_x',
      revision: 1,
    });
    expect(result.issues).toEqual([]);
    expect(checkQualityTargets(complete.draft.document, complete.draft.quality)).toEqual([]);
    expect(checkArtifactManifest(complete.artifacts)).toEqual([]);
  });

  it('cache keys match the cross-language fixture', () => {
    const fixture = load('cache-key.json') as {
      parts: Parameters<typeof artifactCacheKey>[0];
      key: string;
    };
    expect(artifactCacheKey(fixture.parts)).toBe(fixture.key);
  });
});

describe('quality report', () => {
  const base = (): QualityReport =>
    WorkerCompleteRequestSchema.parse(load('complete-request.json')).draft.quality;

  it('forbids a confidence value on synthetic drafts', () => {
    expect(QualityReportSchema.safeParse({ ...base(), overallConfidence: 0.5 }).success).toBe(
      false,
    );
    expect(
      QualityReportSchema.safeParse({ ...base(), analysis: 'audio', overallConfidence: 0.5 })
        .success,
    ).toBe(true);
  });

  it('flags targets that do not exist in the draft', () => {
    const complete = WorkerCompleteRequestSchema.parse(load('complete-request.json'));
    const report = base();
    const spans = [
      ...report.spans,
      {
        target: { sectionId: 'sec_1', lineId: 'line_1_1', chordId: 'ch_missing' },
        reason: 'unaligned' as const,
        message: 'x',
        source: 'processor' as const,
      },
      {
        target: { sectionId: 'sec_1', lineId: null, chordId: 'ch_1_1_1' },
        reason: 'unaligned' as const,
        message: 'x',
        source: 'processor' as const,
      },
    ];
    const issues = checkQualityTargets(complete.draft.document, { ...report, spans });
    expect(issues.map((i) => i.path)).toEqual([
      ['spans', 2, 'target'],
      ['spans', 3, 'target'],
    ]);
  });
});

describe('artifact manifest graph', () => {
  const entries = (): ArtifactManifestEntry[] =>
    WorkerCompleteRequestSchema.parse(load('complete-request.json')).artifacts;

  it('rejects duplicate ids, unknown parents and wrong dependency kinds', () => {
    const list = entries();
    const [source, chords, lyrics, fusion] = list;
    if (!source || !chords || !lyrics || !fusion) throw new Error('fixture changed');
    const issues = checkArtifactManifest([
      source,
      { ...chords, parentArtifactIds: [source.id] },
      { ...lyrics, id: source.id },
      { ...fusion, parentArtifactIds: ['art_nope'] },
    ]);
    expect(issues.map((i) => i.code).sort()).toEqual([
      'DUPLICATE_ID',
      'UNKNOWN_REFERENCE',
      'UNKNOWN_REFERENCE',
    ]);
  });

  it('requires exactly one fusion_draft', () => {
    const list = entries().filter((e) => e.kind !== 'fusion_draft');
    expect(checkArtifactManifest(list).map((i) => i.code)).toEqual(['REFERENCE_MISMATCH']);
  });
});

describe('job submission', () => {
  it('applies defaults and rejects oversized lyrics', () => {
    const request = load('job-create-request.json') as Record<string, unknown>;
    const { options: _options, ...withoutOptions } = request;
    const parsed = GenerationJobCreateRequestSchema.parse(withoutOptions);
    expect(parsed.options).toEqual({ processor: 'mock', llmReview: 'disabled' });
    const tooManyLines = {
      ...request,
      input: { kind: 'reference_lyrics', language: 'zh-TW', lyrics: 'a\n'.repeat(200) },
    };
    expect(GenerationJobCreateRequestSchema.safeParse(tooManyLines).success).toBe(false);
    expect(
      GenerationJobCreateRequestSchema.safeParse({ ...request, idempotencyKey: 'short' }).success,
    ).toBe(false);
  });
});
