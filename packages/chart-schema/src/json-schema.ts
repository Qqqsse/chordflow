import { z } from 'zod';
import { CatalogSnapshotSchema } from './catalog';
import { ChartDocumentSchema } from './chart-document';
import { ArtifactManifestEntrySchema } from './artifacts';
import { RecordingSyncSchema } from './recording-sync';

/**
 * Published JSON Schemas (draft 2020-12) for language-neutral consumers such
 * as the Python worker. They describe structure only; cross-field invariants
 * (unique ids, grapheme bounds, NFC, monotonic tracks) are enforced by the
 * semantic validators and must be re-implemented by other consumers.
 */
const PUBLISHED = {
  'chart-document.v1.schema.json': {
    schema: ChartDocumentSchema,
    title: 'chordflow Chart Document v1',
  },
  'recording-sync.v1.schema.json': {
    schema: RecordingSyncSchema,
    title: 'chordflow RecordingSync v1',
  },
  'catalog-snapshot.v1.schema.json': {
    schema: CatalogSnapshotSchema,
    title: 'chordflow catalog snapshot v1 (fixtures/seed)',
  },
  'artifact-manifest-entry.v1.schema.json': {
    schema: ArtifactManifestEntrySchema,
    title: 'chordflow artifact manifest entry v1',
  },
} as const;

export type PublishedSchemaFile = keyof typeof PUBLISHED;

export function buildJsonSchemas(): Record<PublishedSchemaFile, Record<string, unknown>> {
  const out = {} as Record<PublishedSchemaFile, Record<string, unknown>>;
  for (const [file, { schema, title }] of Object.entries(PUBLISHED) as [
    PublishedSchemaFile,
    (typeof PUBLISHED)[PublishedSchemaFile],
  ][]) {
    const generated = z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'input' });
    out[file] = {
      $id: `https://chordflow.invalid/schemas/${file}`,
      title,
      ...generated,
    };
  }
  return out;
}

export function serializeJsonSchema(schema: Record<string, unknown>): string {
  return `${JSON.stringify(schema, null, 2)}\n`;
}
