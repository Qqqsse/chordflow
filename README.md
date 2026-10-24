# chordflow

邊彈邊唱的吉他和弦譜 Web App：移調、移調夾、級數顯示、可切換的指法圖，手機／平板／桌機皆清楚易讀。
本地優先（local-first）、Docker 優先部署；AI 產譜是可選的擴充流程，不是看譜的必要條件。

工程規格見 [`SPEC.md`](./SPEC.md)；目前進度見 [`docs/agent-handoff.md`](./docs/agent-handoff.md)。

> English summary: a local-first, Docker-first guitar sing-along chord-sheet web app. `SPEC.md` is the
> engineering specification; code identifiers, JSON keys and API paths are in English.

## 目錄結構

| 路徑                       | 用途                                                  |
| -------------------------- | ----------------------------------------------------- |
| `apps/web`                 | Next.js App Router 應用（UI 與 `/api/v1` BFF）        |
| `packages/chart-schema`    | Zod schema、TS 型別、JSON Schema 匯出（M1）           |
| `packages/music-theory`    | 純函式和弦解析／移調／移調夾／級數（M2）              |
| `packages/chordpro`        | 有界限的 ChordPro 匯入／匯出（M3）                    |
| `packages/guitar-voicings` | 經驗證的吉他指法與 SVG 幾何（M5）                     |
| `packages/ui`              | 選用的共用呈現元件                                    |
| `services/ai-worker`       | Python CPU 契約執行器；GPU adapter 之後再加（M7／M8） |
| `fixtures/`                | 合成（虛構）的和弦譜、API 契約與 AI 時間軸測試資料    |
| `deploy/`                  | 選用的 Compose 疊加設定（GPU、公開反向代理）          |
| `docs/`                    | 架構、契約、部署、測試、Agent 交接文件                |

## 快速開始（開發）

需求：Node.js ≥ 22.12、pnpm 10（`corepack enable`）、worker 需 Python ≥ 3.12。

```sh
pnpm install
pnpm dev                             # http://localhost:3000 — /demo 不需資料庫或 GPU
pnpm test                            # 單元測試（Vitest）
pnpm build && pnpm exec playwright test
```

Worker：

```sh
cd services/ai-worker
python -m venv .venv && . .venv/bin/activate
pip install -e '.[dev]' && python -m pytest
```

## Docker Compose（本機、私人使用）

```sh
cp .env.example .env      # 接著把每個佔位用的密碼／密鑰換掉
docker compose up -d --build
```

profiles、備份，以及具破壞性的 `docker compose down -v` 警告，請見
[`docs/local-deployment.md`](./docs/local-deployment.md)。

## 授權

軟體：MIT（見 [`LICENSE`](./LICENSE)）。軟體授權**不**包含任何第三方歌曲、錄音、歌詞或和弦譜的權利；
內容權利依每項素材個別記錄。
