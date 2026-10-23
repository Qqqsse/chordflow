# chordflow

邊彈邊唱的吉他和弦譜 Web App：移調、移調夾、級數顯示、可切換的指法圖，手機／平板／桌機皆清楚易讀。
本地優先（local-first）、Docker 優先部署；AI 產譜是可選的擴充流程，不是看譜的必要條件。

A local-first, Docker-first guitar sing-along chord-sheet web app. The engineering specification is
[`SPEC.md`](./SPEC.md); current status lives in [`docs/agent-handoff.md`](./docs/agent-handoff.md).

## Repository layout

| Path                       | Purpose                                                     |
| -------------------------- | ----------------------------------------------------------- |
| `apps/web`                 | Next.js App Router app (UI + `/api/v1` BFF)                 |
| `packages/chart-schema`    | Zod schemas, TS types, JSON Schema export (M1)              |
| `packages/music-theory`    | Pure chord parsing / transposition / capo / numbering (M2)  |
| `packages/chordpro`        | Bounded ChordPro importer/exporter (M3)                     |
| `packages/guitar-voicings` | Validated guitar voicings and SVG geometry (M5)             |
| `packages/ui`              | Optional shared presentation components                     |
| `services/ai-worker`       | Python CPU contract runner; GPU adapters later (M7/M8)      |
| `fixtures/`                | Synthetic charts, API contracts and AI timelines            |
| `deploy/`                  | Optional Compose overlays (GPU, public reverse proxy)       |
| `docs/`                    | Architecture, contracts, deployment, testing, agent handoff |

## Quick start (development)

Requirements: Node.js ≥ 22.12, pnpm 10 (`corepack enable`), Python ≥ 3.12 for the worker.

```sh
pnpm install
pnpm dev                            # http://localhost:3000 — /demo works without DB or GPU
pnpm test                            # unit tests (Vitest)
pnpm build && pnpm exec playwright test
```

Worker:

```sh
cd services/ai-worker
python -m venv .venv && . .venv/bin/activate
pip install -e '.[dev]' && python -m pytest
```

## Docker Compose (local, private)

```sh
cp .env.example .env      # then replace every placeholder secret
docker compose up -d --build
```

See [`docs/local-deployment.md`](./docs/local-deployment.md) for profiles, backups and the destructive
`docker compose down -v` warning.

## License

Software: MIT (see [`LICENSE`](./LICENSE)). The software license grants **no** rights to third-party songs,
recordings, lyrics or chord charts; content rights are tracked per asset.
