# 安全與內容權利

## 帳號與身分驗證

- **邀請制**：沒有公開註冊（better-auth 的 sign-up 端點已停用）。第一位管理員只能用本機 CLI
  `pnpm admin:create` 建立一次；之後的會員與管理員都透過 `/admin` 產生的邀請連結。
- **邀請碼**：32 bytes 隨機值，只在建立時顯示一次；資料庫只存 SHA-256 雜湊。7 天有效、只能用一次
  （以單一條件式 UPDATE 認領，不會被重複使用）；email 重複等失敗會釋出邀請讓對方重試。
  連結把 token 放在 URL fragment（`#token=`），不會出現在伺服器紀錄或 Referer。
- **密碼**：Argon2id（19 MiB、t=2、p=1），長度 12–128。
- **Session**：存在資料庫，HTTP-only、SameSite=Lax cookie，`APP_BASE_URL` 為 https 時加上 Secure；14 天到期。
- **CSRF**：better-auth 端點檢查 Origin 是否為信任來源；我們自己的寫入 API（例如建立／接受邀請）
  要求 `Origin` 等於 `APP_BASE_URL`，否則回 `403 CSRF_REJECTED`。
- **速率限制**：better-auth 內建（一般端點每分鐘 300 次，因為每次瀏覽頁面都會讀取 session；密碼登入每分鐘 10 次）；
  接受邀請每 15 分鐘 10 次；提交生成任務每分鐘 20 次。
  只有在 `TRUST_PROXY=true`（反向代理會覆寫 `X-Forwarded-For`）時才依 client IP 計算。單一程序記憶體計數，
  多程序部署需改用共用儲存。
- **授權全在伺服器端**：見 `docs/api-contract.md` 的存取規則表。看不到與不存在都回 404。
- **個人資料不進快取 HTML**：登入狀態由瀏覽器端讀取 `/api/auth/get-session`，伺服器渲染的頁面
  （以及 service worker 快取的離線頁）不含使用者名稱。
- **離線資料隔離**：登入後的離線譜存在 `user:<id>` 命名空間；登出時先刪除該帳號的離線資料再結束 session。
  未登入時使用 `guest` 命名空間。
- **Demo 模式**：沒有帳號功能，只提供合成與公有領域內容。

## 網址與外部內容

- 使用者輸入的網址只做**解析**，永遠不會由伺服器抓取。只辨識 https 的 YouTube 與 Spotify 歌曲連結；
  其他主機、http、內部 IP（含 `169.254.169.254`）、帶帳密或非預設 port 的網址一律拒絕。
- 公開網址不等於可以分析音訊的授權：音訊分析需要 `analysis_permitted` 與 `audio_analysis` 權限。
- 不提供 `yt-dlp` 或任何未授權的下載路徑。
- 生成任務在排隊前就檢查權利：參考歌詞必須宣告可用的歌詞權利；來源分析必須有明確的分析授權。
  CPU mock worker 不會取得任何音訊。

## Worker 憑證

- worker API 只接受 `Authorization: Bearer <WORKER_TOKEN>`（至少 32 字元，以摘要做常數時間比較），
  不接受使用者 session；未設定時回 503。輪替：把舊 token 放進 `WORKER_TOKEN_PREVIOUS`、重啟 web、
  把 worker 換成新 token，最後清空 `WORKER_TOKEN_PREVIOUS`。
- 每個 worker 回報都必須帶對 worker id 與租約 token；worker 不需要對外 port，只需連到 web。
- worker 回報的錯誤訊息會先移除網址與絕對路徑再存檔與顯示；worker 紀錄不含 token、歌詞或網址。

## 內容權利

- 軟體授權（MIT）與歌曲內容權利無關。權利依素材分開記錄：歌詞、和弦譜、音訊。
- 可見度（private／shared／public）與再散布權利是兩回事；`shared`／`public` 必須歌詞與譜都具備可再散布的權利，
  `unknown` 一律不公開（fail closed）。
- fixtures 只含虛構內容與公有領域歌曲（來源見 `fixtures/README.md`）。

## 其他

- 錯誤回應不含錯誤訊息細節或 stack；伺服器紀錄只寫 requestId、路徑、錯誤名稱與代碼，不寫請求內容或查詢字串。
- 安全標頭：`X-Content-Type-Options: nosniff`、`Referrer-Policy: strict-origin-when-cross-origin`、
  `X-Frame-Options: DENY`、`Permissions-Policy`。CSP 尚未設定（待辦）。
- 秘密只從環境變數注入；`.env` 不進版控；CI 以 gitleaks 掃描歷史。
