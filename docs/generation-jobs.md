# 生成任務與 CPU mock worker（M7）

生成和弦譜草稿是**非同步、可持久化的任務**：web 只負責排隊、狀態與審查，實際處理由獨立的 Python worker
透過語言中立的 HTTP API 拉取（SPEC §2、§10、§11）。Next.js 的請求處理中不做任何推論。

```text
管理員 /admin/generate ──POST /generation-jobs──▶ generation_jobs（queued）
                                                     ▲   │
              worker（Python）──claim / heartbeat / complete / fail（Bearer WORKER_TOKEN）
                                                         ▼
                              chart_revisions（ai_draft，needs_review）＋ artifact manifest
管理員 /admin/jobs/{id} ──review：publish / 修改後發布 / reject──▶ 發布或退回
```

## 契約

- Zod：`packages/chart-schema/src/generation.ts`（`GENERATION_CONTRACT_VERSION = 1.0.0`）；
  OpenAPI：`packages/chart-schema/openapi/openapi.v1.json`。
- Pydantic：`services/ai-worker/src/chordflow_worker/contracts.py`。
- 共用 fixtures：`fixtures/contracts/worker/`（含無效案例）。TS 與 Python 兩邊都驗證同一批 fixtures；
  Python 另外比對 OpenAPI 元件的欄位與列舉值，任何一邊漂移都會讓 CI 失敗。
- `mock-complete.golden.json` 是 Python mock 對 fixture 任務的完整輸出（`UPDATE_GOLDEN=1 pytest` 重新產生），
  TS 端用伺服器真正的完成驗證（`validateCompletion`）檢查它，確保跨語言語意一致。
- worker 收到 `contractVersion` 主版號不是 1 的任務會拒絕處理。

## 狀態機

內部狀態與允許的轉換定義在 `jobs.ts`；資料庫觸發器（`0003_generation_jobs.sql`）照抄同一張表，
`jobs-migration.test.ts` 確保兩者完全一致。每次轉換都寫入 `generation_job_events`。

```text
created → validated → queued → leased → running → draft_ready → needs_review → published
                         ▲        │         │
                         └────────┴─────────┘  租約過期（重新排隊）或可重試失敗（退避後重新排隊）
任何未完成狀態 → cancelled；needs_review → cancelled（退回草稿）；→ failed_terminal
```

使用者看到的狀態由內部狀態推導（`toExternalJobStatus`）：沒有 worker 在 60 秒內聯絡過時，排隊中的任務顯示為
**「等待 worker」**；租約已過期但尚未被回收的任務不會顯示成「處理中」。內部狀態與轉換紀錄只給管理員看。

## 提交：權利、冪等與去重

- **權利**：`reference_lyrics` 必須宣告歌詞權利（自己的原創、測試用合成、公有領域、已授權、權利人同意）；
  `unknown`／`not_permitted` 會被拒絕（`422 SOURCE_NOT_AUTHORIZED`）。`source_reference` 必須有
  `analysis_permitted` + `audio_analysis` 授權；公開網址不算授權。不存在與未授權的來源回應相同。
- **冪等**：同一使用者的同一 `idempotencyKey` 永遠回傳同一個任務；同一把 key 搭配不同內容回
  `409 IDEMPOTENCY_CONFLICT`。表單每次填寫產生一把 key，重複點擊不會建立第二個任務。
- **去重**：請求內容（不含 key）正規化後取 SHA-256（歌詞統一換行、NFC）。同一使用者已有相同內容且尚未結束的任務時，
  直接沿用（`reused: true`，HTTP 200）。以 advisory lock 序列化同一使用者的提交，並以部分唯一索引作為最後防線；
  六個同時送出的相同請求只會建立一個任務（整合測試）。
- **配額**：尚未完成處理的任務，會員最多 3 個、管理員 10 個（`429 QUOTA_EXCEEDED`）；另有每分鐘 20 次的提交限速。

## Worker API 與租約

- 認證：`Authorization: Bearer <WORKER_TOKEN>`，與使用者 session 完全分開。token 至少 32 字元；
  以 SHA-256 摘要做常數時間比較；`WORKER_TOKEN_PREVIOUS` 讓輪替期間新舊 token 都可用。
  沒設定時 worker API 回 `503`，不會預設開放。token 不會出現在紀錄或回應中。
- `claim`：在交易中先回收過期租約，再以 `FOR UPDATE SKIP LOCKED` 取最舊的可執行任務，`attempt + 1`，
  發出新的 `lease_<32 hex>` token。佇列空時回 `{ job: null }`。
- 之後每個回報（heartbeat／complete／fail）都必須同時帶對 `workerId` 與 lease token，否則
  `409 LEASE_LOST`（任務被取消時訊息會說明，worker 應立即停止）。
- `heartbeat`：第一次把 `leased` 轉為 `running`，記錄階段與進度，並以 claim 時的租約長度延長租約。
- **worker 離線**：租約過期的任務在下一次 claim 時回到 `queued`（`LEASE_EXPIRED`）；已用完 `maxAttempts`（3）
  則進入 `failed_terminal`（`RETRY_LIMIT_EXCEEDED`）。舊 worker 之後的回報一律 `LEASE_LOST`。
- `fail`：可重試錯誤在還有次數時轉為 `failed_retryable → queued`，並設定指數退避的 `not_before`
  （`JOB_RETRY_BASE_SECONDS` 預設 10 秒，每次加倍，上限 10 分鐘）；否則 `failed_terminal`。
  錯誤代碼是封閉集合；訊息會先移除網址與絕對路徑再儲存。重送同一個失敗回報會被辨識（`replayed: true`）。
- `complete`：驗證草稿（Chart Document 規則）、品質報告的目標都存在、artifact manifest 的圖結構
  （id 唯一、父節點存在且種類符合相依關係、恰好一個 `fusion_draft`）、artifact 路徑必須在 `jobs/<job id>/` 下、
  處理器與 LLM 設定與任務相符、mock 只能宣稱 `synthetic_mock`。通過後在**同一個交易**中建立編曲、
  `ai_draft` 修訂（狀態 `needs_review`）與 manifest。完成內容的摘要會被保存：重送相同內容回傳相同結果
  （`replayed: true`），不會產生第二份修訂；不同內容回 `409`。驗證失敗時任務直接 `failed_terminal`
  （`ARTIFACT_VALIDATION_FAILED`），回 `422` 並附上 issues，不會留下任何修訂。

## CPU mock 處理流程（`services/ai-worker`）

八個階段依序執行，每個階段開始時送一次 heartbeat：

| 階段                     | mock 做什麼                                                                      |
| ------------------------ | -------------------------------------------------------------------------------- |
| `resolve_source`         | 只接受參考歌詞；`source_reference` 回報 `AUDIO_NOT_AVAILABLE`（M8 之前沒有音訊） |
| `decode_and_probe_audio` | **略過**（沒有音訊）                                                             |
| `chord_recognition`      | 以拼寫正確的順階三和弦產生和弦進行；刻意放入一個 V/V 讓審查流程有東西可確認      |
| `lyric_alignment`        | 只做位置對齊（沒有時間軸）：行首，以及可安全計算的行中位置（英文落在字首）       |
| `fusion`                 | 組成 Chart Document 草稿（含只有和弦的前奏）                                     |
| `rule_validator`         | 真正的規則檢查：非順階和弦、含組合字元／表情符號的行                             |
| `llm_reviewer`           | `disabled` 或測試用 `fake`（見下）                                               |
| `draft_producer`         | 產生品質報告與 manifest                                                          |

- 空行分段；重複出現的段落視為副歌。歌詞會轉成 NFC、去除控制字元。
- **不捏造信心值**：mock 的 `overallConfidence` 一律為 `null`，契約也禁止 `synthetic_mock` 帶信心值；
  每個段落都有一個 `synthetic_output` 標記，審查頁顯示「合成草稿，未經音訊分析」。
- 只有在整行每個字形群集都是單一碼位時才放行中和弦，確保與伺服器的 grapheme 計數一致；其餘只放在行首並標記。
- Artifacts 以 JSON 寫到 `WORKER_ARTIFACT_DIR/jobs/<job>/<attempt>/`，cache key 格式與 TS 的
  `artifactCacheKey` 相同（共用 fixture 驗證）。
- 相同輸入產生完全相同的輸出（決定性測試）。

### 審查器（LLM provider）

v1 只有 `disabled` 與 `fake`。`fake` 是決定性的假審查器：針對規則標記的非順階和弦，建議同根音的順階和弦，
附上理由與依據。建議**永遠不會自動套用**到草稿。每個任務有呼叫上限（`WORKER_LLM_MAX_CALLS`，預設 4）；
上限為 0 時標記 `budgetExceeded` 並略過。測試與 CI 不會呼叫任何付費服務；Vertex AI 等真正的 provider 屬於 M9。

## 審查

`/admin/jobs/{id}`：草稿譜面（被標記的和弦或行以虛線框出）、待確認清單、審查建議、處理階段、artifacts 與狀態紀錄。

- **發布這份草稿**：走既有的交易式發布（權利檢查）；任務轉為 `published`。
- **以 ChordPro 修改**：把草稿匯出成 ChordPro，修改後另存為新的修訂（`parentRevisionId` 指向草稿），再發布該修訂。
  只能發布草稿本身或由它衍生的修訂。
- **退回草稿**：修訂狀態改為 `rejected`（保留歷史），任務轉為 `cancelled`。

## 執行 worker

```sh
# 開發機（web 以資料庫模式執行，且設定了相同的 WORKER_TOKEN）
cd services/ai-worker
WORKER_API_BASE_URL=http://127.0.0.1:3000 WORKER_TOKEN=... .venv/bin/python -m chordflow_worker run
#   --once：最多處理一個任務；--drain：佇列空了就結束
```

Docker：`docker compose --profile worker up -d worker`（見 `docs/local-deployment.md`）。

紀錄是 JSON lines，只包含任務 id、階段與結果，不含 token、歌詞或網址。

## 測試

- TS 單元：契約與 fixtures（`generation.test.ts`）、正規化與訊息清理、worker token、狀態機與 migration 一致、
  OpenAPI 每個路徑都有 route handler、Python golden 輸出通過伺服器驗證。
- PostgreSQL 整合（`jobs.integration.ts`）：排隊、冪等與去重、同時提交、權利拒絕、配額、完整流程與重送、
  退回、無效完成、worker 離線與重試上限、可重試失敗與退避、取消、資料庫拒絕非法轉換。
- Python（pytest）：契約一致性、樂理與字形群集、mock 流程（決定性、誠實標示、規則與假審查器、預算）、
  與假協調器互動的 worker 迴圈（重試完成、失去租約、型別化失敗、錯誤 token）。
- Playwright 資料庫模式（`e2e-db/generation.spec.ts`）：管理員送出 → 沒有 worker 時顯示「等待 worker」→
  重複送出沿用同一任務 → 啟動**真正的 Python worker** → 處理中 → 待審查 → 修改為新修訂 → 發布 → 譜頁顯示。

## 尚未包含（後續）

- 真正的音訊取得與 GPU 推論（M8）；授權音訊上傳。
- 使用者重試按鈕、管理員檢視所有 worker 狀態的頁面。
- Artifact 的位元組驗證：目前 web 不讀取 worker 的 artifact 目錄，只驗證 manifest 結構與路徑範圍。
- 多程序部署時的限速共用儲存。
