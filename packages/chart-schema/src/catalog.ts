import { z } from 'zod';
import {
  ArrangementRecordingCompatibilitySchema,
  ArrangementSchema,
  ArtistSchema,
  ChartRevisionSchema,
  RecordingSchema,
  SourceReferenceSchema,
  WorkSchema,
} from './domain';
import { OpaqueIdSchema, SemVerSchema } from './primitives';

/** Revision row without its document (relational metadata; the document is stored as JSONB). */
export const ChartRevisionMetaSchema = ChartRevisionSchema.omit({ document: true });
export type ChartRevisionMeta = z.infer<typeof ChartRevisionMetaSchema>;

/** Repository-relative path to a fixture file under `fixtures/`. */
const FixturePathSchema = z
  .string()
  .regex(/^(charts|ai|contracts)\/[a-z0-9][a-z0-9.-]*\.json$/, 'must be a fixtures/ relative path');

/**
 * Catalog snapshot used to seed the in-memory (demo) repository and contract
 * tests. Documents are referenced by fixture path to avoid duplicated JSON.
 */
export const CatalogSnapshotSchema = z.strictObject({
  schemaVersion: SemVerSchema,
  artists: z.array(ArtistSchema),
  works: z.array(WorkSchema),
  recordings: z.array(RecordingSchema),
  arrangements: z.array(ArrangementSchema),
  compatibilities: z.array(ArrangementRecordingCompatibilitySchema),
  sources: z.array(SourceReferenceSchema),
  revisions: z.array(ChartRevisionMetaSchema.extend({ documentFixture: FixturePathSchema })),
  syncs: z.array(
    z.strictObject({
      recordingId: OpaqueIdSchema,
      chartRevisionId: OpaqueIdSchema,
      syncFixture: FixturePathSchema,
    }),
  ),
});
export type CatalogSnapshot = z.infer<typeof CatalogSnapshotSchema>;
