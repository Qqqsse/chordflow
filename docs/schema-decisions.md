# Schema 設計決策（契約 v1）

套件：`packages/chart-schema`（`@chordflow/chart-schema`）。以 Zod 4 schema 為唯一真實來源；
JSON Schema（draft 2020-12）自動產生到 `packages/chart-schema/json-schema/` 並提交進 repo。

```sh
pnpm --filter @chordflow/chart-schema generate:json-schema   # 修改 schema 後執行
```

若提交的 JSON Schema 與 Zod schema 不一致，單元測試會失敗。Python worker 也用產生的 JSON Schema
驗證同一批 fixtures（`services/ai-worker/tests/test_contract_fixtures.py`）。

## 兩層驗證

| 層級   | 位置                                | 例子                                                                    |
| ------ | ----------------------------------- | ----------------------------------------------------------------------- |
| 結構層 | Zod schema = 產生的 JSON Schema     | 型別、enum、strict object、id／semver／調號格式、數值範圍               |
| 語意層 | `check*Semantics`／`validate*` 函式 | id 不重複、grapheme 邊界、NFC、控制字元、引用存在、時間軸遞增、主版本號 |

`validateChartDocument(input)` 與 `validateRecordingSync(input, { chart })` 回傳 `{ ok, value, issues }`，
issue 帶有穩定的 `ValidationIssueCode`（`SCHEMA_INVALID`、`ANCHOR_OUT_OF_BOUNDS`、`DUPLICATE_ID`、
`TEXT_NOT_NFC`…）。`parse*` 版本則會丟出 `ContractValidationError`。非 TS 的使用端需要自行實作它所依賴的
語意檢查；每個無效 fixture 都標記為 `structural` 或 `semantic`。

## Chart Document v1（和弦譜文件）

- `schemaVersion` 為 semver。讀取端接受任何 `1.x.y`；主版本不同則回報 `UNSUPPORTED_SCHEMA_VERSION`。
  新增選用欄位只升 minor 版本；其他變更需要新的主版本加上 migration。
- 所有物件皆為 strict（`additionalProperties: false`）。廠商自訂資料放在 `extensions`，key 必須是 `x-*`。
- 同一份譜中，section、line、chord 的 id 共用**同一個**命名空間，因此任何 id（例如指法覆寫的 key、
  RecordingSync 的引用）都能無歧義地解析。
- `anchor.graphemeOffset` 以 NFC 歌詞文字的 extended grapheme cluster 為單位（`Intl.Segmenter`）。
  `0` = 第一個字之前；等於長度 = 最後一個字之後；`anchor: null` = 沒有歌詞位置的和弦（例如間奏）。
- 歌詞必須已是 NFC，且不含控制字元。匯入器負責正規化；schema 不會偷偷改寫文字。
  每一行歌詞是獨立的一筆（明確的換行）。
- 和弦的 `symbol` 是原本寫法。schema 只擋掉不可能是和弦的字串（空字串、空白、括號／標記字元、超過 32 字元）。
  音樂上是否合法由 `@chordflow/music-theory`（M2）判斷。
- `concertKey` 是**實際發聲**的調，可為 `null`（此時級數模式顯示「無法使用」）。
- 移調夾、移調、顯示偏好都不存在譜裡：它們屬於 ViewerState／使用者偏好。
- `voicingPolicy.symbolDefaults` = 編曲層級、每個和弦名稱的預設指法；`occurrenceOverrides` = 針對單一和弦出現位置的覆寫。
  指法 id 由 `@chordflow/guitar-voicings`（M5）解析；找不到的 id 會退回推薦指法。
- `importMetadata.unhandledDirectives` 保留無法處理的 ChordPro 指令及其來源行號（M3）。

## RecordingSync v1（錄音時間對齊）

- 每個（Recording, ChartRevision）一份獨立文件。絕對時間永遠不進入和弦譜本身。
- 有時間的項目帶有 `status: high_confidence | uncertain`。沒有時間資訊的內容列在 `unaligned`，
  而不是被塞入捏造的時間。選用的 `confidence` 為 `{ value, model, calibrated }`；`calibrated: false`
  明確表示這個分數不是機率。
- 歌詞範圍是半開區間 `[fromGrapheme, toGrapheme)`，以該行的 grapheme 計。
- 遞增檢查是逐軌的（和弦開始時間不遞減；同一行內的歌詞開始時間不遞減）。不同軌之間可以重疊；
  同一軌的和弦區間只要開始時間有序，也可以重疊。
- 檢查 `recordingDurationMs` 邊界前會先套用 `offsetMs`。

## 曲庫領域

`Work`（作品）≠ `Recording`（演出）≠ `Arrangement`（可彈奏的譜）。見 `docs/architecture.md`。

- `ArrangementRecordingCompatibility.provenance`：只有 `exact_audio_match` 與 `human_verified` 算已驗證。
  跨不同 Work 的對應會被拒絕，除非 `crossWorkReviewed` 為 true。
- `ChartRevision` 不可變；`checkPublishable(arrangement, revision)` 強制：屬於同一個 arrangement、
  狀態為 `published`、文件內的 id 與資料列一致、權利允許該 arrangement 的可見度。
- 權利依素材分開記錄（`lyrics`、`chart`、`audio`）。`shared`／`public` 可見度需要歌詞與譜都可再散布；
  `unknown` 一律視為不允許（fail closed）。可見度與再散布權利是兩回事。
- `SourceReference.permission` + `permittedUses`：要分析音訊必須同時有 `analysis_permitted` **與**
  `audio_analysis`。公開影片連結是 `discovery_only`。來源 URL 必須是 `https`，視為不可信，且不會被自動抓取。

## 任務與 artifacts

- 內部任務狀態與轉移表在 `jobs.ts`；使用者看到的狀態是推導出來的（`toExternalJobStatus`），
  在沒有近期 worker heartbeat 時會誠實顯示 `waiting_for_worker`。草稿一定要經過 `needs_review` 才能到 `published`。
- Artifact 快取鍵 = 種類 | schema 版本 | processor@版本 | 設定 hash | 輸入指紋。
  `invalidatedBy(node)` 沿相依圖走訪：歌詞變更只會讓 `aligned_lyrics` 與 `fusion_draft` 失效；
  和弦模型變更只會讓 `fusion_draft` 失效。
- Artifact 的 `storagePath` 是相對於 artifact store 的路徑，不得含 `..`，也不得是絕對路徑。

## Fixtures（測試資料）

| 路徑                                   | 內容                                                         |
| -------------------------------------- | ------------------------------------------------------------ |
| `fixtures/charts/*.chart.json`         | 合法的合成譜（SPEC §4 範例、完整繁中歌曲、英文歌曲）         |
| `fixtures/charts/invalid/`             | 無效譜案例 `{ description, layer, expectedIssue, document }` |
| `fixtures/ai/*.sync.json`              | 同一編曲對應的錄音室版與 Live 版 RecordingSync               |
| `fixtures/ai/invalid/`                 | 無效 sync 案例（可附帶 `chartFixture` 作為驗證上下文）       |
| `fixtures/contracts/catalog-demo.json` | 用來載入 demo repository 的曲庫快照                          |

所有歌詞與歌名都是為本 repo 虛構的。無效案例中的 `description` 欄位維持英文，因為它屬於跨語言測試資料。
