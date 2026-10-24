# 樂理引擎（`packages/music-theory`）

純 TypeScript、無外部執行期相依、可決定性（deterministic）的和弦處理。不依賴 Tonal.js：拼寫規則需要完全掌控，
也省去額外的授權稽核。不 import `chart-schema`——`transposeChartDisplay` 接受結構相容的輸入，`ChartDocument`
直接可用。

## 主要 API

| 函式                                           | 用途                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------ |
| `parseChord(symbol)`                           | 解析成 `ChordAst`；不支援時回傳型別化錯誤（不丟例外、不猜測）            |
| `formatChord(chord, style?)`                   | 根音 + 原本寫法的 suffix + 斜線低音；`style: 'unicode'` 輸出 ♯／♭        |
| `getChordTones(chord)`                         | 依根音字母拼寫的和弦音，標示可省略的音（自然五度、11／13 和弦下的 9 度） |
| `transposeChord(chord, n, { key })`            | 依實際發聲移 n 個半音；有調性時先決定目標調再套用同一個音程              |
| `concertToShape` / `shapeToConcert`            | 移調夾：實際和弦 ↔ 吉他按法（capo 0–12）                                 |
| `renderRomanNumeral` / `renderNashvilleNumber` | 相對於所選調的級數；回傳結構化欄位，方便 UI 做上標                       |
| `chooseEnharmonicSpelling(pc, { key })`        | 依調性選擇同音異名                                                       |
| `transposeKey` / `getScaleContext`             | 調的移動與音階、調號資訊                                                 |
| `transposeChartDisplay(chart, options)`        | 整份譜的顯示轉換（純函式，不改動輸入）                                   |
| `changeCapo(state, capo, mode)`                | 明確區分「保持音高」與「保持按法」兩種移調夾模式                         |

## 支援的和弦寫法

- **根音／低音**：`A`–`G` 加上最多一個 `#`／`b`／`♯`／`♭`。`H`、小寫根音、重升重降根音都會被拒絕。
- **性質**：（無）大三、`m`／`min`／`-` 小三、`dim`／`°`、`dim7`／`°7`、`m7b5`／`ø`／`ø7`、`aug`／`+`、`5`（power chord）。
- **六／七／延伸**：`6`、`6/9`／`69`、`7`、`9`、`11`、`13`、`maj7`／`M7`／`ma7`／`Δ`／`Δ7`、`maj9` 等、`m(maj7)`／`mMaj7`。
- **修飾**：`sus2`、`sus4`、`sus`（= sus4）、`add2`／`add4`／`add9`／`add11`／`add13`、`b5`、`#5`、`b9`、`#9`、`#11`、`b13`、
  `no3`／`no5`；括號與逗號只用來分組（`7(b9,#11)` ≡ `7b9#11`）。
- **斜線低音**：`G/B`、`C6/9/E`。

刻意不支援（回傳錯誤）：`alt`（變化音集合不明確）、單獨的 `maj`／`M`（意義不明）、`msus4`（性質衝突）、
power chord 加其他修飾、重複的修飾、未配對的括號、超過 32 字元。錯誤代碼：`EMPTY`、`TOO_LONG`、`INVALID_ROOT`、
`INVALID_BASS`、`UNSUPPORTED_SUFFIX`、`CONFLICTING_SUFFIX`。

## 拼寫規則

1. **發聲音高與寫法分開**：移調在 12 平均律中移動音高，拼寫由音樂上下文決定。
2. **有調性時**：先用 `transposeKey` 選目標調（調號最簡；同數時大調取升、小調取降，例如 F♯ 與 E♭m），
   再把「原調 → 目標調」的音程套用到每個根音與低音，整份譜拼寫一致。
3. **沒有調性時**：使用固定的音程拼寫表（+2 = 大二度 → `G/B` 變 `A/C#`），三全音則選升降記號較少者。
4. **整理**：結果若出現重升／重降，或出現 E♯、B♯、C♭、F♭ 而目標調本身沒有用到，就改用目標調的慣用寫法。
   調的半音慣用寫法不含重升降與上述罕見寫法（例如 A♭ 調的 ♭III 寫成 `B`，不是 `C♭`）。
5. **斜線低音若是和弦音，就照和弦音拼寫**：`E7/G#` 移到 E 調是 `G#7/B#`（B♯ 是 G♯7 的三度），不是 `G#7/C`。

## 移調夾語意

- 譜上的和弦是**實際發聲（concert）**的參考。`transposeSemitones` 改變目標發聲音高。
- `capoFret = c` 時，顯示的吉他按法 = 發聲和弦往下 c 個半音；實際音高不變。
- `changeCapo(state, capo, 'keep_pitch')`：保持發聲調，按法改變。`'keep_shape'`：保持按法，發聲音高跟著移調夾移動。
  UI 必須明確標示是哪一種，不可混用。
- 理論層接受 capo 0–12；UI 預設只提供 0–7。
- 本套件**不**提供「最佳移調夾」推薦；那必須等 M5 指法驗證後，以整首歌的指法難度比較。

## 級數顯示

- 級數由**字母距離**決定，升降記號由與該調音階級的比較決定——和弦性質不會改變級數（`D#dim` 在 C 調是 `#ii°`，`Eb` 是 `bIII`）。
- 小調以自然小音階為參考：A 小調的 `E7` 是 `V7`，`G#dim` 是 `#vii°`。
- 羅馬數字：大寫 = 大三，小寫 = 小三，`°` 減、`ø` 半減（顯示為 `ø7`）、`+` 增，其餘 suffix 原樣附加（`IVmaj7`、`V7sus4`）。
- Nashville：數字 + `m`／`°`／`ø`／`+` + suffix（`6m7`、`57`）。UI 可用 `NumberedChord` 的結構化欄位把 suffix 做成上標。
- 斜線低音用**調的級數**表示（Nashville 慣例）：C 調的 `G/B` → `V/7`、`5/7`；`C/E` → `I/3`。
- 調未知時 `numbering.available = false`（`KEY_UNKNOWN`），UI 應顯示「無法使用」或請使用者選調。

## 測試

`pnpm --filter @chordflow/music-theory exec vitest run`，或在根目錄 `pnpm test`。涵蓋 SPEC §5 必要案例表、
所有 fixtures 的和弦皆可解析，以及 fast-check property tests：+n 再 −n 還原音高、每個和弦音剛好移 n 個半音、
輸出不含重升降且可再解析、parse／format 往返一致。
