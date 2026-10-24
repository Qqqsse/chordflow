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

## 契約 fixtures 的跨語言驗證

`services/ai-worker/tests/test_contract_fixtures.py` 以 `packages/chart-schema/json-schema/` 中產生的
JSON Schema 驗證與 TS 測試相同的 fixtures：合法 fixtures 必須通過；標記為 `structural` 的無效案例必須失敗；
標記為 `semantic` 的無效案例必須通過 JSON Schema（它們只會被語意驗證器擋下）。
