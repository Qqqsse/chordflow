# Agent handoff

Durable context for the next session (SPEC §17). Update at the end of every task.

## Status (2026-10-23)

| Milestone                | State                                   | Notes                                              |
| ------------------------ | --------------------------------------- | -------------------------------------------------- |
| M0 foundation            | **done**                                | Monorepo, toolchain, Docker base, CI green (run 1) |
| M1 chart schema & domain | **done — awaiting owner review/freeze** | SPEC gate: freeze before M2–M6 consume it          |
| M2 music theory          | next                                    | `packages/music-theory` (empty)                    |
| M3–M7                    | not started                             |                                                    |

## What exists

- **Workspace:** pnpm 10, Node ≥ 22.12, TypeScript 6.0 strict (`noUncheckedIndexedAccess`), ESLint 9 type-aware
  (`strictTypeChecked`), Prettier, Vitest 5 projects (`apps/*`, `packages/*`), Playwright 1.63 (pinned to the
  Chromium build preinstalled in cloud sessions).
- **apps/web:** Next.js 16.4 App Router, React 19.3, Tailwind 4, `lang="zh-TW"`.
  Routes: `/`, `/demo` (list), `/demo/[arrangementId]` (SSG, validated fixtures), `GET /api/v1/health`.
  `src/lib/api/envelope.ts` = the single `/api/v1` envelope. `src/server/catalog/*` = `CatalogRepository`
  port + validated in-memory adapter (`getDemoCatalog()`).
- **packages/chart-schema:** contracts v1 — see `docs/schema-decisions.md`. JSON Schemas in `json-schema/`
  (regenerate with `pnpm --filter @chordflow/chart-schema generate:json-schema`; a test catches drift).
- **services/ai-worker:** Python ≥ 3.12, pydantic settings, `chordflow-worker check`; pytest validates fixtures
  against the generated JSON Schemas. No job loop yet (M7).
- **Docker:** `compose.yaml` (postgres:17-alpine with volume, loopback web, profile `worker`),
  `deploy/compose.public.yaml` (attach to existing proxy network), Dockerfiles for web (standalone, non-root,
  healthcheck) and worker. `compose.gpu-nvidia.yaml` intentionally deferred to M8.
- **CI** (`.github/workflows/ci.yml`): web (format, lint, typecheck, unit, build, Playwright), worker pytest,
  compose config + image build, gitleaks history scan + `pnpm licenses:check`.

## Commits

| Hash    | Message                                                           |
| ------- | ----------------------------------------------------------------- |
| b43b6c5 | docs: add SPEC and kickoff brief with standard folder layout      |
| 6d6f562 | chore: bootstrap monorepo                                         |
| eeb384a | chore: add docker base                                            |
| 96a92d0 | ci: establish quality gates                                       |
| 1d8e736 | feat(schema): chart v1                                            |
| 7ab0ba2 | test(schema): exhaustive fixture validation                       |
| 20369b8 | feat(web): in-memory catalog repository and validated demo charts |

## Verification (this session, local)

| Command                                                                               | Result                                                                                                        |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                                      | ok                                                                                                            |
| `pnpm format:check`                                                                   | ok                                                                                                            |
| `pnpm lint`                                                                           | ok, 0 warnings                                                                                                |
| `pnpm typecheck`                                                                      | ok                                                                                                            |
| `pnpm test`                                                                           | 11 files, 143 tests passed                                                                                    |
| `pnpm build`                                                                          | ok (/, /demo, 3 SSG demo charts, /api/v1/health)                                                              |
| `CI=1 pnpm exec playwright test`                                                      | 6 passed (Chromium)                                                                                           |
| `(cd services/ai-worker && .venv/bin/python -m pytest)`                               | 42 passed                                                                                                     |
| `pnpm licenses:check`                                                                 | ok (reviewed exception: LGPL `@img/sharp-libvips-*`, dynamically loaded by sharp)                             |
| `docker compose --env-file .env.example config -q` (+ worker profile, public overlay) | ok                                                                                                            |
| gitleaks v8.28.0 on git history                                                       | no leaks                                                                                                      |
| Docker image build + `docker compose up --wait`                                       | ok: db + web healthy, `/api/v1/health` 200, `/demo` served; DB volume survived `down`/`up`; worker `check` ok |

Docker caveats in the cloud sandbox: the daemon is not running by default (started manually with `dockerd`);
builds needed sandbox-only base images that trust the egress proxy CA (passed via the `NODE_IMAGE` /
`PYTHON_IMAGE` build args — the committed Dockerfiles are unchanged); Docker Hub returned 429, so
`postgres:17-alpine` was pulled from `mirror.gcr.io`. CI builds images without these workarounds.

## CI

- Run 3 (`03754f1`, https://github.com/Qqqsse/chordflow/actions/runs/40014177668): all 4 jobs passed
  (web, worker, compose build, security).
- `playwright install --with-deps chromium` takes ~12 min of the ~13 min web job. Worth caching
  `~/.cache/ms-playwright` keyed on the Playwright version, or using the official Playwright container image.

## Decisions worth knowing

- `output: 'standalone'` only when `NEXT_OUTPUT_STANDALONE=1` (set in the Dockerfile) so `next start` works
  locally and in Playwright.
- Demo fixtures are bundled via static JSON imports (`demo-catalog.ts`) — no runtime filesystem reads.
- Section/line/chord ids share one namespace per chart (simplifies sync and override references).
- Chord-symbol musical validity is **not** in the schema; M2's parser owns it (schema blocks only impossible text).
- Job state `needs_review → cancelled` represents draft rejection; the draft revision stays as `rejected`.
- LICENSE: MIT, "Copyright (c) 2026 chordflow contributors" — owner may want to change the holder name.

## Open questions for the owner (non-blocking)

1. Review and freeze the M1 contracts (`docs/schema-decisions.md`) before parallel M2–M6 sessions.
2. Copyright holder line in `LICENSE`.

## Next most valuable work

1. **M2 `packages/music-theory`** (test-first): chord AST parser with typed unsupported errors, key-aware
   spelling, transpose, capo `concertToShape`/`shapeToConcert`, Roman/Nashville; all SPEC §5 table cases plus
   property tests. Consider Tonal.js (MIT) only after a license/version audit.
2. **M3 `packages/chordpro`** (can run in parallel after the M1 freeze).
3. **M4 viewer**: replace the M0 `ChartPreview` with the full segment renderer and controls.
