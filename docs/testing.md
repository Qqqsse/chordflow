# Testing

All suites run without network access to paid APIs, without GPU and without model weights.

| Layer               | Command                                         | Notes                                                |
| ------------------- | ----------------------------------------------- | ---------------------------------------------------- |
| Format              | `pnpm format:check`                             | Prettier; `SPEC.md` and operator docs are excluded   |
| Lint                | `pnpm lint`                                     | ESLint 9 flat config, type-aware `typescript-eslint` |
| Typecheck           | `pnpm typecheck`                                | Root configs + every workspace `typecheck` script    |
| Unit (TS)           | `pnpm test`                                     | Vitest projects: `apps/*`, `packages/*`              |
| Build               | `pnpm build`                                    | Next.js production build                             |
| Browser (E2E)       | `pnpm exec playwright test`                     | Starts `next start` in demo mode on port 3100        |
| Python worker       | `cd services/ai-worker && python -m pytest`     | CPU only                                             |
| Dependency licenses | `pnpm licenses:check`                           | Allowlist + reviewed exceptions in `scripts/`        |
| Compose config      | `docker compose --env-file .env.example config` | Docker CLI only; no daemon needed                    |
| Secret scanning     | CI (`gitleaks`)                                 | See `.github/workflows/ci.yml`                       |

## Playwright browsers

`@playwright/test` is pinned to the version whose Chromium build is pre-installed in Claude Code cloud
sessions (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Elsewhere install the browser once:

```sh
pnpm exec playwright install --with-deps chromium
```

E2E runs against a production build, so run `pnpm build` first. Set `E2E_PORT` to change the port.

## Python worker

```sh
cd services/ai-worker
python -m venv .venv
.venv/bin/pip install -e '.[dev]'
.venv/bin/python -m pytest
```
