# Local deployment (Docker Compose)

chordflow runs privately on the owner's machine first. The base stack is CPU-only and needs no GPU.

## Services

| Service  | Image / build                   | Exposure                             | Notes                                     |
| -------- | ------------------------------- | ------------------------------------ | ----------------------------------------- |
| `db`     | `postgres:17-alpine`            | internal network only                | Persistent named volume `db-data`         |
| `web`    | `apps/web/Dockerfile`           | `127.0.0.1:${WEB_PORT:-3000}` (host) | Next.js standalone, non-root, healthcheck |
| `worker` | `services/ai-worker/Dockerfile` | none                                 | Profile `worker`; CPU mock only (M7)      |

Planned overlays: `deploy/compose.gpu-nvidia.yaml` (M8, separate pinned CUDA image) and a future ROCm profile.
They are intentionally absent until they can be verified on the owner's hardware.

## First start

```sh
cp .env.example .env
# Replace POSTGRES_PASSWORD (and the matching part of DATABASE_URL) and WORKER_TOKEN, e.g.:
openssl rand -base64 32
docker compose up -d --build
docker compose ps            # db and web should become "healthy"
curl http://127.0.0.1:3000/api/v1/health
```

`CHORDFLOW_DATA_MODE=demo` (default) serves only synthetic fixture charts and does not need the database.
The web container still waits for `db` to be healthy so the stack behaves the same in both modes.

Worker configuration check (exits after validating settings; the job loop arrives in M7):

```sh
docker compose --profile worker run --rm worker
```

## Host notes

- **Linux + Docker Engine** and **Windows 11 + WSL2 + Docker Desktop** are both supported for the CPU stack.
- NVIDIA GPU support (driver, NVIDIA Container Toolkit / Docker Desktop GPU support) is documented and verified
  separately in M8. Nothing in the base stack requires it.

## Data, backups and restore

> **Warning:** `docker compose down -v` **deletes the `db-data` volume and every chart, account and revision in it.**
> Use plain `docker compose down` to stop the stack. Take a backup before upgrades.

Logical backup (run from the repository root):

```sh
mkdir -p backups
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' \
  > "backups/chordflow-$(date +%Y%m%d-%H%M%S).dump"
```

Restore into an empty database (stop `web` first so nothing writes during the restore):

```sh
docker compose stop web
docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' \
  < backups/chordflow-YYYYMMDD-HHMMSS.dump
docker compose start web
```

For real use, encrypt dumps (e.g. `age` or `gpg`) and keep an off-host copy. `backups/` must never be committed.
Artifact storage (authorized audio, model outputs) gets its own manifest-based backup once it exists (M7+).

## LAN, Tailscale and public HTTPS

The web port binds to `127.0.0.1` only. Options for wider access:

- **Tailscale / LAN:** put an existing reverse proxy on the host in front of `127.0.0.1:3000`.
- **Public HTTPS:** attach `web` to an existing reverse-proxy Docker network with the overlay:

  ```sh
  # .env: PROXY_NETWORK=<proxy network name>, APP_BASE_URL=https://<your hostname>
  docker compose -f compose.yaml -f deploy/compose.public.yaml up -d
  ```

  The overlay removes the host port binding and joins the external `PROXY_NETWORK`. The proxy owns 80/443 and
  TLS; `deploy/Caddyfile.example` shows a Caddy site block. chordflow never edits another project's proxy,
  router, PPPoE or DuckDNS configuration.

### Public exposure checklist (all must be true before enabling)

- [ ] Hostname (e.g. your DuckDNS subdomain) resolves to the intended public IP.
- [ ] You know which existing service owns ports 80/443 and the new site block does not conflict with it.
- [ ] Router port forwarding / ISP routing / firewall rules are confirmed manually.
- [ ] TLS certificate issuance verified; `APP_BASE_URL` uses `https://`.
- [ ] Authentication, secure cookies, CSRF and rate limits are implemented and tested (M6) — **not yet true in M0**.
- [ ] No database, worker, artifact or debug port is published.
