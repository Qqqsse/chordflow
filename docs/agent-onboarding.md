# Agent 交接總覽（給接手的 Agent）

> 狀態截至 **2026-10-24**。穩定分支是 `main`；開發分支 `claude/beautiful-maxwell-h4wqaz` 經 PR 合併進 `main`。
> 這份文件是**一次讀完就能開工**的總覽；逐次 session 的細節紀錄在 `docs/agent-handoff.md`。
> 若兩者衝突，以程式碼與測試為準，並修正文件。

## 0. 開工前的閱讀順序

1. `AGENTS.md`：session 流程、品質閘門、硬性規則（**必讀**）。
2. 本文件：全貌、怎麼跑、踩過的坑、下一步。
3. `SPEC.md` §0、§4、§5、§10、§15、§16、§17：具約束力的規格。
4. `docs/agent-handoff.md`：每個 commit、每次驗證的紀錄。
5. 要動哪一塊，就讀該塊的專題文件（見 §12 文件索引）。

開工第一步：`git status`（不要覆寫未提交的工作）→ 讀 handoff →
用 GitHub MCP 工具查看最新的 CI run → 跑一次品質閘門當基準。

## 1. 專案是什麼

chordflow 是給吉他自彈自唱用的和弦譜工具，介面預設繁體中文。主要功能：

- 看譜：移調、移調夾（兩種模式）、羅馬級數／Nashville、指法圖、自動捲動與分頁、離線 PWA。
- 曲庫：作品／錄音／編曲分開，修訂不可變，交易式發布，依素材分別記錄權利。
- 邀請制帳號。
- 非同步的 AI 和弦譜生成管線。目前是 CPU mock，GPU 推論留到 M8。

## 2. Milestone 狀態

| Milestone                       | 狀態                                | 主要文件                                              |
| ------------------------------- | ----------------------------------- | ----------------------------------------------------- |
| M0 基礎建設                     | ✅ 完成                             | `README.md`、`docs/local-deployment.md`               |
| M1 Chart schema 與領域模型      | ✅ 完成、**已凍結**（擁有者已確認） | `docs/schema-decisions.md`                            |
| M2 樂理                         | ✅ 完成                             | `docs/music-theory.md`                                |
| M3 ChordPro 匯入／匯出          | ✅ 完成                             | `docs/chordpro.md`                                    |
| M4 看譜器                       | ✅ 完成                             | `docs/viewer.md`（含 ADR-001，已接受）                |
| M5 指法圖／播放模式／PWA        | ✅ 完成                             | `docs/offline-and-voicings.md`                        |
| M6 PostgreSQL／搜尋／帳號／修訂 | ✅ 完成（少數補完項見 §10）         | `docs/api-contract.md`、`docs/security-and-rights.md` |
| M7 生成任務與 CPU mock worker   | ✅ 完成                             | `docs/generation-jobs.md`                             |
| M8 本機 GPU 推論                | ⏳ 未開始：**需要擁有者的硬體**     | SPEC §11、§16                                         |
| M9 審查與發布改進               | ⏳ 未開始                           | SPEC §16                                              |

**CI**：最新一次 run 21（`67a999a`）的四個 job 全部通過：web、worker、compose、security。

**測試數量**（本機，M7 後）：

- Vitest：34 個檔案、704 個測試（含 48 個 PostgreSQL 整合測試）。
- Playwright：45 個（demo 36、資料庫模式 9）。
- pytest：95 個。

## 3. Repo 地圖

```text
apps/web/                     Next.js 16 App Router（UI + /api/v1 BFF）
  src/app/                    頁面：/、/demo、/search、/charts/[id]、/offline、/login、/invite、
                              /admin、/admin/import、/admin/generate、/admin/jobs/[id]
  src/app/api/v1/             REST 路由（每個 OpenAPI 路徑都有 route.ts，由 routes-contract.test.ts 檢查）
  src/components/viewer/      看譜器（排版、控制、指法圖、自動捲動、分頁）
  src/components/offline/     離線儲存、離線譜庫、service worker 註冊
  src/components/account/     登入、邀請、ChordPro 匯入 UI
  src/components/jobs/        生成表單、任務列表、草稿審查
  src/server/catalog/         CatalogRepository（記憶體／PostgreSQL）、editor.ts（寫入端）
  src/server/auth/            better-auth 設定、principal、邀請、guards
  src/server/jobs/            生成任務協調器（service、worker-service、worker-auth、store、views）
  src/server/db/              Drizzle schema（schema.ts、auth-schema.ts、jobs-schema.ts）、migrate、CLI
  drizzle/                    SQL migrations 0000–0003（含手寫觸發器）
  e2e/                        Playwright（demo 模式）
  e2e-db/                     Playwright（資料庫模式；generation.spec.ts 會啟動真正的 Python worker）
  public/sw.js                service worker（永遠不快取 /api）
packages/chart-schema/        Zod 契約 → json-schema/ 與 openapi/（產生的檔案，已提交）
packages/music-theory/        樂理（無執行期相依）
packages/chordpro/            ChordPro 子集（自行實作，非 ChordSheetJS）
packages/guitar-voicings/     指法驗證、指法庫、推薦、指法圖幾何
services/ai-worker/           Python worker（只依賴 pydantic）：contracts、client、runner、pipeline、
                              theory、graphemes、llm（假審查器）、artifacts
fixtures/                     合成／公有領域的和弦譜、ChordPro、sync、契約 fixtures（來源說明見 README）
scripts/                      check-licenses.mjs、check-secrets.mjs
compose.yaml、deploy/         Docker Compose（CPU）；deploy/compose.public.yaml 用於接入既有反向代理
.github/workflows/ci.yml      CI：web、worker、compose、security
```

## 4. 資料流

- **讀取路徑**：瀏覽器 → Next.js → `CatalogRepository`。demo 模式用打包進建置產物的 fixtures，
  資料庫模式用 PostgreSQL。worker、GPU 或 LLM 都離線時仍可運作。
- **寫入路徑**（只在資料庫模式，需登入且同源）：
  - 修訂只能追加。
  - 發布在交易中鎖定編曲列，並檢查權利與文件一致性。
  - 資料庫觸發器再擋一次，例如 `CHART_REVISION_IMMUTABLE`、`PUBLISHED_REVISION_INVALID`。
- **生成路徑**（只在資料庫模式）：
  1. `POST /generation-jobs` 依序做權利檢查、冪等 key、去重、配額，然後排入 `queued`。
  2. Python worker 透過 `/worker/jobs/*` 處理任務（Bearer `WORKER_TOKEN`）：claim → heartbeat → complete／fail。
  3. 完成時建立 `ai_draft` 修訂，狀態為 `needs_review`。
  4. 管理員在 `/admin/jobs/[id]` 發布、修改後發布，或退回。

  狀態機寫在 `packages/chart-schema/src/jobs.ts`，DB 觸發器照抄同一張表，並有測試確保兩者一致。

## 5. 契約與如何修改

- **Chart Document v1、RecordingSync v1、catalog snapshot**：已凍結。變更必須提高 schema 版本，
  並更新 fixtures 與測試（AGENTS.md 硬性規則）。
- **API envelope**（`{ data, meta }`／`{ error }`）與 **worker 契約 v1**（`GENERATION_CONTRACT_VERSION`）
  一樣適用上面的規則。
- **修改 Zod 契約後一定要做**：
  1. `pnpm --filter @chordflow/chart-schema generate:json-schema`，重新產生 `json-schema/` 與 `openapi/`。
     沒做的話，drift 測試會失敗。
  2. 同步修改 `services/ai-worker/src/chordflow_worker/contracts.py`。pytest 會比對 OpenAPI 的欄位與列舉值。
  3. 更新 `fixtures/contracts/worker/` 的 fixtures（含無效案例）。
  4. 改到 mock 輸出時，執行 `cd services/ai-worker && UPDATE_GOLDEN=1 .venv/bin/python -m pytest`，
     重新產生 `mock-complete.golden.json`。TS 端會用伺服器真正的完成驗證檢查它。
- **修改 DB schema**：
  1. 改 `apps/web/src/server/db/*-schema.ts`。
  2. 執行 `pnpm --filter @chordflow/web exec drizzle-kit generate --name <名稱>`。
  3. 觸發器等自訂 SQL **接在產生的 migration 檔後面**（0001–0003 都是這樣做的）。
  4. 已提交的 migration 不要改，要改就新增一個。

## 6. 怎麼跑

```sh
pnpm install --frozen-lockfile
pnpm dev                                   # demo 模式（不需資料庫），http://localhost:3000
```

資料庫模式（開發機）：

```sh
docker run -d --name chordflow-testdb -e POSTGRES_USER=chordflow -e POSTGRES_PASSWORD=testpw \
  -e POSTGRES_DB=chordflow_test -p 127.0.0.1:55432:5432 postgres:17-alpine
export DATABASE_URL=postgres://chordflow:testpw@127.0.0.1:55432/chordflow_test
pnpm --filter @chordflow/web db:migrate
pnpm --filter @chordflow/web db:seed-demo            # 選用：合成示範曲庫
ADMIN_EMAIL=… ADMIN_NAME=… ADMIN_PASSWORD=… pnpm --filter @chordflow/web admin:create
CHORDFLOW_DATA_MODE=database BETTER_AUTH_SECRET=<≥32 字元> WORKER_TOKEN=<≥32 字元> \
  APP_BASE_URL=http://localhost:3000 pnpm dev
```

Worker：

```sh
cd services/ai-worker && python -m venv .venv && .venv/bin/pip install -e '.[dev]'
WORKER_API_BASE_URL=http://127.0.0.1:3000 WORKER_TOKEN=<同上> .venv/bin/python -m chordflow_worker run
```

Docker Compose 的完整步驟見 `docs/local-deployment.md`。

### 環境變數

| 變數                                          | 用途                                                                   |
| --------------------------------------------- | ---------------------------------------------------------------------- |
| `CHORDFLOW_DATA_MODE`                         | `demo`（預設）或 `database`                                            |
| `DATABASE_URL`                                | 資料庫模式必填                                                         |
| `APP_BASE_URL`                                | 同源檢查（CSRF）與 cookie 設定的基準                                   |
| `BETTER_AUTH_SECRET`                          | 資料庫模式必填，≥ 32 字元                                              |
| `TRUST_PROXY`                                 | 只在反向代理會覆寫 `X-Forwarded-For` 時設為 `true`                     |
| `WORKER_TOKEN`、`WORKER_TOKEN_PREVIOUS`       | worker API 憑證（≥ 32 字元）；後者供輪替用；未設定時 worker API 回 503 |
| `JOB_RETRY_BASE_SECONDS`                      | 重試退避的基準秒數（預設 10）                                          |
| `WORKER_API_BASE_URL`、`WORKER_ID`            | worker 連線設定                                                        |
| `WORKER_LEASE_SECONDS`、`WORKER_ARTIFACT_DIR` | worker 租約長度、artifact 目錄                                         |
| `WORKER_LLM_MAX_CALLS`                        | 每個任務的審查器呼叫上限（目前只有假審查器）                           |
| `WORKER_STAGE_DELAY_SECONDS`                  | 每階段延遲，只在 e2e 用來觀察進度                                      |
| `TEST_DATABASE_URL`                           | 啟用 PostgreSQL 整合測試與資料庫模式 Playwright（**會清空該資料庫**）  |
| `CHORDFLOW_ALLOW_DESTRUCTIVE_RESET=yes`       | `db:reset-test` 的安全閥                                               |
| `GITLEAKS_IMAGE`                              | `pnpm secrets:check` 使用的映像（沙盒可改用 mirror.gcr.io）            |

## 7. 品質閘門（推送前全部要跑）

```sh
pnpm format:check && pnpm lint && pnpm typecheck
TEST_DATABASE_URL=postgres://chordflow:testpw@127.0.0.1:55432/chordflow_test pnpm test
pnpm build
TEST_DATABASE_URL=… CI=1 pnpm exec playwright test        # 先 build；資料庫模式需要 Python + pydantic
pnpm licenses:check
pnpm secrets:check                                        # gitleaks 掃 git 歷史，與 CI 相同
(cd services/ai-worker && .venv/bin/python -m pytest)
docker compose --env-file .env.example config -q
docker compose --env-file .env.example --profile worker --profile tools config -q
```

### 雲端沙盒的特殊狀況

- Docker daemon 預設沒啟動，要手動執行 `dockerd`（例如背景執行 `sudo dockerd`）。
- Docker Hub 會回 429。映像改從 `mirror.gcr.io/...` 拉取，例如 `GITLEAKS_IMAGE=mirror.gcr.io/zricethezav/gitleaks:v8.28.0`。
- 建置映像要透過出口代理的 CA，改用沙盒專用的基底映像：
  - `docker build --build-arg NODE_IMAGE=sandbox/node-ca -f apps/web/Dockerfile .`
  - `docker build --build-arg PYTHON_IMAGE=sandbox/python-ca services/ai-worker`

  Dockerfile 本身不需要修改，CI 不需要這些變通。

- Playwright 已鎖定為預裝 Chromium（`/opt/pw-browsers`）對應的版本，**不要**執行 `playwright install`。
- 不要用 `pkill -f`：它會連自己的 shell 一起殺掉。長時間的程序改用背景執行。

## 8. 硬性規則摘要（完整版在 AGENTS.md）

- UI 文字使用 zh-TW；識別字、JSON key、API 路徑使用英文。
- 不捏造 confidence。mock 輸出的 `overallConfidence` 一律為 null，契約也禁止合成草稿帶信心值。
- 不做未授權下載，不用 yt-dlp。公開 URL 不等於分析授權。
- 不呼叫付費 API；只有 `disabled`／`fake` 審查器。不裝 CUDA，不下載模型。
- 不提交秘密、`.env`、音訊或有版權的歌詞。fixtures 一律是合成內容或公有領域。
  測試歌詞用自創的〈晨光小路〉等，或公有領域歌曲。
- 不加入 GPL／AGPL 相依（有 `pnpm licenses:check`）。
- 不要在 commit、PR 或程式碼中寫入模型識別字。commit 結尾要加上 session 指定的 trailer。

## 9. 踩過的坑（請避免重蹈）

| 問題                                                                               | 正確做法                                                                     |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 推送前沒跑 gitleaks，CI security 連續失敗 3 次（合成 lease token 被誤判）          | 推送前跑 `pnpm secrets:check`；新增像金鑰的合成值時，先確認 `.gitleaks.toml` |
| 推送前沒跑 `format:check`（CI run 14）                                             | 每次提交前都跑                                                               |
| `pnpm -s typecheck` 吞掉子專案錯誤                                                 | 用 `pnpm typecheck`，並看 exit code                                          |
| 用 Python 字串替換改檔，被 prettier 格式化後替換悄悄失敗                           | 替換前先 `assert old in s`，或直接用 Edit 工具                               |
| prettier 會改寫產生的 JSON Schema 與 golden 檔                                     | 它們已列在 `.prettierignore`；新的產生檔也要加進去                           |
| better-auth 一般限速每分鐘 20 次，正常瀏覽就會被看成登出                           | 已調為每分鐘 300 次；密碼登入維持 10 次／分鐘                                |
| gitleaks allowlist 加上 `paths` 後，`condition = "AND"` 沒有生效，整個目錄都被放行 | 只用 `regexTarget = "secret"` 搭配精確格式；並放一把假金鑰驗證仍會被抓到     |
| Pydantic 預設的 regex 引擎不支援 look-ahead                                        | 已設定 `regex_engine="python-re"`                                            |
| `<details>` 收合時，裡面的內容不在 accessibility tree，Playwright 找不到           | 測試中先點開                                                                 |
| 和弦標籤夾在歌詞中間，`toContainText` 比對整行歌詞會失敗                           | 改比對歌詞片段，或比對 `.chord-label`                                        |
| `compose.yaml` 用 `${VAR:?}` 會讓沒啟用的 profile 也解析失敗                       | 改用 `${VAR:-}`，由服務自己在缺少設定時失敗                                  |
| CRLF fixture 被 git 正規化成 LF                                                    | 已在 `.gitattributes` 設 `-text`                                             |

## 10. 已知缺口與技術債

- 使用者看譜偏好（`user_chart_preferences` 資料表已建立）與收藏 API 尚未實作。
- CSP 標頭尚未設定；其他安全標頭已設定。
- 限速使用單一程序的記憶體計數，多程序部署時需改用共用儲存。
- 生成任務：
  - 使用者端沒有「重試」按鈕，也沒有 worker 狀態頁。
  - web 不驗證 artifact 的檔案內容，只驗證 manifest 結構與路徑範圍。
- Python 沒有完整的 UAX #29 字形切分：遇到複雜字形時只在行首放和弦，並交給伺服器端驗證。
- CI 的 web job 中，`playwright install` 佔了相當多時間，可以快取。

## 11. 下一步建議（依優先順序）

1. **分支流程**：`main` 是穩定分支（2026-10-24 由已通過 CI 的 `c1a5d0c` 建立）。新工作在
   session 指定的功能分支上開發，經 PR 合併進 `main`，CI 綠燈後才合併。PR 只在使用者要求或授權時開。
2. **M8 本機 GPU 推論**：需要擁有者的 RTX 5090 與授權音訊，雲端 session 不能做 CUDA 或模型相關工作。
   雲端可以先準備：
   - 授權音訊上傳與 `SourceProvider`。
   - `compose.gpu-nvidia.yaml` 草稿（未驗證前不合併）。
   - 用合成訊號建立的評估 harness。
3. **M6／M7 補完**：§10 的前四項。
4. **M9 中可在雲端進行的部分**：和弦位置與段落編輯器、審查差異比對、權利稽核紀錄、
   審查器的結構化建議介面（Vertex 等付費 provider 必須是 opt-in，且有預算上限）。
5. **CI**：快取 Playwright 瀏覽器。

## 12. 文件索引

| 文件                           | 內容                                                      |
| ------------------------------ | --------------------------------------------------------- |
| `SPEC.md`                      | 具約束力的工程規格（擁有者提供，保持原樣）                |
| `docs/claude-code-kickoff.md`  | 擁有者的 kickoff 指示（保持原樣）                         |
| `AGENTS.md`                    | Agent 規則與品質閘門                                      |
| `docs/agent-handoff.md`        | 逐次 session 的紀錄：commit 列表、驗證結果、CI 歷史、決策 |
| `docs/architecture.md`         | 套件相依方向、領域模型、伺服器分層                        |
| `docs/schema-decisions.md`     | Chart schema v1 的設計決策                                |
| `docs/music-theory.md`         | 樂理引擎                                                  |
| `docs/chordpro.md`             | ChordPro 支援範圍、錯誤代碼、匯出時會遺失的資訊           |
| `docs/viewer.md`               | 看譜器排版、狀態、快捷鍵、ADR-001                         |
| `docs/offline-and-voicings.md` | 指法圖、播放模式、PWA 與離線                              |
| `docs/api-contract.md`         | REST 路由、錯誤代碼、存取規則                             |
| `docs/security-and-rights.md`  | 帳號、CSRF、限速、worker 憑證、內容權利                   |
| `docs/generation-jobs.md`      | 生成任務、租約、mock 流程、審查                           |
| `docs/local-deployment.md`     | Docker Compose、備份、公開前檢查清單                      |
| `docs/testing.md`              | 測試分層、Playwright、PostgreSQL 整合、跨語言 fixtures    |
| `fixtures/README.md`           | fixtures 的來源與權利                                     |

## 13. 擁有者已決定的事項

- `LICENSE` 著作權人：**Chen-Wei, Liu**（2026-10-24）。
- ADR-001（以幾何驗證取代像素比對的視覺回歸）：**已接受**（2026-10-24）。
- 合併方式：建立 `main` 作為穩定分支，之後的工作經 PR 合併（2026-10-24）。
  建議擁有者在 GitHub Settings 把預設分支改為 `main`，並為 `main` 開啟「合併前 CI 必須通過」的分支保護。

目前沒有待擁有者決定的事項。
