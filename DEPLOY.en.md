# Deploying Weave to a server

[English](DEPLOY.en.md) · [한국어](DEPLOY.md)

Any Linux server with Docker and Docker Compose will do. Production uses a different compose file (`docker-compose.prod.yml`) and settings file (`.env.production`) from the development `make up-build`.

## The shape of it

```
browser ──https :443──▶ host nginx ──http──▶ 127.0.0.1:13000  container nginx
                        (certs: certbot)                       ├─ /api → backend (FastAPI)
                                                               ├─ /    → frontend (Next.js)
                                                               └─ db (PostgreSQL) — internal network only
```

- The compose stack started by `make prod-deploy` opens **one HTTP port** (`EXPOSE_PORT`, default 13000), bound to `127.0.0.1` by default (`EXPOSE_BIND`). The backend, frontend and database are not reachable from outside.
- HTTPS is handled by an **nginx installed on the host**; its certificate is issued and renewed by certbot on the host. There is no certbot inside the compose stack (step 4).

## Prerequisites

- A Linux server (Ubuntu 22.04+ recommended) with at least 2 CPU cores, 2 GB RAM and 10 GB of disk
- Docker Engine 24+, Docker Compose v2
- The host `openssl` command, to generate temporary secrets for the startup check
- A domain whose A record points at the server
- Ports 80 and 443 open in the firewall. Do not open 13000 — only the host nginx talks to it

## Steps

### 1. Clone

```bash
git clone https://github.com/ParkHyeonSeong/weave.git /opt/weave
cd /opt/weave
```

### 2. Settings

```bash
cp .env.production.example .env.production
```

Values you must fill in in `.env.production`:

```env
POSTGRES_PASSWORD=<strong random password>                    # openssl rand -hex 16
DATABASE_URL=postgresql+asyncpg://weave:<same password>@db:5432/weave
JWT_SECRET_KEY=<openssl rand -hex 32>
ENCRYPT_KEY=<openssl rand -hex 32>
ALLOWED_ORIGINS=https://weave.example.com
NEXT_PUBLIC_API_URL=https://weave.example.com
EXPOSE_PORT=13000                                             # local port the host nginx forwards to
```

> If a secret is empty or still the example's `CHANGE_ME` placeholder, the backend refuses to start with a `RuntimeError` — on purpose, so it cannot come up silently with weak defaults. Leave `DEBUG` at `false` (the default): with `true` the JWT secret changes on every restart, which logs everyone out, and `/api/docs` is exposed.
>
> Changing `ENCRYPT_KEY` later invalidates every stored refresh token and Personal Access Token: everyone has to log in again and re-issue their tokens.

### 3. Start the stack

```bash
make prod-deploy                             # build → check backend startup on a temporary DB → deploy
make prod-ps                                 # nginx, backend, frontend, db should all be Up
curl -sI http://127.0.0.1:13000 | head -1    # HTTP/1.1 200 (or a 3xx) means it is serving
```

Use the same command for the first install and updates. `make prod-deploy` includes the build, so there is no need to run `make prod-build` first. Database migrations run automatically (`alembic upgrade head`) when the backend container starts.

### 4. Host nginx + HTTPS

Install nginx and certbot on the host and create an HTTP server block that forwards to port 13000. Keep the WebSocket headers — without them chat and collaborative editing do not work.

```bash
sudo apt install -y nginx certbot python3-certbot-nginx

sudo tee /etc/nginx/sites-available/weave >/dev/null <<'EOF'
server {
    listen 80;
    server_name weave.example.com;            # ← your domain
    client_max_body_size 20M;

    location / {
        proxy_pass http://127.0.0.1:13000;    # ← EXPOSE_PORT from .env.production
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket (chat, collaborative editing)
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
EOF

sudo ln -s /etc/nginx/sites-available/weave /etc/nginx/sites-enabled/weave
sudo nginx -t && sudo systemctl reload nginx

# issue the certificate — certbot adds the 443 block and the http→https redirect to this file
sudo certbot --nginx -d weave.example.com
```

Renewal is automatic through the systemd timer certbot installs (check with `sudo certbot renew --dry-run`). The finished config, including extra security headers such as HSTS, is shown in [nginx/host-nginx.conf.example](nginx/host-nginx.conf.example).

### 5. Check

Open `https://weave.example.com` in a browser. If the setup wizard appears, you are done — create the workspace and the first admin account.

```bash
make prod-logs      # start here if something is wrong
```

### 6. (Optional) Push notifications

Web Push — notifications that arrive with the browser closed — needs a VAPID key pair. Without it, in-app notifications still work.

```bash
make prod-generate-vapid       # prints VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY
```

Put the two values and `VAPID_SUBJECT=mailto:admin@your-domain.com` into `.env.production` and re-create the containers. They are runtime values, so no image rebuild is needed:

```bash
make prod
```

### 7. (Optional) GitHub App integration

To link pull requests to tasks, create a GitHub App as described in README → [GitHub App integration](README.md#github-app-integration), put `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY` / `GITHUB_WEBHOOK_SECRET` into `.env.production`, then `make prod`. The webhook URL is `https://weave.example.com/api/github/webhook`.

## Updating

```bash
cd /opt/weave
git pull --ff-only
make prod-deploy    # build → start the backend on a throwaway database → switch to that image if it passed
make prod-ps
```

`make prod-deploy` builds the images while leaving the running containers alone. It uses the production compose command, entrypoint and healthcheck, but starts the backend with **temporary secrets and an empty, disposable Postgres database** to check migrations, startup and a database-backed response. This catches problems such as an image that builds successfully but cannot start because a required package is missing.

If the build or startup check fails, the services are not replaced and the image tags moved by the build are restored. If restoration itself fails, the script prints `RESTORE FAILED` with manual recovery commands. On success, the stack switches to the verified images without rebuilding and checks that the running backend image ID matches. When an existing backend image differs from the new one, it is kept as `weave-backend:previous`.

This check does not validate the frontend at runtime, real production secrets or integrations, or migrations against existing data. Before updating, review the included migrations and prepare any required database backup. If you plan to investigate production 429 errors, preserve the logs before replacing containers too. After the switch, check login and the live app.

## Production settings and checks after deployment

- **One backend worker**: collaboration rooms and live notification connections are held in process memory. Keep `--workers 1`; adding workers requires shared state between processes first. Password hashing and verification run in separate threads to keep bcrypt calculations off the server's event loop.
- **2 MiB WebSocket message limit**: both production and development use `--ws-max-size 2097152`. Larger messages are rejected with close code `1009`. Chat messages also count by UTF-8 bytes.
- **Pinned backend packages**: development and production Docker builds use [backend/constraints.txt](backend/constraints.txt). Dependency and security updates require updating the pins, then running tests and the startup check on the new image.

Check that backend and db are healthy in `make prod-ps`, then use two browsers to check that Scrum edits appear in both and that Canvas shows its saving state and save result. See [Collaborative editing](README.md#collaborative-editing) for the connection notices and exit-warning coverage.

From the repository root on the server, you can also check that the running command includes `--workers 1` and `--ws-max-size 2097152`, and that the pinned and installed package lists have the same hash:

```bash
docker exec weave-backend cat /proc/1/cmdline | tr '\0' ' '
grep -v '^#' backend/constraints.txt | LC_ALL=C sort | sha256sum
docker exec weave-backend pip freeze --exclude weave-backend | LC_ALL=C sort | sha256sum
```

## Everyday commands

| Command | What it does |
|--------|------|
| `make prod-deploy` | Recommended for first installs and updates — build, check backend startup on a temporary database, deploy the images that passed |
| `make prod-verify` | Build and check the backend start only — running services are left alone (on failure the image tags are restored too) |
| `make prod-build` | Build and start directly — skips the startup check and previous-image backup steps |
| `make prod` | Start or re-create from current image tags — no build or startup check; use to apply runtime settings |
| `make prod-down` | Stop (data volumes are kept) |
| `make prod-logs` | Logs |
| `make prod-ps` | Service status |
| `make prod-generate-vapid` | Generate a VAPID key pair (push notifications) |

> The development targets (`make up`, `make restart`, `make logs`, …) read `docker-compose.yml` and are not used on a production server.

## Security notes

- **Required secrets**: `JWT_SECRET_KEY`, `ENCRYPT_KEY` and the database password. Empty or placeholder values stop the backend from starting.
- **Swagger UI** (`/api/docs`) is off when `DEBUG=false`.
- **Rate limits** apply by default to the auth endpoints (login, sign-up, password reset) and to the AI chat and aggregation endpoints.
- **Security headers**: `X-Content-Type-Options`, `X-Frame-Options` and `Referrer-Policy` are set by the container nginx; the Content-Security-Policy is set per request, with a nonce, by the Next.js middleware. Add HSTS in the host nginx (see the example file).
- **CORS**: only the origins listed in `ALLOWED_ORIGINS` are allowed. Separate several with commas.
- **Trusted proxies**: the container nginx restores the real client IP from `X-Forwarded-For` for connections arriving from the Docker bridge range (`set_real_ip_from 172.16.0.0/12` in [nginx/default.conf](nginx/default.conf)) — that is, from the host nginx — and the backend only believes IPs forwarded by an nginx in that same range (`TRUSTED_PROXIES`). Login rate limits and logs therefore use the actual client IP even behind the host nginx. People sharing a public IP, such as an office, share its request limit; inspect 429 logs by IP and request path before changing the policy. Because 13000 is bound to `127.0.0.1` by default, that trust cannot be abused from outside — if you widen `EXPOSE_BIND`, firewall port 13000, and if your proxy range is not 172.16/12, change both places together.

## Troubleshooting

| Symptom | Check |
|---|---|
| The backend keeps restarting right after deployment | `make prod-logs` — a secret or placeholder message such as `RuntimeError: JWT_SECRET_KEY must be set` |
| `curl 127.0.0.1:13000` works but the domain does not open | `sudo nginx -t`, the DNS A record, firewall ports 80/443 |
| Pages load but chat and collaborative editing do not work | The `Upgrade` / `Connection "upgrade"` headers in the host nginx block (step 4) |
| Users keep getting logged out | Make sure the stack is not running with `DEBUG=true` (see the startup warning in `make prod-logs`) |
| `make prod-deploy` stops with `SMOKE FAIL` / `VERIFY FAIL` | Nothing in production changed, and the image tags point at the running images again. Read the backend log it printed (for example an `ImportError`), fix it and run it again |
| `RESTORE FAILED` is printed | The image tags may still point at the unverified build. Do not run `make prod`; run the printed `docker tag …` commands, then check that `docker image inspect -f '{{.Id}}' weave-backend` equals `docker inspect -f '{{.Image}}' weave-backend` |
| Something breaks after the switch | Check that `weave-backend:previous` is the version you want, then run `docker tag weave-backend:previous weave-backend && make prod` — restores the backend image without rebuilding (only if the release added no database migration) |

`:previous` is updated only when the backend image changes, so redeploying the same image can leave it pointing more than one deployment back. `:pre-verify` is a temporary holding tag overwritten by the next verification. The image names above assume a Compose project named `weave`; for another name, find the actual tags with `docker compose --env-file .env.production -f docker-compose.prod.yml config --images`.
