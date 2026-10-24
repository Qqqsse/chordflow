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

尚未實作（後續）：`POST /chordpro/import`、`POST /arrangements/{id}/revisions`、`POST /arrangements/{id}/publish`
（帳號與修訂發布，M6 後半），以及生成任務與 worker 路由（M7）。

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
