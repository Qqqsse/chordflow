import { z } from 'zod';
import { ArrangementSummarySchema } from './api';
import { ChordSymbolTextSchema, OpaqueIdSchema, UtcTimestampSchema } from './primitives';

/*
 * Personal library (SPEC §4 item 12, §8): favorites, recently opened charts
 * and per-user viewer preferences. Preferences are viewer overrides only; they
 * never change the chart document, an arrangement or a RecordingSync.
 */

export const VIEWER_PREFERENCES_VERSION = 1;
export const MAX_SAVED_VOICING_CHOICES = 64;
export const MAX_RECENT_CHARTS = 20;

/** UserChartPreference v1: what a signed-in reader last chose for one arrangement. */
export const ViewerPreferencesSchema = z.strictObject({
  version: z.literal(VIEWER_PREFERENCES_VERSION),
  transposeSemitones: z.int().min(-11).max(11),
  capoFret: z.int().min(0).max(12),
  capoMode: z.enum(['keep_pitch', 'keep_shape']),
  show: z.enum(['shape', 'sounding']),
  notation: z.enum(['letters', 'roman', 'nashville']),
  fontSize: z.int().min(14).max(32),
  /** Chord shape symbol → voicing id, the reader's own choice. */
  voicingChoices: z
    .record(ChordSymbolTextSchema, OpaqueIdSchema)
    .refine((choices) => Object.keys(choices).length <= MAX_SAVED_VOICING_CHOICES, {
      message: `at most ${String(MAX_SAVED_VOICING_CHOICES)} voicing choices`,
    }),
  showDiagrams: z.boolean(),
  readingMode: z.enum(['continuous', 'pages']),
  /** Autoscroll speed in CSS pixels per second. */
  scrollSpeed: z.number().min(5).max(120),
});
export type ViewerPreferences = z.infer<typeof ViewerPreferencesSchema>;

export const ViewerPreferencesDataSchema = z.strictObject({
  arrangementId: OpaqueIdSchema,
  /** `null` when the reader has not saved anything for this arrangement yet. */
  preferences: ViewerPreferencesSchema.nullable(),
  updatedAt: UtcTimestampSchema.nullable(),
});

export const LibraryItemSchema = z.strictObject({
  arrangement: ArrangementSummarySchema,
  work: z.strictObject({ id: OpaqueIdSchema, title: z.string() }),
  /** When it was favorited (favorites) or last opened (recent). */
  at: UtcTimestampSchema,
});
export type LibraryItem = z.infer<typeof LibraryItemSchema>;

export const LibraryDataSchema = z.strictObject({
  favorites: z.array(LibraryItemSchema),
  recent: z.array(LibraryItemSchema).max(MAX_RECENT_CHARTS),
});
export type LibraryData = z.infer<typeof LibraryDataSchema>;

export const FavoriteDataSchema = z.strictObject({
  arrangementId: OpaqueIdSchema,
  favorite: z.boolean(),
});
