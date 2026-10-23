# Schema decisions (contract v1)

Package: `packages/chart-schema` (`@chordflow/chart-schema`). Zod 4 schemas are the source of truth; JSON Schemas
(draft 2020-12) are generated into `packages/chart-schema/json-schema/` and checked in.

```sh
pnpm --filter @chordflow/chart-schema generate:json-schema   # after any schema change
```

A unit test fails when the committed JSON Schemas drift from the Zod schemas. The Python worker validates the same
fixtures against the generated JSON Schemas (`services/ai-worker/tests/test_contract_fixtures.py`).

## Two validation layers

| Layer      | Where                                     | Examples                                                                                     |
| ---------- | ----------------------------------------- | -------------------------------------------------------------------------------------------- |
| Structural | Zod schema = generated JSON Schema        | types, enums, strict objects, id/semver/key patterns, ranges                                 |
| Semantic   | `check*Semantics` / `validate*` functions | unique ids, grapheme bounds, NFC, control chars, references, monotonic tracks, major version |

`validateChartDocument(input)` and `validateRecordingSync(input, { chart })` return
`{ ok, value, issues }` with stable `ValidationIssueCode`s (`SCHEMA_INVALID`, `ANCHOR_OUT_OF_BOUNDS`,
`DUPLICATE_ID`, `TEXT_NOT_NFC`, …). `parse*` variants throw `ContractValidationError`. Non-TS consumers must
re-implement the semantic checks they rely on; the invalid fixtures mark each case `structural` or `semantic`.

## Chart Document v1

- `schemaVersion` is semver. Readers accept any `1.x.y`; a different major is `UNSUPPORTED_SCHEMA_VERSION`.
  Additive optional fields bump the minor version; anything else needs a new major plus a migration.
- All objects are strict (`additionalProperties: false`). Vendor data goes in `extensions` with `x-*` keys.
- Section, line and chord ids share **one** namespace within a chart, so any id (e.g. a voicing override key or a
  RecordingSync reference) resolves unambiguously.
- `anchor.graphemeOffset` indexes extended grapheme clusters of the NFC line text (`Intl.Segmenter`).
  `0` = before the first grapheme; `length` = after the last; `anchor: null` = chord without lyric position.
- Line text must already be NFC and contain no control characters. Importers normalize; the schema does not
  silently rewrite text. Each lyric line is its own entry (explicit line breaks).
- Chord `symbol` is the raw written symbol. The schema rejects only strings that can never be chords
  (empty, whitespace, brackets/markup, > 32 chars). Musical validity belongs to `@chordflow/music-theory` (M2).
- `concertKey` is the **sounding** key and may be `null` (numbering modes then show "unavailable").
- No capo, transpose or display preference is stored in the chart: those are ViewerState / user preferences.
- `voicingPolicy.symbolDefaults` = arrangement-level default voicing per symbol; `occurrenceOverrides` = per chord
  occurrence. Voicing ids are resolved by `@chordflow/guitar-voicings` (M5); unknown ids degrade to recommended.
- `importMetadata.unhandledDirectives` preserves unknown ChordPro directives with their source line (M3).

## RecordingSync v1

- Separate document per (Recording, ChartRevision). Absolute timestamps never enter the chart.
- Timed entries carry `status: high_confidence | uncertain`. Content with no timing is listed under `unaligned`
  instead of receiving invented times. Optional `confidence` is `{ value, model, calibrated }`; `calibrated: false`
  states explicitly that the score is not a probability.
- Lyric ranges are half-open `[fromGrapheme, toGrapheme)` over the line's graphemes.
- Monotonicity is per track (chord starts non-decreasing; lyric starts non-decreasing within one line). Tracks may
  overlap each other, and chord intervals may overlap when starts are ordered.
- `offsetMs` is applied before checking `recordingDurationMs` bounds.

## Catalog domain

`Work` (composition) ≠ `Recording` (performance) ≠ `Arrangement` (playable chart). See `docs/architecture.md`.

- `ArrangementRecordingCompatibility.provenance`: only `exact_audio_match` and `human_verified` count as verified.
  Mappings across different Works are rejected unless `crossWorkReviewed` is true.
- `ChartRevision` is immutable; `checkPublishable(arrangement, revision)` enforces: same arrangement, status
  `published`, document ids consistent with the row, and rights allow the arrangement's visibility.
- Rights are per asset (`lyrics`, `chart`, `audio`). `shared`/`public` visibility requires redistributable lyric and
  chart rights; `unknown` fails closed. Visibility is distinct from redistribution right.
- `SourceReference.permission` + `permittedUses`: analysis requires `analysis_permitted` **and** `audio_analysis`.
  A public video link is `discovery_only`. Source URLs must be `https`, are untrusted and never fetched implicitly.

## Jobs and artifacts

- Internal job states and the transition table live in `jobs.ts`; user-facing status is derived
  (`toExternalJobStatus`) and reports `waiting_for_worker` honestly when no worker heartbeat is recent.
  A draft can never reach `published` without passing `needs_review`.
- Artifact cache key = kind | schema version | processor@version | config hash | input fingerprint.
  `invalidatedBy(node)` walks the dependency graph: a lyrics change invalidates `aligned_lyrics` and
  `fusion_draft` only; a chord model change invalidates `fusion_draft` only.
- Artifact `storagePath` is relative to the artifact store and may not contain `..` or be absolute.

## Fixtures

| Path                                   | Content                                                               |
| -------------------------------------- | --------------------------------------------------------------------- |
| `fixtures/charts/*.chart.json`         | valid synthetic charts (SPEC §4 example, full zh-TW song, English)    |
| `fixtures/charts/invalid/`             | invalid chart cases `{ description, layer, expectedIssue, document }` |
| `fixtures/ai/*.sync.json`              | studio and live RecordingSync for one shared arrangement              |
| `fixtures/ai/invalid/`                 | invalid sync cases (optionally with `chartFixture` context)           |
| `fixtures/contracts/catalog-demo.json` | catalog snapshot seeding the demo repository                          |

All lyrics and titles are invented for this repository.
