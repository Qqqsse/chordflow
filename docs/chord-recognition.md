# 和弦辨識（M8-3）

> 狀態：第一步完成（GPU 環境驗證、不靠深度學習的基準、合成訊號評估工具）。尚未接到生成任務流程，
> 也還沒有真實錄音的評估集。

## 環境

- **執行**：GPU worker 之後跑在 Docker 容器（`compose.gpu-nvidia.yaml`，尚未建立）。Docker Desktop 的容器已確認
  用得到 RTX 5090（compute capability 12.0）。
- **實驗**：專屬 conda 環境 `chordflow-gpu`（Python 3.12、`torch 2.11.0+cu128`），不使用 base。設定方式見
  `docs/agent-onboarding.md` §6。

## 基準：`chordflow_worker.baseline`

不靠深度學習、只用 numpy（BSD）的和弦辨識，用來當「學習式模型至少要贏過它」的比較基準：

1. **Chromagram**：短時頻譜（視窗約 0.37 秒、間隔約 0.093 秒），扣掉每格頻譜的中位數（去除寬頻雜訊底），
   再把 55–2000 Hz 的能量折算到 12 個音級。
2. **模板比對**：與 24 個大／小三和弦模板算 cosine；音量低於 −50 dBFS 的格子判為 `N`（沒有和弦）。
3. **Viterbi 平滑**：同一和弦停留的機率 0.95，避免每格跳來跳去。

輸出只有時間與和弦名稱（`ChordSegment(start, end, label)`），**沒有任何信心值**。

原本計畫用 librosa；改成只用 numpy，因為 librosa 會帶入 soxr（LGPL）、numba 等額外相依，而基準只需要頻譜、
chromagram 與平滑。`services/ai-worker` 的選用相依 `[audio]` 只有 numpy；CPU mock worker 不需要它。

## 評估工具：`chordflow_worker.evaluate`

```powershell
conda activate chordflow
python -m chordflow_worker.evaluate        # 合成訊號評估，輸出 JSON
```

- **合成訊號**：正弦波泛音組成的三和弦加低八度根音，可加白雜訊與無聲段落；連續相同的和弦視為一段。
- **指標**：
  - `accuracy`：參考答案時間中，預測和弦相同的比例（大／小三和弦＋`N` 的加權和弦辨識率）。
  - `boundaries`：和弦變換時間在容許誤差（預設 0.5 秒）內一對一配對的 precision／recall／F1。

2026-11-18 的結果（合成訊號，不代表真實音樂的表現）：

| 案例                                     | accuracy | 分界 F1 |
| ---------------------------------------- | -------- | ------- |
| `pop_four_chords`（C G Am F，每個 2 秒） | 0.948    | 1.0     |
| `major_minor_pairs`（A Am E Em）         | 0.979    | 1.0     |
| `fast_changes`（每 0.75 秒換一次）       | 0.965    | 1.0     |
| `with_silence`（含無聲段落）             | 0.919    | 1.0     |
| `noisy_20db`（SNR 20 dB）                | 0.966    | 1.0     |

剩下的誤差主要是分析視窗在和弦交界處的延遲。加入中位數去雜訊底之前，`noisy_20db` 只有 0.50。
測試只要求合成訊號達到 accuracy ≥ 0.85、分界 F1 ≥ 0.9，作為正確性的下限，不是品質目標
（SPEC §11：真實基準量測前不訂準確率目標）。

## 下一步

1. **真實錄音評估集**：擁有者自錄的音訊（例如自彈自唱、公有領域歌曲），放在 repo 之外（例如 `D:\chordflow-data\`），
   正確答案用 app 的編輯器做成和弦譜；評估工具加上讀取 WAV 與參考和弦的模式。
2. **接上生成任務**：新增處理器模式（契約變更），把辨識出的和弦時間軸轉成待審查的草稿。
3. **學習式模型**：音源分離與和弦辨識模型先列授權表（程式碼與權重授權、來源、版本），擁有者核可後才下載，
   並與本基準在同一評估集上比較原曲與分離音軌。
4. `compose.gpu-nvidia.yaml` 與 GPU worker 映像（鎖定版本）。
