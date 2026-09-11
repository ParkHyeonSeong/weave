# Weave 서버 배포 가이드

[English](DEPLOY.en.md) · [한국어](DEPLOY.md)

Docker와 Docker Compose가 설치된 리눅스 서버라면 어디서든 배포할 수 있습니다. 개발용 `make up-build`와는 다른 컴포즈 파일(`docker-compose.prod.yml`)과 설정 파일(`.env.production`)을 씁니다.

## 구조 한눈에

```
브라우저 ──https :443──▶ 서버 nginx ──http──▶ 127.0.0.1:13000  컨테이너 nginx
                        (인증서: certbot)                      ├─ /api → backend (FastAPI)
                                                               ├─ /    → frontend (Next.js)
                                                               └─ db (PostgreSQL) — 내부 네트워크 전용
```

- `make prod-build`가 띄우는 컴포즈 스택은 **HTTP 포트 하나**(`EXPOSE_PORT`, 기본 13000)만 로컬에 엽니다. 백엔드·프론트엔드·DB는 외부에서 직접 닿지 않습니다.
- HTTPS는 **서버에 설치한 nginx**가 맡고, 인증서는 서버의 certbot이 발급·갱신합니다. 컴포즈 안에는 certbot이 없습니다(4단계).

## 사전 요구사항

- Linux 서버 (Ubuntu 22.04+ 권장), CPU 2코어 · RAM 2 GB · 디스크 10 GB 이상
- Docker Engine 24+, Docker Compose v2
- 도메인 1개 — A 레코드가 서버 IP를 가리키도록 설정
- 방화벽에서 80, 443 오픈. 13000은 열지 않습니다(서버 nginx만 접근)

## 배포 순서

### 1. 클론

```bash
git clone https://github.com/ParkHyeonSeong/weave.git /opt/weave
cd /opt/weave
```

### 2. 환경변수

```bash
cp .env.production.example .env.production
```

`.env.production`에서 반드시 채울 값:

```env
POSTGRES_PASSWORD=<강력한 랜덤 비밀번호>                       # openssl rand -hex 16
DATABASE_URL=postgresql+asyncpg://weave:<위와 같은 비밀번호>@db:5432/weave
JWT_SECRET_KEY=<openssl rand -hex 32>
ENCRYPT_KEY=<openssl rand -hex 32>
ALLOWED_ORIGINS=https://weave.example.com
NEXT_PUBLIC_API_URL=https://weave.example.com
EXPOSE_PORT=13000                                             # 서버 nginx가 넘겨줄 로컬 포트
```

> 시크릿이 비어 있거나 예제의 `CHANGE_ME` 플레이스홀더가 남아 있으면 백엔드가 `RuntimeError`로 시작을 거부합니다 — 약한 기본값으로 조용히 뜨는 것을 막기 위한 장치입니다. `DEBUG`는 `false`(기본값)로 둡니다. `true`면 JWT 시크릿이 재시작마다 바뀌어 세션이 풀리고 `/api/docs`가 노출됩니다.
>
> `ENCRYPT_KEY`는 나중에 바꾸면 저장된 refresh 토큰과 Personal Access Token이 전부 무효가 되어, 전원이 다시 로그인하고 토큰을 재발급해야 합니다.

### 3. 스택 시작

```bash
make prod-build
make prod-ps                                 # nginx, backend, frontend, db 네 개가 Up 인지
curl -sI http://127.0.0.1:13000 | head -1    # HTTP/1.1 200 (또는 3xx) 이면 정상
```

DB 마이그레이션은 backend 컨테이너가 뜰 때 `alembic upgrade head`로 자동 실행됩니다.

### 4. 서버 nginx + HTTPS

서버에 nginx와 certbot을 설치하고, 13000으로 넘기는 HTTP 서버 블록을 먼저 만듭니다. WebSocket 헤더가 없으면 채팅과 문서 동시 편집이 되지 않으니 블록을 그대로 쓰세요.

```bash
sudo apt install -y nginx certbot python3-certbot-nginx

sudo tee /etc/nginx/sites-available/weave >/dev/null <<'EOF'
server {
    listen 80;
    server_name weave.example.com;            # ← 실제 도메인
    client_max_body_size 20M;

    location / {
        proxy_pass http://127.0.0.1:13000;    # ← .env.production 의 EXPOSE_PORT
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket (채팅, 문서 동시 편집)
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
EOF

sudo ln -s /etc/nginx/sites-available/weave /etc/nginx/sites-enabled/weave
sudo nginx -t && sudo systemctl reload nginx

# 인증서 발급 — 443 블록과 http→https 리다이렉트를 certbot이 이 파일에 추가한다
sudo certbot --nginx -d weave.example.com
```

갱신은 certbot이 설치한 systemd 타이머가 자동으로 합니다(`sudo certbot renew --dry-run`으로 확인). 완성된 설정의 모양과 추가 보안 헤더(HSTS 등)는 [nginx/host-nginx.conf.example](nginx/host-nginx.conf.example)을 참고하세요.

### 5. 확인

브라우저에서 `https://weave.example.com`을 열어 설정 마법사가 뜨면 성공입니다. 워크스페이스와 첫 관리자 계정을 만드세요.

```bash
make prod-logs      # 문제가 있으면 여기부터
```

### 6. (선택) 푸시 알림

브라우저를 닫아도 오는 Web Push에는 VAPID 키가 필요합니다. 없어도 앱 안 알림은 동작합니다.

```bash
make prod-generate-vapid       # VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY 출력
```

출력된 두 값과 `VAPID_SUBJECT=mailto:admin@your-domain.com`을 `.env.production`에 넣고 컨테이너를 다시 만듭니다. 런타임 값이라 이미지를 다시 빌드할 필요는 없습니다:

```bash
make prod
```

### 7. (선택) GitHub App 연동

PR과 태스크를 연결하려면 README의 [GitHub App 연동](README.ko.md#github-app-연동) 절차대로 GitHub App을 만들고, `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY` / `GITHUB_WEBHOOK_SECRET`을 `.env.production`에 넣은 뒤 `make prod`. 웹훅 URL은 `https://weave.example.com/api/github/webhook`입니다.

## 업데이트

```bash
cd /opt/weave
git pull
make prod-build     # 이미지 다시 빌드 + 컨테이너 재생성. 마이그레이션은 자동
```

## 자주 쓰는 명령

| 명령어 | 설명 |
|--------|------|
| `make prod-build` | 이미지 빌드 후 시작 — 처음, 그리고 코드 업데이트 후 |
| `make prod` | 시작 — 설정만 바꿨을 때 (바뀐 컨테이너만 재생성) |
| `make prod-down` | 중지 (데이터 볼륨은 유지) |
| `make prod-logs` | 로그 |
| `make prod-ps` | 서비스 상태 |
| `make prod-generate-vapid` | VAPID 키 생성 (푸시 알림용) |

> 개발용 명령(`make up`, `make restart`, `make logs` …)은 `docker-compose.yml`을 보므로 운영 서버에서는 쓰지 않습니다.

## 보안 참고사항

- **필수 시크릿**: `JWT_SECRET_KEY`, `ENCRYPT_KEY`, DB 비밀번호. 비어 있거나 플레이스홀더면 백엔드가 시작되지 않습니다.
- **Swagger UI**(`/api/docs`): `DEBUG=false`에서는 꺼집니다.
- **요청 제한**: 로그인·회원가입·비밀번호 재설정 같은 인증 경로와 AI 채팅·집계 엔드포인트에 기본 적용됩니다.
- **보안 헤더**: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`는 컨테이너 nginx가, Content-Security-Policy는 Next.js 미들웨어가 요청마다 nonce와 함께 붙입니다. HSTS는 서버 nginx에서 추가하세요(예제 파일 참고).
- **CORS**: `ALLOWED_ORIGINS`에 적은 origin만 허용합니다. 쉼표로 여러 개 지정할 수 있습니다.
- **신뢰 프록시**: 백엔드는 같은 스택의 nginx(도커 브리지 대역)가 전달한 클라이언트 IP만 믿습니다. 구성이 다르면 `.env.production`의 `TRUSTED_PROXIES`를 실제 프록시 대역으로 좁혀서 명시하세요.

## 문제 해결

| 증상 | 확인할 것 |
|---|---|
| `make prod-build` 직후 backend가 재시작을 반복 | `make prod-logs` — `RuntimeError: JWT_SECRET_KEY must be set` 같은 시크릿·플레이스홀더 메시지 |
| `curl 127.0.0.1:13000`은 되는데 도메인으로는 안 열림 | `sudo nginx -t`, DNS A 레코드, 방화벽 80/443 |
| 페이지는 뜨는데 채팅·문서 동시 편집이 안 됨 | 서버 nginx 블록의 `Upgrade` / `Connection "upgrade"` 헤더(4단계) |
| 로그인이 자꾸 풀림 | `DEBUG=true`로 떠 있지 않은지 (`make prod-logs`의 시작 경고) |
