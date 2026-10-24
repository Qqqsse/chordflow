# REST API 契約（`/api/v1`）

契約以 Zod 定義在 `packages/chart-schema/src/api.ts`，並產生 OpenAPI 3.1 文件
`packages/chart-schema/openapi/openapi.v1.json`（`pnpm --filter @chordflow/chart-schema generate:json-schema`；
有測試偵測不一致）。瀏覽器只呼叫本應用的 API，不直接連 worker 或其他服務。

## Envelope

成功：

```json
{ "data": { "…": "…" }, "meta": { "requestId": "req_…", "schemaVersion": "1.0.0" } }
```

錯誤：

```json
{
  "error": {
    "code": "CHART_NOT_FOUND",
    "message": "Chart was not found",
    "details": null,
    "requestId": "req_…"
  }
}
```

- `x-request-id`：用戶端可帶入（`[A-Za-z0-9._-]{1,64}`），否則由伺服器產生；回應標頭與 body 都會帶上。
- 所有回應 `Cache-Control: no-store`。
- 非預期錯誤一律回 `500 INTERNAL_ERROR`，不回傳錯誤訊息或 stack；伺服器只記錄 requestId、路徑、錯誤名稱與代碼。
  資料庫無法連線時回 `503 SERVICE_UNAVAILABLE`。

## 已實作的路由

| 路由                                     | 說明                                                            | 錯誤                                      |
| ---------------------------------------- | --------------------------------------------------------------- | ----------------------------------------- |
| `GET /health`                            | 存活檢查，不含任何秘密資訊                                      | 500 `CONFIGURATION_INVALID`               |
| `GET /ready`                             | 就緒檢查：資料庫模式下以 `select 1` 確認 PostgreSQL，失敗回 503 |                                           |
| `GET /search?q=&limit=&cursor=`          | 作品／錄音／編曲；`q` 可為支援的來源網址                        | 400 `INVALID_QUERY`                       |
| `GET /works/{id}`                        | 作品、錄音版本與可見的編曲                                      | 404 `WORK_NOT_FOUND`                      |
| `GET /recordings/{id}`                   | 錄音、來源（含權限）、對應的編曲                                | 404 `RECORDING_NOT_FOUND`                 |
| `GET /recordings/{id}/sync?revisionId=`  | 該錄音對某修訂版本的時間軸（可選）                              | 400 `INVALID_QUERY`、404 `SYNC_NOT_FOUND` |
| `GET /arrangements/{id}`                 | 編曲摘要、權利、可見的修訂列表、錄音對應                        | 404 `ARRANGEMENT_NOT_FOUND`               |
| `GET /arrangements/{id}/revisions/{rev}` | 該修訂的 Chart Document                                         | 404 `CHART_NOT_FOUND`                     |

### 寫入路由（只在資料庫模式；需登入；`Origin` 必須等於 `APP_BASE_URL`）

| 路由                                    | 身分           | 說明                                                                     |
| --------------------------------------- | -------------- | ------------------------------------------------------------------------ |
| `POST /chordpro/import`                 | 會員           | 解析 ChordPro 並回傳預覽與行號訊息，**不儲存**；錯誤時 422 仍附 issues   |
| `POST /arrangements`                    | 管理員         | 建立編曲（作品不存在時一併建立作品與歌手）；權利須允許可見度             |
| `PATCH /arrangements/{id}`              | 管理員         | 設定可見度與各素材權利；`unknown` 權利只能 `private`                     |
| `POST /arrangements/{id}/revisions`     | 管理員或擁有者 | 由文件或 ChordPro 建立草稿；伺服器指派 id、修訂編號與 schema 版本        |
| `POST /arrangements/{id}/publish`       | 管理員         | 交易式發布：鎖定編曲列、檢查權利與文件一致性、更新狀態與指標；可重複呼叫 |
| `POST /invitations`、`GET /invitations` | 管理員         | 建立（token 只回傳一次）與列出邀請                                       |
| `POST /invitations/accept`              | 公開（限速）   | 接受邀請、建立帳號並登入                                                 |

- **樂觀鎖**：`expectedLatestRevision` 與目前最新修訂編號不符時回 `409 REVISION_CONFLICT`；同一編曲的寫入以
  資料列鎖序列化，修訂編號不會重複。
- **修訂不可變**：既有修訂永遠不會被改寫；編輯就是新增修訂。發布新版本後，舊的已發布修訂仍保留為歷史。
- 請求大小上限：匯入 256 KB、修訂 512 KB、其他 4–32 KB；超過回 `413 PAYLOAD_TOO_LARGE`。

### 生成任務（只在資料庫模式；詳見 `docs/generation-jobs.md`）

| 路由                                | 身分               | 說明                                                                         |
| ----------------------------------- | ------------------ | ---------------------------------------------------------------------------- |
| `POST /generation-jobs`             | 會員（配額、限速） | 權利檢查後排隊；同 key 或相同內容的未完成任務回 200 `reused: true`，否則 201 |
| `GET /generation-jobs`              | 會員               | 自己最近的任務（管理員看全部）                                               |
| `GET /generation-jobs/{id}`         | 擁有者或管理員     | 使用者狀態、有限的進度、型別化錯誤、草稿 id；管理員另有內部狀態與轉換紀錄    |
| `GET /generation-jobs/{id}/result`  | 擁有者或管理員     | 草稿修訂、品質報告、處理器與 artifact manifest；尚未完成回 404               |
| `POST /generation-jobs/{id}/cancel` | 擁有者或管理員     | 取消尚未產生草稿的任務；可重複呼叫                                           |
| `POST /generation-jobs/{id}/review` | 管理員             | `publish`（草稿或衍生修訂）或 `reject`                                       |
| `POST /generation-jobs/{id}/retry`  | 擁有者或管理員     | 以原請求建立新任務（只限失敗，或在草稿產生前取消）；原任務不變               |
| `GET /workers`                      | 管理員             | worker 列表與在線狀態（60 秒內聯絡過＝在線）                                 |

### Worker API（`Authorization: Bearer <WORKER_TOKEN>`；不使用 cookie）

| 路由                               | 說明                                                              |
| ---------------------------------- | ----------------------------------------------------------------- |
| `POST /worker/jobs/claim`          | 回收過期租約後，以交易租用下一個任務；佇列空時 `{ job: null }`    |
| `POST /worker/jobs/{id}/heartbeat` | 延長租約並回報階段與進度；租約不屬於此 worker 時 `409 LEASE_LOST` |
| `POST /worker/jobs/{id}/complete`  | 驗證草稿與 manifest 後建立待審查修訂；重送相同內容回傳相同結果    |
| `POST /worker/jobs/{id}/fail`      | 型別化錯誤；可重試錯誤以指數退避重新排隊                          |

### 個人譜庫（只在資料庫模式；需登入；寫入需同源）

| 路由                               | 說明                                                                                    |
| ---------------------------------- | --------------------------------------------------------------------------------------- |
| `GET /me/library`                  | 收藏與最近開啟（最多 20 筆）；只列出目前仍看得到的編曲                                  |
| `GET /me/favorites/{id}`           | 是否已收藏                                                                              |
| `PUT`／`DELETE /me/favorites/{id}` | 加入／移除收藏；可重複呼叫；加入時編曲必須看得到（否則 404）                            |
| `GET`／`PUT /me/preferences/{id}`  | 讀取／儲存看譜設定（UserChartPreference v1，`ViewerPreferencesSchema`）；不會改動和弦譜 |
| `POST /me/recent/{id}`             | 記錄開啟；每位使用者只保留最新 20 筆（204）                                             |

API 契約版本 1.2.0（1.1.0 新增個人譜庫，1.2.0 新增任務重試與 worker 狀態；都向下相容）；envelope 的 `meta.schemaVersion` 使用同一個版本號。

## 搜尋

- 文字查詢經正規化（NFKC、小寫、去除空白／標點／符號）後，比對作品標題、別名（含繁簡體別名）、詞曲作者與
  演唱者姓名；PostgreSQL 以 `pg_trgm` GIN 索引加速。排序：比對位置 → 標題 → id。
- `limit` 1–50（預設 20）。`cursor` 是不透明字串，綁定該次查詢；拿去用在不同查詢會回 `INVALID_QUERY`。
- **來源網址**：只辨識 YouTube（`youtube.com/watch?v=`、`youtu.be/`、`/shorts/`、`music.youtube.com`）與
  Spotify（`open.spotify.com/track/`）的 https 網址，解析出平台 id 後查詢曲庫已知來源。**伺服器永遠不會連線
  抓取這些網址**；其他主機、http、內部 IP、帶帳密或非預設 port 的網址一律回 `INVALID_QUERY`。

## 存取規則（伺服器端）

| 身分   | 可見的編曲                                          | 未發布修訂     |
| ------ | --------------------------------------------------- | -------------- |
| 未登入 | `public` 且歌詞與譜的權利允許再散布                 | 不可見         |
| 會員   | 上述 + `shared`（同樣需權利允許）+ 自己的 `private` | 只限自己的編曲 |
| 管理員 | 全部                                                | 全部           |

權利為 `unknown` 時一律不公開（fail closed）。看不到與不存在都回 404，避免洩漏存在與否。
帳號功能完成前，所有請求都視為未登入。
