# AGENTS.md — rules for coding agents working on chordflow

`SPEC.md` is the binding engineering specification. Read §0, §4, §5, §10, §15, §16 and §17 before editing.
Then read `docs/agent-handoff.md` for current state and the next task.

## Session protocol (SPEC §17)

1. Inspect `git status`, `docs/agent-handoff.md`, package scripts and relevant tests before changing anything.
   Never overwrite a user's uncommitted work.
2. Work on the next uncompleted milestone (SPEC §16), in small focused conventional commits.
3. Test first for schema / theory / parser code; test-backed for UI and API.
4. Before closing a milestone run the CI-equivalent gate (below). If a tool is unavailable, record the exact reason
   in the handoff — never claim a check passed that did not run.
5. Update `docs/agent-handoff.md` with work done, commands + results, commit hashes, blockers and next task.
   Deviations from SPEC are written as explicit proposed ADRs, not silent changes.

## Quality gate

```sh
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright test        # uses Chromium; see docs/testing.md
pnpm licenses:check
(cd services/ai-worker && python -m pytest)
docker compose --env-file .env.example config -q   # Docker CLI only; daemon not required
```

## Hard rules

- No dependency of Next.js, the viewer, music theory, storage schema or core tests on CUDA, Python or model weights.
- Shared packages (`packages/*`) are pure TypeScript: no Next.js, React (except `packages/ui`), DB or Node-only APIs
  unless documented. Python consumes JSON Schema / OpenAPI contracts, never TS internals.
- Contract changes (`chart-schema`, API envelope, worker API) require schema versioning, fixtures and tests.
- No blanket `any`, no mock behaviour in production paths, no fabricated confidence values, no unrelated refactors.
- Never commit secrets, `.env`, credentials, model weights, audio, or copyrighted lyrics/charts. Fixtures are synthetic.
- No unauthorized media downloads (no `yt-dlp` on user URLs). A public URL is not permission to analyse audio.
- No paid API calls (Vertex/OpenAI) in tests or CI. No CUDA installs or model downloads in cloud sessions.
- UI copy defaults to Traditional Chinese (`zh-TW`); identifiers, JSON keys and API paths are English.
- Do not add GPL/AGPL code or dependencies (ChordSheetJS is reference-only). Run `pnpm licenses:check`.
