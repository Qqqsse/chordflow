# chordflow — Claude Code Cloud Session Kickoff

你現在負責從 GitHub Private Repository 開發 `chordflow`。請以儲存庫根目錄的 `SPEC.md` 為唯一主要工程規格，並嚴格遵守其第 0、4、5、10、15、16、17 章。

## 本次任務

1. 先檢查 repo 目前內容、`git status`、可用的 Node/pnpm/Python/Docker/CI 環境。**不要假設 Repo 是空的，也不要覆寫使用者既有工作。**
2. 先閱讀 `SPEC.md`，確認是否已有 `AGENTS.md`、`docs/agent-handoff.md` 及任何已完成 Milestone。沒有則以 **M0** 開始；已有完成且驗收通過的 Milestone，才接續下一個。
3. 在本次 Session 優先完成 **一個可完整驗收、可提交 Commit 的 Milestone 或其明確子任務**。不要將未完成的大量程式碼留在暫存沙盒裡。
4. 每個核心功能先建立測試與合成 Fixtures，實作後執行可用的 lint/typecheck/unit test/build/Playwright。若工具不可使用，記錄精確原因，不能謊稱通過。
5. 使用 **Next.js App Router + TypeScript strict + Tailwind + pnpm workspaces**。核心 ChordPro/樂理/指法元件均為純 TypeScript、GPU-independent。產品 UI 以繁體中文為預設。
6. 禁止在雲端 Session 中嘗試安裝 CUDA、下載大型模型權重、處理沒有授權的音訊、使用 YouTube 非授權下載、消耗付費 Vertex/OpenAI API 額度或要求任何密鑰。AI 管線先用 CPU Mock 與已驗證 JSON Contract。
7. 若 API/Schema 需要修改，先更新契約、Fixtures、測試與相關文件，不得單方面修改造成前後端不相容。
8. 每個任務完成後做 **focused commit**，更新 `docs/agent-handoff.md`，列出已完成工作、測試輸出、Commit Hash、未解決問題及下一個最有價值的工作。

## 重要時程

Claude Code Cloud Sessions 額度於 **2026-11-05** 過期。請最大化真正可驗收的成果。優先執行 M0–M6、M7 Mock Worker；真實 RTX 5090/CUDA 音訊模型整合屬於本機後續工作，不是此雲端 Session 的完成條件。

## 回覆格式

- 本次處理的 Milestone 和明確子任務
- 重要設計選擇及受影響檔案
- 執行過的測試命令及結果（含 skipped/failed）
- Git Commit Hash（如環境允許提交）
- 下一個 Milestone / 未完成風險

**請現在開始檢查 repo 和 SPEC.md，然後直接實作第一個尚未完成的任務；不要先產生一大篇新的企劃書。**
