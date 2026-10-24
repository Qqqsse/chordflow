# AGENTS.md — chordflow 程式開發 Agent 規則

`SPEC.md` 是具約束力的工程規格。動手修改前，先讀 §0、§4、§5、§10、§15、§16、§17，
再讀 `docs/agent-onboarding.md`（全貌、怎麼跑、踩過的坑）與 `docs/agent-handoff.md`（逐次紀錄）了解目前狀態與下一個任務。

> English summary: `SPEC.md` is binding. Follow the session protocol and hard rules below; run the quality
> gate before closing a milestone and record skipped checks honestly in `docs/agent-handoff.md`.

## Session 流程（SPEC §17）

1. 修改任何東西之前，先檢查 `git status`、`docs/agent-handoff.md`、package scripts 與相關測試。
   絕不覆寫使用者尚未提交的工作。
2. 依序處理下一個未完成的 Milestone（SPEC §16），以小而聚焦的 conventional commits 提交。
   **每項工作開始前**，先更新 `docs/agent-handoff.md` 的「進行中的工作」並推送，避免 session 中斷後無法交接。
3. schema／樂理／parser 程式碼採測試先行；UI 與 API 必須有測試支撐。
4. 結束 Milestone 前執行等同 CI 的檢查（見下方）。若工具無法使用，在 handoff 中記錄確切原因——
   絕不宣稱沒執行過的檢查已通過。
5. 更新 `docs/agent-handoff.md`：完成的工作、指令與結果、commit hash、阻礙與下一個任務。
   與 SPEC 不同的做法要寫成明確的 ADR 提案，不可默默更改。

## 品質檢查

```sh
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright test        # 使用 Chromium；見 docs/testing.md
pnpm licenses:check
pnpm secrets:check               # gitleaks 掃 git 歷史（需 Docker），與 CI 相同
(cd services/ai-worker && python -m pytest)
docker compose --env-file .env.example config -q   # 只需 Docker CLI，不需 daemon
```

## 硬性規則

- `main` 是穩定分支。GitHub 免費方案的私人 repo 不會強制分支保護，所以要自律：**不直接推送、不強制推送 `main`**；
  只在 session 指定的功能分支開發，經 PR 合併，且 PR 上 CI 全部通過才合併。

- Next.js、看譜器、樂理、儲存 schema 與核心測試都不得依賴 CUDA、Python 或模型權重。
- 共用套件（`packages/*`）是純 TypeScript：不含 Next.js、React（`packages/ui` 除外）、資料庫或
  Node 專屬 API，除非有文件說明。Python 只讀取 JSON Schema／OpenAPI 契約，不碰 TS 內部實作。
- 契約變更（`chart-schema`、API envelope、worker API）必須伴隨 schema 版本號、fixtures 與測試。
- 禁止濫用 `any`、在正式路徑放 mock 行為、捏造 confidence 數值、做無關的大規模重構。
- 絕不提交密鑰、`.env`、憑證、模型權重、音訊或有版權的歌詞／和弦譜。fixtures 一律為合成內容。
- 不做未授權的媒體下載（不可對使用者 URL 執行 `yt-dlp`）。公開 URL 不等於可以分析音訊的授權。
- 測試與 CI 不呼叫付費 API（Vertex／OpenAI）。雲端 session 不安裝 CUDA、不下載模型。
- 產品 UI 文字預設為繁體中文（`zh-TW`）；程式識別字、JSON key 與 API 路徑使用英文。
- 不加入 GPL／AGPL 程式碼或相依套件（ChordSheetJS 僅供參考）。執行 `pnpm licenses:check`。
