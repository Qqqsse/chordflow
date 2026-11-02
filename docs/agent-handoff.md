# Agent 交接文件

給下一個 session 的持久上下文（SPEC §17）。每個任務結束時更新。
接手前請先讀 `docs/agent-onboarding.md`（全貌、怎麼跑、踩過的坑、下一步）。

## 進行中的工作（每項開始前更新；接手時先看這裡）

> 規則：每開始一項工作，先在這裡把狀態改成「進行中」並寫下計畫，commit 並推送到
> session 使用的功能分支（雲端時期是 `claude/beautiful-maxwell-h4wqaz`），再寫程式。完成並合併到 `main` 後改成「完成」。
> 若 session 中斷：切到該分支，`git log origin/main..HEAD` 看已提交的部分，依下表「接手方式」繼續。
>
> **目前狀態（2026-11-02）：雲端額度已用完，之後全部在擁有者的本機開發**（Windows 11、RTX 5090、Docker Desktop；
> Python／Node 使用專屬 conda 環境 `chordflow`，不使用 base，見 `docs/agent-onboarding.md` §6）。
> 擁有者已接受 ADR-002、ADR-003，並決定音訊上傳規則（`docs/audio-sources.md`「擁有者決定」）。
> 本機基準品質閘門已通過（PR #8）。M8-1 音訊上傳已合併（PR #9）。
> **進行中：M8-2**，worker 以 `GET /worker/jobs/{id}/audio` 取得上傳的音訊（分支 `claude/m8-2-worker-audio`）。

| #   | 工作                                         | 狀態                                     | 計畫與接手方式                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | -------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | M7 補完：使用者重試失敗任務、worker 狀態面板 | **完成**（PR #3 已合併，`a535525`）      | 重試＝新任務（`retry_of_job_id`，migration 0005），原任務不變；`POST /generation-jobs/{id}/retry`、`GET /workers`；API 1.2.0                                                                                                                                                                                                                                                                                                                                                                           |
| 2   | M9：審查差異比對                             | **完成**（PR #4 已合併，`1363c4d`）      | `diffCharts`（`packages/chart-schema/src/chart-diff.ts`）依 id 或內容（LCS）對齊段落與行，和弦依位置再依名稱比對；`/admin/jobs/[id]` 顯示最新衍生修訂與草稿的差異（`review-diff.tsx`、`diff-labels.ts`）                                                                                                                                                                                                                                                                                               |
| 3   | M9：權利稽核紀錄                             | **完成**（PR #5 已合併，`c67127c`）      | `arrangement_audit_events`（migration 0006，觸發器禁止修改／刪除，只允許刪帳號時把操作者設為 NULL）；`editor.ts` 三個寫入函式在同一交易記錄並明確帶入操作者；`GET /arrangements/{id}/audit`、`/admin/arrangements/[id]/audit`；API 1.3.0。另：`AUTH_SIGN_IN_PER_MINUTE`（預設 10）讓 e2e 可調高登入限速                                                                                                                                                                                                |
| 4   | M9：和弦位置／段落編輯器                     | **完成**（PR #6 已合併，`73d309d`）      | `apps/web/src/components/editor/`：純 reducer `editor-state.ts`（移動／新增／改名／刪除和弦、段落類型與名稱；無效輸入不改變譜）與 `chart-editor.tsx`；`/admin/arrangements/[id]/edit`；儲存為新修訂並可發布                                                                                                                                                                                                                                                                                            |
| 5   | M8 雲端準備                                  | **完成**（PR #6 已合併，`73d309d`）      | 設計文件 `docs/audio-sources.md`（ADR-003，擁有者 2026-11-02 接受）：SourceProvider、使用者上傳與權利聲明、檔案檢查、worker 以 `GET /worker/jobs/{id}/audio` 取得音訊、保留與刪除                                                                                                                                                                                                                                                                                                                      |
| 6   | 本機環境與基準品質閘門（Windows）            | **完成**（PR #8 已合併，`a917d51`）      | conda 環境 `chordflow`（Python 3.12、Node 22、corepack 的 pnpm 10.28）；`pnpm install --frozen-lockfile` 後依 AGENTS.md 跑品質閘門，Windows 特有的問題記在 onboarding §7                                                                                                                                                                                                                                                                                                                               |
| 7   | M8-1：音訊上傳 API、權利聲明、檔案儲存       | **完成**（PR #9 已合併，`c85741c`）      | migration 0007：`audio_uploads`、只能新增的 `audio_rights_declarations`、`audio_upload_blocks`；`/api/v1/audio-uploads`（GET、multipart POST、DELETE）與管理員的 `/audio-upload-blocks/{id}`；依檔頭判斷格式、串流寫入並算 SHA-256、配額與限速；撤回或到期時撤銷來源、取消還需要它的任務（`SOURCE_NOT_AUTHORIZED`）並刪檔；web 啟動時與每 6 小時清理；`/uploads`、`/terms`；API 1.4.0。細節見 `docs/audio-sources.md`「實作（M8-1）」                                                                  |
| 8   | M8-2：worker 取得上傳的音訊                  | **進行中**（`claude/m8-2-worker-audio`） | 計畫：契約 1.1.0 新增 `GET /worker/jobs/{id}/audio`（worker token＋`x-worker-id`／`x-lease-token`，串流回傳並附 `x-content-sha256`、`x-audio-format`、`x-audio-max-duration-seconds`；租約不符 409、沒有可用音訊 404 `AUDIO_NOT_AVAILABLE`）；worker 下載到暫存、驗證摘要，WAV 以標準庫檢查長度（`AUDIO_TOO_LONG`／`AUDIO_INVALID`），用完即刪；CPU mock 不做辨識，誠實回報 `MODEL_UNAVAILABLE`。「用這份音訊產生草稿」按鈕延到 M8-3（避免一定失敗的按鈕）。接手：看該分支 `git log origin/main..HEAD` |

## 進度（2026-11-02）

| Milestone                       | 狀態                                       | 說明                                                                                                         |
| ------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| M0 基礎建設                     | **完成**                                   | Monorepo、工具鏈、Docker 基礎、CI 綠燈                                                                       |
| M1 和弦譜 schema 與領域模型     | **完成、已凍結**（擁有者 2026-10-24 確認） | 變更需版本號、fixtures、測試                                                                                 |
| M2 樂理                         | **完成**                                   | `packages/music-theory`，見 `docs/music-theory.md`                                                           |
| M3 ChordPro                     | **完成**                                   | `packages/chordpro`，見 `docs/chordpro.md`；API 路由待 M6（需身分驗證）                                      |
| M4 看譜器                       | **完成**                                   | 見 `docs/viewer.md`（含 ADR-001，已接受）                                                                    |
| M5 指法／播放模式／PWA          | **完成**                                   | 見 `docs/offline-and-voicings.md`                                                                            |
| M6 PostgreSQL／搜尋／帳號／修訂 | **完成**（含個人譜庫與 CSP）               | 見 `docs/api-contract.md`、`docs/security-and-rights.md`                                                     |
| M7 生成任務與 CPU mock worker   | **完成**                                   | 見 `docs/generation-jobs.md`                                                                                 |
| M8 本機 GPU 推論                | **M8-1 完成**；M8-2、M8-3 未開始           | 全部在擁有者本機進行；見 `docs/audio-sources.md`                                                             |
| M9 審查與發布改進               | **部分完成**                               | 已完成：審查差異比對、權利稽核紀錄、和弦／段落編輯器。尚餘：同步時間軸看譜、LLM 結構化建議、指法轉換排序改進 |

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
- **packages/chordpro：** ChordPro 子集匯入（預覽、行號錯誤、保留未知指令、capo 解讀必須明確選擇）與匯出
  （明確段落標記、跳脫、刻意遺失的資訊已列出）。
- **看譜器（apps/web `components/viewer`）：** 和弦區塊排版、移調／移調夾（兩種模式）／按法或實際音／
  羅馬級數與 Nashville／字級、快捷鍵；`/demo/[arrangementId]` 使用。
- **packages/guitar-voicings：** 指法驗證、精選與可移動指法庫、推薦排序、選擇順序、指法圖幾何。
- **播放模式與離線：** 連續自動捲動（尊重減少動態）、分頁模式、IndexedDB 離線儲存、`/offline` 譜庫、service worker、manifest。
- **資料庫與 API（M6）：** Drizzle schema／migrations（含不可變修訂等觸發器）、PostgreSQL repository 與搜尋、
  `/api/v1` 讀取與寫入路由、OpenAPI、伺服器端存取規則、better-auth 邀請制帳號（Argon2id）、
  ChordPro 匯入與交易式發布、`/search`、`/charts/[id]`、`/login`、`/invite`、`/admin`、`/admin/import`。
- **fixtures：** 新增公有領域歌曲〈送別〉與〈Amazing Grace〉（和弦自編），來源與權利見 `fixtures/README.md`。
- **生成任務（M7）：** migration `0003`（任務、轉換紀錄、artifact manifest、worker 在線狀態；觸發器照抄 TS 狀態機）、
  `src/server/jobs/*` 協調器（權利檢查、冪等 key、相同請求去重、配額、租約、退避重試、交易式完成、審查）、
  `/api/v1/generation-jobs*` 與 `/api/v1/worker/jobs/*`（`WORKER_TOKEN` bearer，可輪替）、
  `/admin/generate`（送出與即時狀態）與 `/admin/jobs/[id]`（草稿審查：標記、建議、修改後發布、退回）。
- **services/ai-worker：** Pydantic 契約（與 OpenAPI／fixtures 比對）、stdlib HTTP client、工作迴圈
  （`run`／`--once`／`--drain`）、八階段 CPU mock 流程、測試用假審查器、本機 artifact store。只依賴 pydantic。
- **Docker：** `compose.yaml`（postgres:17-alpine 含 volume、web 只綁 loopback、profile `worker`），
  `deploy/compose.public.yaml`（接入既有代理網路），web（standalone、非 root、healthcheck）與 worker 的
  Dockerfile。`compose.gpu-nvidia.yaml` 刻意延到 M8。
- **CI**（`.github/workflows/ci.yml`）：web（格式、lint、型別檢查、單元測試、建置、Playwright）、worker pytest、
  compose 設定 + 映像建置、gitleaks 歷史掃描 + `pnpm licenses:check`。

## Commits

| Hash    | 訊息                                                                       |
| ------- | -------------------------------------------------------------------------- |
| b43b6c5 | docs: add SPEC and kickoff brief with standard folder layout               |
| 6d6f562 | chore: bootstrap monorepo                                                  |
| eeb384a | chore: add docker base                                                     |
| 96a92d0 | ci: establish quality gates                                                |
| 1d8e736 | feat(schema): chart v1                                                     |
| 7ab0ba2 | test(schema): exhaustive fixture validation                                |
| 20369b8 | feat(web): in-memory catalog repository and validated demo charts          |
| 03754f1 | docs: architecture overview and agent handoff for M0–M1                    |
| 3836414 | docs(handoff): record green CI for M0–M1                                   |
| 2b4334d | docs: switch project docs to Traditional Chinese                           |
| a368f8f | test(fixtures): add public-domain songs 送別 and Amazing Grace             |
| 42a3a6d | feat(theory): spelled pitches, keys and chord parser                       |
| f9f2410 | feat(theory): key-aware transposition and capo semantics                   |
| 787f7de | feat(theory): roman numeral and nashville number rendering                 |
| 5efe366 | feat(theory): pure chart display transformation and capo modes             |
| 7e0bcc0 | docs(handoff): record M2 completion and M1 freeze                          |
| 03374d4 | feat(chordpro): bounded ChordPro importer                                  |
| 155f51d | feat(chordpro): readable exporter with semantic round trip                 |
| 59b39ae | docs(chordpro): supported subset, capo choice and export losses            |
| 98bbdbd | test(chordpro): keep the CRLF fixture byte-exact                           |
| d08b4aa | docs(handoff): record M3 completion                                        |
| 667b27e | feat(viewer): chord sheet layout core and viewer controls                  |
| 6b3f22e | test(viewer): interaction and layout geometry e2e                          |
| 88a959e | docs(handoff): record M4 completion                                        |
| 2ca4421 | feat(voicings): validated guitar voicings and deterministic recommendation |
| e2d9b08 | feat(voicings): pure chord diagram geometry                                |
| ecdf091 | feat(viewer): SVG chord diagrams with a per-viewer voicing chooser         |
| 5e34bd7 | feat(viewer): continuous autoscroll and paged reading mode                 |
| d548a8c | feat(pwa): explicit offline save with IndexedDB and a service worker       |
| 6c7824c | docs(handoff): record M5 completion                                        |
| 0add746 | feat(db): PostgreSQL catalog schema, migrations and repository adapter     |
| 8121699 | feat(api): catalog read API with OpenAPI contract and access rules         |
| 70fd330 | feat(search): search page, catalog chart pages and home search             |
| 3fce5ee | feat(auth): invitation-only accounts with better-auth and Argon2id         |
| 8e2b4fd | test(e2e): database-mode account flows                                     |
| eaaadb3 | feat(revisions): draft revisions, transactional publish and write API      |
| 3dea180 | feat(admin): ChordPro import, preview and publish UI                       |
| 4f7ddb3 | docs(handoff): record M6 completion; fix CI postgres health check          |
| 84515e4 | feat(contracts): generation job and worker API contract v1                 |
| 4e74005 | feat(jobs): durable generation jobs, leases and worker API                 |
| 8de4c3f | feat(worker): Python worker client, mock processor chain and fake reviewer |
| 703b4e5 | fix(auth): allow normal browsing under the auth rate limit                 |
| 0909687 | feat(admin): generate demo chart, live job status and draft review UI      |
| ce02303 | ci(security): allowlist synthetic worker lease tokens for gitleaks         |
| 67a999a | docs: generation jobs and worker guide; record M7 in handoff               |
| c1a5d0c | docs: agent onboarding guide; add local secret scan to the quality gate    |
| 5b45b6f | chore: set copyright holder, accept ADR-001, document main branch flow     |
| 0408581 | Merge pull request #1（`main` 首次合併）                                   |
| b87196f | feat(library): favorites, recent charts and saved viewer preferences API   |
| 4cc48d9 | feat(library): favorite toggle, saved viewer settings and library page     |
| 388d218 | feat(security): same-origin Content-Security-Policy                        |

## 驗證結果（2026-11-02，M8-1 音訊上傳，Windows 本機）

| 指令                                                                  | 結果                                                                                                           |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`、`pnpm lint`、`pnpm typecheck`                    | 通過，lint 0 個警告                                                                                            |
| `TEST_DATABASE_URL=… pnpm test`                                       | 46 個檔案、815 個測試通過（新增：上傳契約、設定、檔頭判斷、保留期限、標籤，以及 8 個 PostgreSQL 上傳整合測試） |
| `pnpm build`                                                          | 通過，沒有警告（曾因動態 `path.resolve` 觸發「追蹤整個專案」警告，已移除）                                     |
| `TEST_DATABASE_URL=… WORKER_PYTHON=… CI=1 pnpm exec playwright test`  | 56 個通過（demo 38、資料庫模式 18，新增 3 個上傳流程）                                                         |
| `python -m pytest`（`services/ai-worker`）                            | 95 個通過（worker 未改動）                                                                                     |
| `pnpm licenses:check`                                                 | 通過                                                                                                           |
| `docker compose … config -q`（預設、worker＋tools profile、公開疊加） | 通過（web 新增 `audio-uploads` volume 與上傳設定）                                                             |
| web Docker 映像建置                                                   | 本機未執行；PR #9 的 CI compose job 建置通過                                                                   |

## 驗證結果（2026-11-02，擁有者的 Windows 本機基準）

環境：conda 環境 `chordflow`（Python 3.12.16、Node 22.23.4、corepack 的 pnpm 10.28.0）、Docker Desktop 29.9.2。

| 指令                                                                  | 結果                                                                                         |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                      | 通過                                                                                         |
| `pnpm format:check`、`pnpm lint`、`pnpm typecheck`                    | 通過，lint 0 個警告                                                                          |
| `TEST_DATABASE_URL=… pnpm test`                                       | 41 個檔案、763 個測試通過（含 57 個 PostgreSQL 整合測試）；修正 migration 路徑前整合測試失敗 |
| `pnpm build`                                                          | 通過                                                                                         |
| `TEST_DATABASE_URL=… WORKER_PYTHON=… CI=1 pnpm exec playwright test`  | 53 個通過（demo 38、資料庫模式 15，其中一個啟動真正的 Python worker）                        |
| `python -m pytest`（`services/ai-worker`）                            | 95 個通過                                                                                    |
| `pnpm licenses:check`                                                 | 402 個套件通過（修正 pnpm 呼叫方式，並新增 Windows 版 sharp 的已審查例外）                   |
| `pnpm secrets:check`                                                  | 63 個 commit 無洩漏                                                                          |
| `docker compose … config -q`（預設、worker＋tools profile、公開疊加） | 通過（公開疊加需設定 `PROXY_NETWORK`）                                                       |

## 驗證結果（雲端 session，M7 後）

| 指令                                                                              | 結果                                                                                                                                          |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                                  | 通過                                                                                                                                          |
| `pnpm format:check`                                                               | 通過                                                                                                                                          |
| `pnpm lint`                                                                       | 通過，0 個警告                                                                                                                                |
| `pnpm typecheck`                                                                  | 通過                                                                                                                                          |
| `TEST_DATABASE_URL=… pnpm test`                                                   | 37 個檔案、730 個測試通過（含 53 個 PostgreSQL 整合測試；個人譜庫與 CSP 後）                                                                  |
| `pnpm build`                                                                      | 通過（/、/demo、3 個 SSG 示範譜、/api/v1/health）                                                                                             |
| `TEST_DATABASE_URL=… CI=1 pnpm exec playwright test`                              | 50 個通過（demo 38 + 資料庫模式 12，其中一個啟動真正的 Python worker）                                                                        |
| `(cd services/ai-worker && .venv/bin/python -m pytest)`                           | 95 個通過（M7 後）                                                                                                                            |
| `pnpm licenses:check`                                                             | 通過（已審查例外：LGPL 的 `@img/sharp-libvips-*`，由 sharp 動態載入）                                                                         |
| `docker compose --env-file .env.example config -q`（含 worker profile、公開疊加） | 通過                                                                                                                                          |
| gitleaks v8.28.0 掃描 git 歷史（含 `.gitleaks.toml`）                             | 44 個 commit 無洩漏；另以刻意放入的假金鑰確認 allowlist 不會放過其他秘密                                                                      |
| Docker 映像建置 + `docker compose up --wait`                                      | 通過：db 與 web healthy、`/api/v1/health` 200、`/demo` 正常；DB volume 經 `down`／`up` 後資料仍在；worker `check` 通過                        |
| M7 Docker smoke（獨立 compose project、資料庫模式、migrate、admin、worker 容器）  | 通過：送出 → worker 容器處理 → `needs_review`（4 個 artifact、信心值 null）→ 發布；停掉 worker 時顯示 `waiting_for_worker`，重啟後 5 秒內完成 |

雲端沙盒中的 Docker 注意事項：daemon 預設沒有啟動（手動執行 `dockerd`）；建置時改用信任出口代理 CA 的
沙盒專用基底映像（透過 `NODE_IMAGE`／`PYTHON_IMAGE` build arg 傳入——repo 內的 Dockerfile 未修改）；
Docker Hub 回傳 429，因此 `postgres:17-alpine` 改從 `mirror.gcr.io` 拉取。CI 不需要這些變通即可建置映像。

## CI

- Run 18–20（`4e74005`、`8de4c3f`、`0909687`）：web、worker、compose 三個 job 通過，**security job 失敗**——
  gitleaks 的 generic-api-key 規則把 worker fixtures 中合成的 `lease_<32 hex>` 判成金鑰（10 筆，全是誤判）。
  `ce02303` 加入只針對租約 token 格式的 `.gitleaks.toml`；**Run 21（`67a999a`）四個 job 全部通過**。
  根本原因是推送前沒在本機跑 secret 掃描；已新增 `pnpm secrets:check`（與 CI 相同的 gitleaks 掃描）並列入品質閘門。

- Run 14（`70fd330`）因 `apps/web/e2e/search.spec.ts` 未格式化而在 `format:check` 失敗；下一個 commit 已修正，Run 15 綠燈。
  教訓：提交前一定跑 `pnpm format:check`，且不要用 `pnpm -s` 檢查 typecheck（會吞掉子專案錯誤輸出；請看 exit code）。

- Run 3（`03754f1`，https://github.com/Qqqsse/chordflow/actions/runs/40014177668）：4 個 job 全部通過
  （web、worker、compose build、security）。
- `playwright install --with-deps chromium` 早期佔了 web job 約 12 分鐘；近期 run（例如 run 21）只需約 25 秒，
  因此不再加快取。

## 值得知道的決策

- 只有在 `NEXT_OUTPUT_STANDALONE=1`（Dockerfile 中設定）時才使用 `output: 'standalone'`，
  讓本機與 Playwright 能直接用 `next start`。
- 示範 fixtures 透過靜態 JSON import 打包（`demo-catalog.ts`）——執行時不讀檔案系統。
- 同一份譜中 section／line／chord 的 id 共用一個命名空間（簡化 sync 與覆寫的引用）。
- 和弦名稱在音樂上是否合法**不**由 schema 判斷；由 M2 的 parser 負責（schema 只擋掉不可能的文字）。
- 任務狀態 `needs_review → cancelled` 代表草稿被退回；草稿修訂版本本身保留為 `rejected`。
- AI 草稿修訂直接以 `needs_review` 狀態建立（`createRevision` 的 `initialStatus`）；人工修訂仍從 `draft` 開始。
- 審查時可發布草稿本身或由它衍生（`parentRevisionId` 鏈）的修訂；衍生修訂發布後，AI 草稿保留為 `needs_review` 歷史。
- Python 標準庫沒有 UAX #29 字形切分；worker 只在整行每個字形群集都是單一碼位時才放行中和弦，
  其他情況只放行首並標記 `unaligned`（伺服器端仍會以 `Intl.Segmenter` 完整驗證）。
- better-auth 一般端點限速由每分鐘 20 次調為 300 次（每次瀏覽都會讀 session，原設定會讓使用者看起來被登出）；
  密碼登入維持每分鐘 10 次。
- LICENSE：MIT，「Copyright (c) 2026 Chen-Wei, Liu」（擁有者 2026-10-24 指定）。
- ADR-001 已由擁有者接受（2026-10-24）。
- `main` 於 2026-10-24 由 `c1a5d0c` 建立為穩定分支；之後經 PR 合併（PR #1 已合併，`0408581`）。
  免費方案不強制分支保護，規則寫在 `AGENTS.md`。
- 個人譜庫：看譜設定只在登入時於瀏覽器端讀寫（伺服器渲染的 HTML 不含個人資料）；載入完成前讀者已調整的設定不會被覆蓋；
  儲存的資料不符合契約時忽略（回到預設），不猜測。
- CSP 允許 inline script／style，理由與緩解見 ADR-002（擁有者 2026-11-02 接受，`docs/security-and-rights.md`）。
- 文件以繁體中文為主（擁有者要求）；`SPEC.md` 與 `docs/claude-code-kickoff.md` 為擁有者提供的原始文件，
  保持原樣。程式碼註解、識別字、JSON key 與 API 路徑維持英文。
- **擁有者決定（2026-11-02）**：
  - 接受 ADR-002（CSP）與 ADR-003（授權音訊來源）。
  - 音訊上傳預設只有管理員，開放會員的配套同時做好；50 MB、15 分鐘、每人 1 GB、保留 30 天；
    權利聲明採兩層（逐次聲明＋使用條款），措辭見 `docs/audio-sources.md` 的 v1 草案。
  - 雲端額度用完，之後全部在本機開發；Python 不用 conda base，改用專屬環境。
  - 短期只有擁有者自己使用，服務要用時才啟動、不常駐。因此到期刪除等維護工作不能只靠外部排程，
    web 啟動時也要補做。
- GitHub 預設分支已是 `main`。私人 repo 在免費方案無法開啟分支保護（API 回 403），仍依 `AGENTS.md` 自律。

## 待擁有者決定（不阻擋進度）

1. 權利聲明 v1 措辭定稿（`docs/audio-sources.md`）。程式以版本化常數存放，不阻擋 M8-1。
2. 是否把 repo 設為公開。公開後免費方案就能開分支保護；7 個 merge commit 的作者 email 是擁有者的個人信箱，公開前要先決定怎麼處理。
3. LLM 審查器：建議維持 `disabled`，等 M8 有實際量測再決定；若要做，provider（本機模型或 Vertex AI）與每月預算上限由擁有者決定。
4. M8 候選模型：逐一記錄程式碼與權重的授權後，由擁有者核可。

## 下一個最有價值的工作（全部在本機）

1. 完成 Windows 本機的基準品質閘門（含 PostgreSQL 整合測試、Playwright、`pnpm secrets:check`），修掉或記錄 Windows 特有的問題。
2. **M8-1**：音訊上傳 API、權利聲明、檔案儲存、配額與保留期限（**完成**）。
3. **M8-2**：`GET /worker/jobs/{id}/audio` 與 worker 端下載、驗證（用合成的測試音訊）。
4. **M8-3**：驗證 Docker Desktop 的 GPU、`compose.gpu-nvidia.yaml`、評估 harness（先用合成訊號，再用擁有者自錄的音訊）、模型轉接器。
5. M7／M9 餘項：web 端 artifact 位元組驗證、多程序限速共用儲存、同步時間軸看譜、指法轉換排序改進、離線頁套用帳號看譜設定。
