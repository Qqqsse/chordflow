# 本機部署（Docker Compose）

chordflow 先在擁有者自己的機器上私人運作。基本 stack 只用 CPU，不需要 GPU。

## 服務

| 服務     | 映像／建置                      | 對外暴露                           | 說明                                     |
| -------- | ------------------------------- | ---------------------------------- | ---------------------------------------- |
| `db`     | `postgres:17-alpine`            | 只在內部網路                       | 持久化 named volume `db-data`            |
| `web`    | `apps/web/Dockerfile`           | 主機 `127.0.0.1:${WEB_PORT:-3000}` | Next.js standalone、非 root、healthcheck |
| `worker` | `services/ai-worker/Dockerfile` | 無                                 | profile `worker`；目前僅 CPU mock（M7）  |

規劃中的疊加設定：`deploy/compose.gpu-nvidia.yaml`（M8，獨立且鎖定版本的 CUDA 映像），以及未來的 ROCm profile。
在能於擁有者硬體上驗證之前，刻意不提供。

## 第一次啟動

```sh
cp .env.example .env
# 替換 POSTGRES_PASSWORD（以及 DATABASE_URL 中對應的部分）與 WORKER_TOKEN，例如：
openssl rand -base64 32
docker compose up -d --build
docker compose ps            # db 與 web 應變為 "healthy"
curl http://127.0.0.1:3000/api/v1/health
```

`CHORDFLOW_DATA_MODE=demo`（預設）只提供合成的示範和弦譜，不需要資料庫。
web 容器仍會等 `db` healthy 才啟動，讓兩種模式的 stack 行為一致。

### 資料庫模式

```sh
# .env：CHORDFLOW_DATA_MODE=database，並設定 DATABASE_URL
docker compose up -d db
docker compose --profile tools run --rm migrate                    # 套用 apps/web/drizzle 中的 migrations
docker compose --profile tools run --rm migrate pnpm db:seed-demo  # （選用）載入合成示範曲庫
docker compose up -d web
```

第一位管理員只能用本機 CLI 建立一次（之後的管理員與會員都透過邀請）。密碼不要寫進指令列歷史：

```sh
read -r -p 'Email: ' ADMIN_EMAIL; read -r -p '名稱: ' ADMIN_NAME; read -r -s -p '密碼（≥12 字元）: ' ADMIN_PASSWORD; echo
docker compose --profile tools run --rm \
  -e ADMIN_EMAIL="$ADMIN_EMAIL" -e ADMIN_NAME="$ADMIN_NAME" -e ADMIN_PASSWORD="$ADMIN_PASSWORD" \
  migrate pnpm admin:create
unset ADMIN_PASSWORD
```

登入後到 `/admin` 建立邀請連結傳給朋友。連結 7 天內有效、只能使用一次，token 放在網址 `#` 後面，不會進到伺服器紀錄。

migration 是明確的操作步驟，web 啟動時**不會**自動執行。`migrate` 服務使用 web 映像的 build stage
（含開發工具），只在 `tools` profile 下存在。開發機上也可以直接執行
`DATABASE_URL=... pnpm --filter @chordflow/web db:migrate`。

Worker 設定檢查（驗證設定後即結束；工作迴圈在 M7 實作）：

```sh
docker compose --profile worker run --rm worker
```

## 主機說明

- CPU stack 支援 **Linux + Docker Engine** 與 **Windows 11 + WSL2 + Docker Desktop**。
- NVIDIA GPU 支援（驅動程式、NVIDIA Container Toolkit／Docker Desktop GPU 支援）在 M8 另行撰寫文件與驗證。
  基本 stack 完全不需要。

## 資料、備份與還原

> **警告：** `docker compose down -v` 會**刪除 `db-data` volume，以及其中所有和弦譜、帳號與修訂版本。**
> 停止服務請用一般的 `docker compose down`。升級前先備份。

邏輯備份（在 repo 根目錄執行）：

```sh
mkdir -p backups
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' \
  > "backups/chordflow-$(date +%Y%m%d-%H%M%S).dump"
```

還原到空的資料庫（先停止 `web`，避免還原期間有寫入）：

```sh
docker compose stop web
docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' \
  < backups/chordflow-YYYYMMDD-HHMMSS.dump
docker compose start web
```

正式使用時，請加密備份檔（例如 `age` 或 `gpg`）並保留一份異地副本。`backups/` 絕不可提交到 git。
Artifact 儲存（已授權音訊、模型輸出）出現後（M7 以後）會有以 manifest 為基礎的獨立備份方式。

## 區網、Tailscale 與公開 HTTPS

web port 只綁定 `127.0.0.1`。若要擴大存取範圍：

- **Tailscale／區網：** 在主機上用既有的反向代理轉發到 `127.0.0.1:3000`。
- **公開 HTTPS：** 用疊加設定把 `web` 接到既有反向代理的 Docker 網路：

  ```sh
  # .env：PROXY_NETWORK=<代理所在的網路名稱>，APP_BASE_URL=https://<你的主機名稱>
  docker compose -f compose.yaml -f deploy/compose.public.yaml up -d
  ```

  此疊加設定會移除主機 port 綁定，並加入外部網路 `PROXY_NETWORK`。80／443 與 TLS 由代理負責；
  `deploy/Caddyfile.example` 提供 Caddy 的 site block 範例。chordflow 絕不修改其他專案的代理、路由器、
  PPPoE 或 DuckDNS 設定。

### 公開前檢查清單（全部成立才可啟用）

- [ ] 主機名稱（例如你的 DuckDNS 子網域）解析到預期的公開 IP。
- [ ] 清楚知道目前由哪個服務佔用 80／443，新的 site block 不會與之衝突。
- [ ] 已手動確認路由器 port forwarding、ISP 路由與防火牆規則。
- [ ] 已驗證 TLS 憑證簽發；`APP_BASE_URL` 使用 `https://`。
- [ ] `APP_BASE_URL` 為 https（啟用 Secure cookie）、`BETTER_AUTH_SECRET` 已設定、反向代理會覆寫 `X-Forwarded-For` 才設 `TRUST_PROXY=true`。
- [ ] 沒有對外公開任何資料庫、worker、artifact 或除錯用 port。
