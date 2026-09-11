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

- The compose stack started by `make prod-build` opens **one HTTP port on localhost** (`EXPOSE_PORT`, default 13000). The backend, frontend and database are not reachable from outside.
- HTTPS is handled by an **nginx installed on the host**; its certificate is issued and renewed by certbot on the host. There is no certbot inside the compose stack (step 4).

## Prerequisites

- A Linux server (Ubuntu 22.04+ recommended) with at least 2 CPU cores, 2 GB RAM and 10 GB of disk
- Docker Engine 24+, Docker Compose v2
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
make prod-build
make prod-ps                                 # nginx, backend, frontend, db should all be Up
curl -sI http://127.0.0.1:13000 | head -1    # HTTP/1.1 200 (or a 3xx) means it is serving
```

Database migrations run automatically (`alembic upgrade head`) when the backend container starts.

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
git pull
make prod-build     # rebuilds the images and re-creates the containers; migrations run automatically
```

## Everyday commands

| Command | What it does |
|--------|------|
| `make prod-build` | Build the images and start — first time, and after every code update |
| `make prod` | Start — after changing settings only (re-creates just the containers whose config changed) |
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
- **Trusted proxies**: the backend only believes client IPs forwarded by the nginx in the same stack (the Docker bridge range). If your layout differs, narrow `TRUSTED_PROXIES` in `.env.production` to your real proxy range.

## Troubleshooting

| Symptom | Check |
|---|---|
| The backend keeps restarting right after `make prod-build` | `make prod-logs` — a secret or placeholder message such as `RuntimeError: JWT_SECRET_KEY must be set` |
| `curl 127.0.0.1:13000` works but the domain does not open | `sudo nginx -t`, the DNS A record, firewall ports 80/443 |
| Pages load but chat and collaborative editing do not work | The `Upgrade` / `Connection "upgrade"` headers in the host nginx block (step 4) |
| Users keep getting logged out | Make sure the stack is not running with `DEBUG=true` (see the startup warning in `make prod-logs`) |
