import { z } from 'zod';

/** Opaque stable identifier (UUID/ULID or prefixed fixture id). Never a display name. */
export const OpaqueIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/, 'must be an opaque id: [A-Za-z0-9_-], max 128');

export const SemVerSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, 'must be semver MAJOR.MINOR.PATCH');

/** BCP 47 language tag subset, e.g. `zh-TW`, `en`, `zh-Hant-TW`. */
export const LanguageTagSchema = z
  .string()
  .regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, 'must be a BCP 47 language tag');

/** Scientific pitch notation for an open string, e.g. `E2`, `F#3`, `Bb1`. */
export const PitchNameSchema = z
  .string()
  .regex(/^[A-G](#|b)?-?\d$/, 'must be scientific pitch notation like E2 or F#3');

/** Key name: tonic with optional accidental, `m` for minor (e.g. `C`, `F#m`, `Bb`). */
export const KeyNameSchema = z.string().regex(/^[A-G](#|b)?m?$/, 'must be a key like C, F#m or Bb');

export const TimeSignatureSchema = z
  .string()
  .regex(/^([1-9]|[1-3]\d)\/(1|2|4|8|16|32)$/, 'must be a time signature like 4/4 or 6/8');

/**
 * Raw chord symbol as written. Full musical validity is decided by
 * `@chordflow/music-theory`; the schema only rejects inputs that can never be
 * a chord symbol (whitespace, brackets, markup, overly long strings).
 */
export const ChordSymbolTextSchema = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[^\s[\]{}<>"'`\\]+$/u, 'must not contain whitespace, brackets or markup characters');

/** Namespaced extension data: keys like `x-vendor` or `x-vendor.feature`. */
export const ExtensionsSchema = z.record(
  z.string().regex(/^x-[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)*$/),
  z.json(),
);

export const UtcTimestampSchema = z.iso.datetime({ offset: false });

export const DIFFICULTIES = ['easy', 'intermediate', 'advanced'] as const;
export const DifficultySchema = z.enum(DIFFICULTIES);
export type Difficulty = z.infer<typeof DifficultySchema>;
