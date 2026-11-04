# 授權音訊來源（M8 準備）

> **ADR-003（已接受，擁有者 2026-11-02）**：使用者上傳已實作（M8-1，見「實作（M8-1）」）；worker 取得音訊與
> GPU 推論尚未實作。擁有者的決定見「擁有者決定」。
> 範圍只有「音訊從哪裡來、怎麼證明可以用、怎麼交給 GPU worker」；模型與推論見 SPEC §11。

## 原則（SPEC §11、§12，不可違反）

- 公開網址（YouTube、Spotify…）只用於**辨識與官方嵌入播放**，永遠不下載、不擷取音訊；不使用 `yt-dlp`。
- 只有能證明有權使用的音訊才能分析：使用者自己上傳並聲明權利，或日後經法律審查的授權來源。
- 音訊與分離出的音軌（stems）屬於使用者的私人資料：不公開、不進 git、不進 CI，有保留期限並可刪除。
- web（Next.js）不做轉檔或推論，只做大小與格式檢查；解碼與分析都在 worker。

## SourceProvider 介面

每種來源實作同一組能力（SPEC §11），由 web 的伺服器端使用：

```ts
interface SourceProvider {
  /** 取得歌名、歌手、長度等資訊與官方嵌入網址；不取得音訊。 */
  resolveMetadata(input: { url: string } | { query: string }): Promise<SourceMetadata | null>;
  /** 這位使用者能否對這個來源做音訊分析（權利、保留期限、檔案是否仍在）。 */
  canAnalyze(source: SourceReference, principal: Principal): Promise<AnalyzeDecision>;
  /** 只有 canAnalyze 為真時才可呼叫；回傳 artifact store 中的位置與摘要，不回傳公開網址。 */
  obtainAuthorizedAudio(source: SourceReference): Promise<AuthorizedAudio>;
}
```

| 來源                  | resolveMetadata        | canAnalyze                                   | obtainAuthorizedAudio |
| --------------------- | ---------------------- | -------------------------------------------- | --------------------- |
| YouTube／Spotify 連結 | 只解析網址（現有功能） | 永遠否                                       | 不提供                |
| 使用者上傳（第一個）  | 上傳時填寫的資訊       | 有權利聲明、未過期、未刪除、屬於本人或管理員 | 讀取已上傳的檔案      |
| 授權音樂服務（未來）  | 依服務 API             | 依合約；需另行法律審查                       | 依合約                |

現有的 `canAnalyzeSource`（`analysis_permitted` + `audio_analysis`）仍是必要條件，上傳來源另外檢查下列項目。

## 使用者上傳流程（第一個實作）

1. **上傳前聲明權利**：勾選逐次聲明（措辭見文末「權利聲明 v1 草案」），沒勾就不能上傳。
   聲明的版本、使用者、時間一起保存（和權利稽核紀錄同樣只能新增）。
2. **伺服器端檢查**：
   - 只有 `AUDIO_UPLOAD_ROLES` 中的角色可以上傳（預設只有管理員）；
   - 檔案大小上限 50 MB；
   - 依檔頭判斷格式（WAV、FLAC、MP3、OGG、M4A），不相信副檔名或瀏覽器給的 MIME；
   - 每位使用者的容量配額（1 GB，只計算原始上傳檔）與上傳限速。
   - 長度（15 分鐘）由 worker 解碼時檢查，web 不解碼。
3. **儲存**：
   - 存到 artifact store 的 `uploads/<source id>/<sha256>.<副檔名>`，不提供任何公開網址；
   - SHA-256 摘要就是 SPEC §9 快取鍵中的 `inputFingerprint`。
4. **建立紀錄**：建立 `SourceReference`，欄位為：
   - `platform: user_upload`
   - `permission: analysis_permitted`
   - `permittedUses: ['audio_analysis']`
5. **送出任務**：沿用既有的 `source_reference` 任務，權利檢查已經在排隊前執行。

## GPU worker 如何取得音訊（M8-2 已實作）

建議新增 worker API：`GET /worker/jobs/{id}/audio`。

- 呼叫時必須帶 worker token 與該任務目前的租約 token；
- 以串流回傳檔案，並附上摘要讓 worker 驗證；
- 租約失效就回 409。

這樣 GPU 主機（可能經由 Tailscale 連線）不需要和 web 共用磁碟；worker 契約只多一個端點（次版本號 +1）。
解碼與檢查（長度、取樣率、聲道）在 worker 的 `decode_and_probe_audio` 階段進行，不合格時回報
`AUDIO_INVALID`／`AUDIO_TOO_LONG`。

## 保留與刪除

- 預設在最後一個相關任務結束後保留 30 天，到期自動刪除原始音訊與分離音軌。
- 和弦時間軸等不含音訊的產出可以保留；它們不能還原出音訊。
- 使用者可隨時刪除自己的上傳：
  - 刪除檔案並把來源標記為已撤回；
  - 還需要這份音訊的任務會被取消（狀態 `cancelled`，錯誤代碼 `SOURCE_NOT_AUTHORIZED`）。狀態機不允許
    排隊中的任務直接進入失敗，取消也比較符合「來源被撤回」的意思；
  - 已發布的和弦譜不受影響（它不含音訊）。
- 刪除帳號時一併刪除其所有上傳。
- 管理員可以刪除任何上傳（處理下架通知），也可以停用個別帳號的上傳權。
- 服務不常駐（擁有者要用時才啟動），所以到期刪除不能只靠外部排程：web 啟動時先補做，執行期間再定期檢查。

## 擁有者決定（2026-11-02）

| 項目         | 決定                                                                                                                                                                        |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 誰可以上傳   | 預設只有管理員（短期只有擁有者自己使用）。開放給受邀會員的配套一開始就做好，之後只改設定就能開放（見下方）。                                                                |
| 大小與長度   | 單檔 50 MB；長度 15 分鐘（worker 解碼時檢查，超過回 `AUDIO_TOO_LONG`）。                                                                                                    |
| 每人容量配額 | 1 GB，只計算原始上傳檔。                                                                                                                                                    |
| 保留天數     | 30 天，從最後一個相關任務結束後起算，到期自動刪除。                                                                                                                         |
| 權利聲明     | 兩層：上傳時逐次勾選的聲明，加上全站使用條款中的平台聲明。措辭見下方 v1 草案，擁有者確認後定稿；之後改措辭只需提高版本號。                                                  |
| ADR-003      | 接受。                                                                                                                                                                      |
| 開發地點     | 雲端額度已用完，之後的開發與 M8 都在擁有者的本機（Windows 11、RTX 5090、Docker Desktop）進行；Python 使用專屬 conda 環境，不使用 base（見 `docs/agent-onboarding.md` §6）。 |

數值都做成設定，不寫死在程式中。建議的環境變數：`AUDIO_UPLOAD_ROLES`（預設 `admin`，開放會員時改成 `admin,member`）、
`AUDIO_UPLOAD_MAX_BYTES`、`AUDIO_MAX_DURATION_SECONDS`、`AUDIO_USER_QUOTA_BYTES`、`AUDIO_RETENTION_DAYS`。

開放給其他帳號前要具備的配套（第一版就實作，不等開放時才補）：

- 角色白名單與管理員可停用個別帳號的上傳權；
- 每人容量配額與上傳限速；
- 逐次權利聲明（只能新增的紀錄）；
- 使用條款頁與下架聯絡方式，管理員可刪除任何上傳；
- 使用者自行刪除、刪除帳號時連帶刪除、到期自動刪除；
- 上傳的音訊只有上傳者本人與管理員能使用，永遠不公開。

### 權利聲明 v1 草案

**上傳時逐次聲明**（上傳表單的勾選框）：

> 我確認這份音訊是我自己錄製的，或我已取得權利人的授權，可以用來產生和弦譜草稿。我了解這份音訊只會用於產生我的和弦譜草稿、
> 不會公開，並會在保留期限到期後自動刪除。上傳內容的合法性由我自行負責。

**使用條款中的平台聲明**（全站使用條款頁）：

> 本服務只提供和弦譜產生與歌詞對齊的工具，不提供也不散布任何音訊。使用者上傳的內容由上傳者自行負責；本服務只在產生草稿
> 所需的範圍內處理上傳的音訊，不公開，並依保留期限刪除。若您認為某些內容侵害您的權利，請聯絡管理員，我們會移除相關內容。

只有平台聲明不夠：程式要依每一次上傳的聲明紀錄判斷能否分析（SPEC §11 要求能證明可以使用），而且伺服器本身會複製與
處理音訊，一句「由上傳者負責」無法取代逐次聲明與下架機制。

## 實作（M8-1）

- **資料表**（migration 0007）：`audio_uploads`（識別與檔案不可改、只能結束一次、檔案只能刪一次，皆由觸發器保證）、
  `audio_rights_declarations`（只能新增；刪帳號時只把使用者設為 NULL）、`audio_upload_blocks`。
- **聲明**：文字在 `apps/web/src/lib/rights-declaration.ts`，以版本號（`audio-upload-v1`）存放；每次上傳記錄
  版本與該版文字的 SHA-256。改措辭時新增一個版本，不要修改舊版本。
- **儲存**：`AUDIO_UPLOAD_DIR`（絕對路徑；沒設定就不能上傳）。先串流寫到 `tmp/`，同時計算 SHA-256 並在超過上限時中止，
  確認格式後在同一個交易中寫入來源、聲明與上傳紀錄，最後才把檔案移到 `uploads/<source id>/<sha256>.<副檔名>`。
- **權限**：`AUDIO_UPLOAD_ROLES`（預設 `admin`）、管理員可停用個別帳號、每人配額（以 advisory lock 序列化確保精確）、
  每小時 20 次的上傳限速。生成任務的權利檢查對 `user_upload` 來源另外確認：上傳仍有效，且送出者是上傳者或管理員。
- **清理**：web 啟動約 10 秒後執行一次，之後每 6 小時一次（`apps/web/src/instrumentation.ts`）：到期的上傳結束並刪檔、
  沒有有效上傳的 `user_upload` 來源撤銷分析權限（例如帳號已刪除）、沒有紀錄的孤兒檔案（超過 10 分鐘）與殘留的 `tmp/`
  檔案（超過 1 小時）一併刪除。
- **頁面**：`/uploads`（上傳、列表、刪除；管理員可看全部並停用上傳權）、`/terms`（平台聲明、上傳聲明全文、
  `SITE_CONTACT` 聯絡方式）。
  `source_reference` 任務會回報 `AUDIO_NOT_AVAILABLE`。

| 環境變數                     | 預設               | 說明                                       |
| ---------------------------- | ------------------ | ------------------------------------------ |
| `AUDIO_UPLOAD_DIR`           | 無（不能上傳）     | 私有儲存位置，絕對路徑；Compose 掛 volume  |
| `AUDIO_UPLOAD_ROLES`         | `admin`            | 開放會員時設為 `admin,member`              |
| `AUDIO_UPLOAD_MAX_BYTES`     | 52428800（50 MB）  | 單檔上限                                   |
| `AUDIO_MAX_DURATION_SECONDS` | 900（15 分鐘）     | worker 解碼時檢查（M8-2 起）               |
| `AUDIO_USER_QUOTA_BYTES`     | 1073741824（1 GB） | 每人有效上傳的總大小                       |
| `AUDIO_RETENTION_DAYS`       | 30                 | 從上傳或最後一個相關任務結束後起算         |
| `SITE_CONTACT`               | 無                 | 使用條款頁顯示的聯絡方式（處理下架通知用） |

## M8 實作切分（全部在擁有者本機進行）

1. 上傳 API、權利聲明與檔案儲存（**完成**，見上方「實作（M8-1）」；聲明措辭待擁有者定稿）。
2. `GET /worker/jobs/{id}/audio` 與 worker 端下載、驗證（**完成**，見下方「實作（M8-2）」）。
3. GPU worker 映像、模型轉接器、原曲與分離音軌的比較評估（需要 RTX 5090；模型授權先逐一確認並記錄）。

## 實作（M8-2）

- **端點**：`GET /worker/jobs/{id}/audio`（worker 契約 1.1.0）。必須帶 worker token 與 `x-worker-id`、`x-lease-token`，
  而且這個 worker 目前持有該任務的租約；任務被取消（例如撤回上傳）後租約就失效（409）。只回傳仍有效的上傳；
  檔案不見或大小不符時回 404 `AUDIO_NOT_AVAILABLE`，不會送出不一致的內容。回應附 SHA-256、格式與長度上限。
- **worker**：`WorkerApiClient.download_audio` 串流寫到暫存目錄並驗證 SHA-256（不符視為傳輸錯誤，讓租約過期後重試）；
  WAV 以 Python 標準庫檢查長度與格式（`AUDIO_TOO_LONG`／`AUDIO_INVALID`），其他格式要等 M8-3 的解碼器。
  音訊只存在該步驟的暫存目錄，結束即刪除，不放進 artifact 儲存。
- **CPU mock 的行為**：取得並檢查音訊後回報 `MODEL_UNAVAILABLE`（不可重試），**不會**假裝分析過音訊。
  因此 `/uploads` 的「用這份音訊產生草稿」按鈕延到 M8-3，避免一定會失敗的按鈕。
- **測試**：PostgreSQL 整合測試（只有持租約的 worker 拿得到、檔案被改過或撤回後拒絕）、pytest（下載、摘要不符、
  租約遺失、太長、無效 WAV、OpenAPI header 名稱一致）、e2e 走真實 HTTP（上傳 → 送任務 → 租用 → 下載並比對位元組）。
