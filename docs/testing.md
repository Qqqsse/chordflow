# 測試

所有測試都不需呼叫付費 API、不需 GPU、也不需模型權重。

| 層級           | 指令                                            | 說明                                                 |
| -------------- | ----------------------------------------------- | ---------------------------------------------------- |
| 格式           | `pnpm format:check`                             | Prettier；`SPEC.md` 與營運者文件不在檢查範圍         |
| Lint           | `pnpm lint`                                     | ESLint 9 flat config，含型別檢查的 typescript-eslint |
| 型別檢查       | `pnpm typecheck`                                | 根目錄設定檔 + 各 workspace 的 `typecheck`           |
| 單元測試（TS） | `pnpm test`                                     | Vitest projects：`apps/*`、`packages/*`              |
| 建置           | `pnpm build`                                    | Next.js production build                             |
| 瀏覽器（E2E）  | `pnpm exec playwright test`                     | 以 demo 模式在 port 3100 啟動 `next start`           |
| Python worker  | `cd services/ai-worker && python -m pytest`     | 僅 CPU                                               |
| 相依套件授權   | `pnpm licenses:check`                           | 允許清單 + 已審查例外，位於 `scripts/`               |
| Compose 設定   | `docker compose --env-file .env.example config` | 只需 Docker CLI，不需 daemon                         |
| 密鑰掃描       | CI（`gitleaks`）                                | 見 `.github/workflows/ci.yml`                        |

## Playwright 瀏覽器

`@playwright/test` 鎖定在與 Claude Code 雲端 session 預裝 Chromium 相符的版本
（`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`）。其他環境請先安裝一次瀏覽器：

```sh
pnpm exec playwright install --with-deps chromium
```

E2E 跑在 production build 上，所以要先執行 `pnpm build`。可用 `E2E_PORT` 更改 port。

## Python worker

```sh
cd services/ai-worker
python -m venv .venv
.venv/bin/pip install -e '.[dev]'
.venv/bin/python -m pytest
```

資料庫模式的 Playwright（`e2e-db/generation.spec.ts`）會啟動真正的 Python worker：
預設使用 `services/ai-worker/.venv/bin/python`，沒有時使用 `python3`（需已安裝 pydantic），
也可用 `WORKER_PYTHON` 指定。CI 在 web job 中以 `pip install ./services/ai-worker` 安裝。

## PostgreSQL 整合測試

`apps/web/src/server/catalog/pg-repository.integration.test.ts` 只在設定 `TEST_DATABASE_URL` 時執行，
否則顯示為 skipped。**它會刪除並重建該資料庫的 `public` schema**，只能指向可丟棄的測試資料庫。

```sh
docker run -d --name chordflow-testdb -e POSTGRES_USER=chordflow -e POSTGRES_PASSWORD=testpw \
  -e POSTGRES_DB=chordflow_test -p 127.0.0.1:55432:5432 postgres:17-alpine
TEST_DATABASE_URL=postgres://chordflow:testpw@127.0.0.1:55432/chordflow_test pnpm test
```

記憶體與 PostgreSQL 兩個 adapter 跑同一套 `describeCatalogRepositoryContract`，另外測試資料庫觸發器
（修訂不可變、發布指標、跨作品對應、未對應錄音的時間軸、來源重複）。CI 以 service container 提供資料庫。

## 契約 fixtures 的跨語言驗證

`services/ai-worker/tests/test_contract_fixtures.py` 以 `packages/chart-schema/json-schema/` 中產生的
JSON Schema 驗證與 TS 測試相同的 fixtures：合法 fixtures 必須通過；標記為 `structural` 的無效案例必須失敗；
標記為 `semantic` 的無效案例必須通過 JSON Schema（它們只會被語意驗證器擋下）。

worker 契約另有 `fixtures/contracts/worker/`：Pydantic 與 Zod 驗證同一批 fixtures，
`model` 層的無效案例（跨欄位規則）只會被兩邊的模型擋下。見 `docs/generation-jobs.md`。
