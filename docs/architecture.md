# 架構

部署示意圖見 SPEC §2。本文件記錄目前已實作的結構。

## 套件與相依方向

```text
apps/web ──► packages/chart-schema          （Zod 契約、JSON Schema、grapheme 工具）
         ──► packages/music-theory  （M2） ──► 只用 chart-schema 的型別
         ──► packages/chordpro      （M3） ──► chart-schema、music-theory
         ──► packages/guitar-voicings（M5） ──► music-theory
services/ai-worker（Python）──► packages/chart-schema/{json-schema,openapi}/*.json（讀檔案，不讀 TS 程式碼）
                           ══HTTP（worker API、Bearer token）══► apps/web
```

共用套件直接匯出 TypeScript 原始碼（`exports: ./src/index.ts`），由 Next.js 透過 `transpilePackages` 編譯；
套件內不含 Next.js、React、資料庫或 Python 相依。

## 領域模型

- **Work**：歌曲本身（作品）。
- **Recording**：某一次演出／錄音（錄音室版、Live、翻唱…）。
- **Arrangement**：可彈奏的和弦編曲（原調、簡化版…），與錄音的確切時間無關。
- **ChartRevision**：某個 Arrangement 的不可變修訂版本，只能追加。
- **RecordingSync**：某個 Recording × ChartRevision 專屬的時間對齊；絕對時間只存在這裡。

```text
Artist ──credits──► Work ◄──workId── Recording ──sourceReferenceIds──► SourceReference
                     ▲                    ▲
                  workId                  │ ArrangementRecordingCompatibility
                     │                    │ （provenance、recordedKey、transposeSemitones）
                Arrangement ◄─────────────┘
                     │ publishedRevisionId（必須屬於自己、狀態為 published、權利允許）
                     ▼
               ChartRevision（不可變、只追加）── document: ChartDocument v1
                     ▲
                     │ chartRevisionId
               RecordingSync（每個 Recording × ChartRevision 各一份；絕對時間只存在這裡）
```

## Web 伺服器分層

- `src/lib/api/envelope.ts` — 所有 `/api/v1` 共用的回應 envelope 與 request id。
- `src/server/catalog/repository.ts` — `CatalogRepository` 讀取介面（port）。
- `src/server/catalog/memory-repository.ts` — 經驗證的記憶體實作（demo 模式與測試用）。建立時會驗證
  所有契約不變條件，有問題就直接報錯；讀取回傳的是複本，呼叫端無法改到儲存的資料。
- `src/server/catalog/demo-catalog.ts` — 把合成 fixtures 打包進建置產物（執行時不讀檔案系統）。
- `src/server/catalog/pg-repository.ts` — PostgreSQL（Drizzle）實作同一個介面；`editor.ts` 是寫入端
  （建立編曲、追加修訂、交易式發布）。
- `src/server/jobs/` — 生成任務協調器：`service.ts`（提交、冪等、去重、配額、審查）、
  `worker-service.ts`（claim／heartbeat／complete／fail 與租約）、`worker-auth.ts`（worker token）、
  `store.ts`（狀態轉換與事件紀錄）。見 `docs/generation-jobs.md`。
