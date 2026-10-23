# Architecture

See SPEC §2 for the deployment diagram. This file records the implemented structure.

## Packages and dependency direction

```text
apps/web ──► packages/chart-schema        (Zod contracts, JSON Schema, graphemes)
         ──► packages/music-theory  (M2) ──► chart-schema types only
         ──► packages/chordpro      (M3) ──► chart-schema, music-theory
         ──► packages/guitar-voicings (M5) ──► music-theory
services/ai-worker (Python) ──► packages/chart-schema/json-schema/*.json  (files, not TS code)
```

Shared packages export TypeScript source (`exports: ./src/index.ts`) and are compiled by Next.js via
`transpilePackages`; they contain no Next.js, React, database or Python dependencies.

## Domain model

```text
Artist ──credits──► Work ◄──workId── Recording ──sourceReferenceIds──► SourceReference
                     ▲                    ▲
                  workId                  │ ArrangementRecordingCompatibility
                     │                    │ (provenance, recordedKey, transposeSemitones)
                Arrangement ◄─────────────┘
                     │ publishedRevisionId (must be own, published, rights-permitted)
                     ▼
               ChartRevision (immutable, append-only) ── document: ChartDocument v1
                     ▲
                     │ chartRevisionId
               RecordingSync (per Recording × ChartRevision; absolute timing lives only here)
```

## Web app server layers

- `src/lib/api/envelope.ts` — single `/api/v1` response envelope and request ids.
- `src/server/catalog/repository.ts` — `CatalogRepository` read port.
- `src/server/catalog/memory-repository.ts` — validated in-memory adapter (demo mode, tests). Construction
  validates every contract invariant and fails loudly; reads return copies.
- `src/server/catalog/demo-catalog.ts` — bundles the synthetic fixtures (no runtime filesystem access).
- The PostgreSQL adapter (Drizzle) implements the same port in M6.
