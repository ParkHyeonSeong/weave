# Weave 서버 배포 가이드

Docker + Docker Compose가 설치된 리눅스 서버라면 어디서든 배포 가능합니다.

## 사전 요구사항

- Linux 서버 (Ubuntu 22.04+ 권장)
- Docker Engine 24+
- Docker Compose v2+
- 도메인 1개 (A 레코드가 서버 IP를 가리키도록 설정)
- 80, 443 포트 오픈 (방화벽/보안그룹)

## 배포 순서

### 1. 프로젝트 클론

```bash
git clone <repo-url> /opt/weave
cd /opt/weave
```

### 2. 환경변수 설정

```bash
cp .env.production.example .env.production
```

`.env.production` 파일을 열어 값을 입력:

```env
DOMAIN=weave.example.com
CERTBOT_EMAIL=admin@example.com
POSTGRES_PASSWORD=여기에_강력한_랜덤_비밀번호
ALLOWED_ORIGINS=https://weave.example.com
NEXT_PUBLIC_API_URL=https://weave.example.com
```

> #### ⚠️ 필수 보안 변수 (미설정 시 backend가 시작되지 않음)
>
> 아래 값을 채우지 않으면 backend가 `RuntimeError`로 즉시 종료됩니다(약한 기본값으로
> 조용히 뜨는 것을 막기 위한 안전장치). 운영 배포 전 반드시 설정하세요.
>
> ```env
> # 인증 토큰 서명 키 — 미설정 시 backend 시작 실패
> JWT_SECRET_KEY=        # openssl rand -hex 32 로 생성
>
> # 민감 데이터(SMTP 비번 등) 암호화 키 — 미설정 시 backend 시작 실패
> ENCRYPT_KEY=           # openssl rand -hex 32 로 생성
>
> # DB 접속 URL — 기본 'weave:weave' 그대로면 운영(DEBUG=false)에서 시작 거부됨.
> # POSTGRES_PASSWORD 와 동일한 강력한 비밀번호를 사용하세요.
> DATABASE_URL=postgresql+asyncpg://weave:여기에_강력한_랜덤_비밀번호@db:5432/weave
> ```
>
> 생성 예시:
> ```bash
> openssl rand -hex 32   # JWT_SECRET_KEY 용
> openssl rand -hex 32   # ENCRYPT_KEY 용
> ```
>
> 또한 `DEBUG`는 반드시 `false`로 두세요(기본값). `true`면 JWT 시크릿이 재시작마다
> 재생성되어 세션이 풀리고 `/api/docs`가 노출됩니다.

### 3. SSL 인증서 초기 발급

SSL 인증서 발급을 위해 먼저 Nginx를 HTTP 모드로 띄워야 합니다.

```bash
# Nginx를 certbot 검증 가능한 상태로 임시 시작
docker compose -f docker-compose.prod.yml up -d nginx

# 인증서 발급
make ssl-init

# Nginx 재시작 (SSL 인증서 적용)
docker compose -f docker-compose.prod.yml restart nginx
```

> **참고**: `ssl-init` 실행 전에 도메인의 DNS A 레코드가 서버 IP를 가리키고 있어야 합니다.

### 4. 서비스 시작

```bash
make prod-build
```

### 5. (선택) Push 알림 설정

PWA 백그라운드 알림을 사용하려면 VAPID 키를 생성해야 합니다.

```bash
# VAPID 키 생성
make generate-vapid

# 출력된 VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY를 .env.production에 추가
# VAPID_SUBJECT도 실제 이메일로 변경
```

`.env.production`에 추가:
```env
VAPID_PUBLIC_KEY=생성된_공개키
VAPID_PRIVATE_KEY=생성된_비밀키
VAPID_SUBJECT=mailto:admin@your-domain.com
```

```bash
# 변경사항 적용
make prod-build
```

> **참고**: VAPID 키를 설정하지 않으면 Push 알림 없이도 정상 동작합니다. WebSocket 기반 실시간 알림은 별도 설정 없이 작동합니다.

### 6. 확인

```bash
# 서비스 상태 확인
make prod-ps

# 로그 확인
make prod-logs
```

브라우저에서 `https://your-domain.com` 접속하여 확인.

## 유용한 명령어

| 명령어 | 설명 |
|--------|------|
| `make prod` | 프로덕션 서비스 시작 |
| `make prod-build` | 빌드 후 시작 |
| `make prod-down` | 서비스 중지 |
| `make prod-logs` | 로그 확인 |
| `make prod-ps` | 서비스 상태 |
| `make ssl-renew` | SSL 인증서 갱신 |
| `make generate-vapid` | VAPID 키 생성 (Push 알림용) |

## SSL 인증서 자동 갱신

certbot 컨테이너가 12시간마다 자동으로 갱신을 시도합니다. 별도 설정 불필요.

## 보안 참고사항

- **필수 시크릿**: `JWT_SECRET_KEY`, `ENCRYPT_KEY`는 운영에서 필수입니다(미설정 시 backend가 시작되지 않음). `DATABASE_URL`도 기본 `weave:weave`면 거부되므로 강력한 비밀번호로 설정하세요. 위 [환경변수 설정](#2-환경변수-설정) 참고.
- **Swagger UI**: 프로덕션(`DEBUG=false`)에서는 자동 비활성화됩니다.
- **Rate Limiting**: 로그인(5회/분), 회원가입(3회/분) 등 주요 엔드포인트에 기본 적용됩니다.
- **보안 헤더**: 컨테이너 Nginx에 `X-Content-Type-Options`, `X-Frame-Options` 등이 기본 설정되어 있습니다. 호스트 Nginx 설정은 `nginx/host-nginx.conf.example`을 참고하세요.
- **CORS**: `ALLOWED_ORIGINS` 환경변수에 명시된 origin만 허용됩니다. 쉼표로 여러 도메인을 지정할 수 있습니다.

## 업데이트

```bash
cd /opt/weave
git pull
make prod-build
```

DB 마이그레이션은 backend 컨테이너의 `entrypoint.sh`가 기동할 때 `alembic upgrade head`를
자동 실행하므로 별도 명령이 필요 없습니다.
