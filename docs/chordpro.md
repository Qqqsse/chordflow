# ChordPro 匯入／匯出（`packages/chordpro`）

自行實作、有明確界限的 ChordPro 子集（SPEC §6）。**不**使用 ChordSheetJS（GPL）。依賴 `chart-schema`
（文件型別、驗證、grapheme）與 `music-theory`（和弦解析、調性、移調夾換算），不依賴 Next.js 或資料庫。

```ts
importChordPro(text, { chartRevisionId, arrangementId, language?, defaultTitle?, chordsWrittenAs? })
// → { ok, document, metadata, issues }
exportChordPro(document, { artists?, subtitles? })
// → { text, warnings }
```

匯入只產生**預覽**：回傳經 `validateChartDocument` 驗證的 Chart Document 與原始 metadata，不會儲存任何東西。
`POST /api/v1/chordpro/import` 需要身分驗證，因此在 M6（帳號）實作時接上。

## 支援的語法

| 類別     | 支援內容                                                                                                                                       |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| metadata | `{title}`／`{t}`、`{subtitle}`／`{st}`、`{artist}`、`{key}`、`{capo}`、`{tempo}`、`{time}`                                                     |
| 段落     | `{start_of_verse}`／`{sov}`、`{end_of_verse}`／`{eov}`、chorus（`soc`／`eoc`）、bridge（`sob`／`eob`），可加標籤 `{soc: 副歌 2}`               |
| 擴充段落 | `{start_of_<kind>}` … `{end_of_<kind>}`，kind 為 chart-schema 的 section kind（intro、pre_chorus、instrumental、interlude、outro、tag、other） |
| 歌詞行   | 純文字、`[和弦]` 行內標記（可多個、可在行首或行尾）、只有和弦的行（成為 `anchor: null` 的間奏和弦）                                            |
| 空行     | 段落內的空行保留；段落頭尾的空行去除                                                                                                           |
| 註解     | 以 `#` 開頭的行是 ChordPro 註解，忽略                                                                                                          |

不在任何段落內的內容，依序合併成 kind 為 `other` 的段落——不猜測它是主歌或間奏。

### 跳脫字元

歌詞中的 `\[`、`\]`、`\{`、`\}`、`\\` 代表字面字元；行首的 `\#` 代表字面 `#`（否則是註解）。
其他反斜線組合、未跳脫的 `]`、`{`、`}`（行中）都是錯誤。匯出時自動加上必要的跳脫。

### 正規化

- 移除 BOM；CRLF、CR 一律轉成 LF；去除行尾空白（保留行首空白）。
- 歌詞轉成 Unicode NFC；和弦位置以 grapheme 計算（emoji、組合字元算一個字）。
- 和弦標記若落在組合字元之前（會把一個字拆開），回報 `CHORD_INSIDE_GRAPHEME`。

## 移調夾：必須明確選擇

`{capo: n}`（n > 0）有兩種常見意義，無法從檔案判斷，所以**不猜測**：

- `chordsWrittenAs: 'concert'`：和弦與 `{key}` 已是實際發聲的和弦，capo 只是參考資訊。
- `chordsWrittenAs: 'capo_shapes'`：和弦與 `{key}` 是夾 capo 後的按法；匯入時往上移 n 個半音，存成實際發聲的和弦。

未指定時回傳 `CAPO_INTERPRETATION_REQUIRED` 錯誤，UI 應詢問使用者。capo 本身不存進和弦譜（屬於使用者偏好）。

## 錯誤與警告

每個 issue 都有 `severity`、`code`、`line`（從 1 起算；0 表示整份文件）與可選的 `column`。所有錯誤會一次回報，不只第一個。

| 代碼                                                                                                                         | 嚴重度 | 說明                                                                |
| ---------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------- |
| `UNKNOWN_DIRECTIVE`                                                                                                          | 警告   | 不支援的指令；保留在 `importMetadata.unhandledDirectives`（含行號） |
| `UNSUPPORTED_CHORD`                                                                                                          | 警告   | 和弦無法被樂理引擎解析；原樣保留，看譜器會透明地退回原字串          |
| `MALFORMED_DIRECTIVE`、`DUPLICATE_DIRECTIVE`                                                                                 | 錯誤   | 一行一個 `{name}` 或 `{name: value}`；metadata 不可重複             |
| `MALFORMED_CHORD`、`UNEXPECTED_BRACKET`、`UNEXPECTED_BRACE`、`BAD_ESCAPE`、`UNSUPPORTED_ANNOTATION`、`CHORD_INSIDE_GRAPHEME` | 錯誤   | 歌詞行語法                                                          |
| `SECTION_NOT_CLOSED`、`SECTION_MISMATCH`、`NESTED_SECTION`、`UNSUPPORTED_ENVIRONMENT`                                        | 錯誤   | 段落結構；`tab`、`grid` 等非歌詞環境不支援                          |
| `INVALID_KEY`、`INVALID_TEMPO`、`INVALID_TIME`、`INVALID_CAPO`、`CAPO_INTERPRETATION_REQUIRED`                               | 錯誤   | metadata 值                                                         |
| `TITLE_MISSING`、`EMPTY_DOCUMENT`、`DOCUMENT_INVALID`                                                                        | 錯誤   | 整份文件                                                            |
| `INPUT_TOO_LARGE`、`LINE_TOO_LONG`                                                                                           | 錯誤   | 上限：200,000 字元、5,000 行、每行 1,000 字元                       |

## 匯出會遺失的資訊（刻意）

ChordPro 只承載歌詞、和弦與段落結構。以下資訊匯出後**不會**保留：

- 和弦譜、編曲與每個和弦出現位置的 id（重新匯入時會重新產生）
- `voicingPolicy`（預設難度、和弦預設指法、單一位置的指法覆寫）
- `extensions` 與 `importMetadata`（包含先前未處理的指令）
- 吉他調弦（tuning）
- RecordingSync 時間軸、AI 來源紀錄與每位使用者的看譜設定（這些本來就不屬於和弦譜）
- 歌詞行上沒有位置的和弦會被寫到行首（並回傳 `UNANCHORED_CHORDS_MOVED` 警告）

匯出一律使用明確的段落標記（`{start_of_<kind>}`），永遠不輸出 `{capo}`。歌手、副標題屬於曲庫資料，
可透過 `exportChordPro` 的選項傳入。

## 測試

`fixtures/chordpro/` 收錄手寫的〈送別〉（別名、註解、未知指令、隱含段落）、CRLF 的〈Amazing Grace〉，
以及〈送別〉的 golden 匯出檔。測試涵蓋 SPEC §6 列出的所有情境，並對所有 chart fixtures 驗證
匯出 → 匯入的語意往返，以及匯入 → 匯出 → 匯入 → 匯出的穩定性。
