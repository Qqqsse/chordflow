# Agent 交接文件

給下一個 session 的持久上下文（SPEC §17）。每個任務結束時更新。

## 進度（2026-10-24）

| Milestone                   | 狀態                                       | 說明                                               |
| --------------------------- | ------------------------------------------ | -------------------------------------------------- |
| M0 基礎建設                 | **完成**                                   | Monorepo、工具鏈、Docker 基礎、CI 綠燈             |
| M1 和弦譜 schema 與領域模型 | **完成、已凍結**（擁有者 2026-10-24 確認） | 變更需版本號、fixtures、測試                       |
| M2 樂理                     | **完成**                                   | `packages/music-theory`，見 `docs/music-theory.md` |
| M3 ChordPro                 | 下一個                                     | `packages/chordpro`（尚空）                        |
| M4–M7                       | 尚未開始                                   |                                                    |

## 目前已有的內容

- **Workspace：** pnpm 10、Node ≥ 22.12、TypeScript 6.0 strict（`noUncheckedIndexedAccess`）、ESLint 9
  含型別檢查（`strictTypeChecked`）、Prettier、Vitest 5 projects（`apps/*`、`packages/*`）、Playwright 1.63
  （鎖定為雲端 session 預裝 Chromium 對應的版本）。
- **apps/web：** Next.js 16.4 App Router、React 19.3、Tailwind 4、`lang="zh-TW"`。
  路由：`/`、`/demo`（列表）、`/demo/[arrangementId]`（SSG，使用驗證後的 fixtures）、`GET /api/v1/health`。
  `src/lib/api/envelope.ts` = 唯一的 `/api/v1` envelope。`src/server/catalog/*` = `CatalogRepository`
  介面 + 經驗證的記憶體實作（`getDemoCatalog()`）。
- **packages/chart-schema：** v1 契約——見 `docs/schema-decisions.md`。JSON Schema 在 `json-schema/`
  （用 `pnpm --filter @chordflow/chart-schema generate:json-schema` 重新產生；有測試偵測不一致）。
- **packages/music-theory：** 和弦 parser（型別化錯誤）、依調拼寫、移調、移調夾、羅馬數字／Nashville、
  `transposeChartDisplay` 整譜顯示轉換、`changeCapo` 兩種模式。無執行期相依（未使用 Tonal.js）。
- **fixtures：** 新增公有領域歌曲〈送別〉與〈Amazing Grace〉（和弦自編），來源與權利見 `fixtures/README.md`。
- **services/ai-worker：** Python ≥ 3.12、pydantic 設定、`chordflow-worker check`；pytest 以產生的 JSON Schema
  驗證 fixtures。尚無工作迴圈（M7）。
- **Docker：** `compose.yaml`（postgres:17-alpine 含 volume、web 只綁 loopback、profile `worker`），
  `deploy/compose.public.yaml`（接入既有代理網路），web（standalone、非 root、healthcheck）與 worker 的
  Dockerfile。`compose.gpu-nvidia.yaml` 刻意延到 M8。
- **CI**（`.github/workflows/ci.yml`）：web（格式、lint、型別檢查、單元測試、建置、Playwright）、worker pytest、
  compose 設定 + 映像建置、gitleaks 歷史掃描 + `pnpm licenses:check`。

## Commits

| Hash    | 訊息                                                              |
| ------- | ----------------------------------------------------------------- |
| b43b6c5 | docs: add SPEC and kickoff brief with standard folder layout      |
| 6d6f562 | chore: bootstrap monorepo                                         |
| eeb384a | chore: add docker base                                            |
| 96a92d0 | ci: establish quality gates                                       |
| 1d8e736 | feat(schema): chart v1                                            |
| 7ab0ba2 | test(schema): exhaustive fixture validation                       |
| 20369b8 | feat(web): in-memory catalog repository and validated demo charts |
| 03754f1 | docs: architecture overview and agent handoff for M0–M1           |
| 3836414 | docs(handoff): record green CI for M0–M1                          |
| 2b4334d | docs: switch project docs to Traditional Chinese                  |
| a368f8f | test(fixtures): add public-domain songs 送別 and Amazing Grace    |
| 42a3a6d | feat(theory): spelled pitches, keys and chord parser              |
| f9f2410 | feat(theory): key-aware transposition and capo semantics          |
| 787f7de | feat(theory): roman numeral and nashville number rendering        |
| 5efe366 | feat(theory): pure chart display transformation and capo modes    |

## 驗證結果（本 session，本機）

| 指令                                                                              | 結果                                                                                                                   |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                                  | 通過                                                                                                                   |
| `pnpm format:check`                                                               | 通過                                                                                                                   |
| `pnpm lint`                                                                       | 通過，0 個警告                                                                                                         |
| `pnpm typecheck`                                                                  | 通過                                                                                                                   |
| `pnpm test`                                                                       | 11 個檔案、143 個測試通過                                                                                              |
| `pnpm build`                                                                      | 通過（/、/demo、3 個 SSG 示範譜、/api/v1/health）                                                                      |
| `CI=1 pnpm exec playwright test`                                                  | 6 個通過（Chromium）                                                                                                   |
| `(cd services/ai-worker && .venv/bin/python -m pytest)`                           | 42 個通過                                                                                                              |
| `pnpm licenses:check`                                                             | 通過（已審查例外：LGPL 的 `@img/sharp-libvips-*`，由 sharp 動態載入）                                                  |
| `docker compose --env-file .env.example config -q`（含 worker profile、公開疊加） | 通過                                                                                                                   |
| gitleaks v8.28.0 掃描 git 歷史                                                    | 無洩漏                                                                                                                 |
| Docker 映像建置 + `docker compose up --wait`                                      | 通過：db 與 web healthy、`/api/v1/health` 200、`/demo` 正常；DB volume 經 `down`／`up` 後資料仍在；worker `check` 通過 |

雲端沙盒中的 Docker 注意事項：daemon 預設沒有啟動（手動執行 `dockerd`）；建置時改用信任出口代理 CA 的
沙盒專用基底映像（透過 `NODE_IMAGE`／`PYTHON_IMAGE` build arg 傳入——repo 內的 Dockerfile 未修改）；
Docker Hub 回傳 429，因此 `postgres:17-alpine` 改從 `mirror.gcr.io` 拉取。CI 不需要這些變通即可建置映像。

## CI

- Run 3（`03754f1`，https://github.com/Qqqsse/chordflow/actions/runs/40014177668）：4 個 job 全部通過
  （web、worker、compose build、security）。
- `playwright install --with-deps chromium` 佔了 web job 約 13 分鐘中的約 12 分鐘。可考慮以 Playwright 版本為 key
  快取 `~/.cache/ms-playwright`，或改用官方 Playwright 容器映像。

## 值得知道的決策

- 只有在 `NEXT_OUTPUT_STANDALONE=1`（Dockerfile 中設定）時才使用 `output: 'standalone'`，
  讓本機與 Playwright 能直接用 `next start`。
- 示範 fixtures 透過靜態 JSON import 打包（`demo-catalog.ts`）——執行時不讀檔案系統。
- 同一份譜中 section／line／chord 的 id 共用一個命名空間（簡化 sync 與覆寫的引用）。
- 和弦名稱在音樂上是否合法**不**由 schema 判斷；由 M2 的 parser 負責（schema 只擋掉不可能的文字）。
- 任務狀態 `needs_review → cancelled` 代表草稿被退回；草稿修訂版本本身保留為 `rejected`。
- LICENSE：MIT，「Copyright (c) 2026 chordflow contributors」——擁有者可能想改成自己的名字。
- 文件以繁體中文為主（擁有者要求）；`SPEC.md` 與 `docs/claude-code-kickoff.md` 為擁有者提供的原始文件，
  保持原樣。程式碼註解、識別字、JSON key 與 API 路徑維持英文。

## 待擁有者決定（不阻擋進度）

1. `LICENSE` 中的著作權人名稱。

## 下一個最有價值的工作

1. **M3 `packages/chordpro`**：自訂 ChordPro 子集匯入／匯出、錯誤含行號、保留未知指令、語意往返測試。
2. **M4 看譜器**：以 `transposeChartDisplay` 驅動移調／移調夾／級數控制，取代 M0 的 `ChartPreview`。
3. **M5 指法與 SVG**：之後才能做以指法難度為依據的移調夾建議。
