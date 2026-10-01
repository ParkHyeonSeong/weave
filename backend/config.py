import base64
import ipaddress
import logging
import os
import secrets

# App
DEBUG = os.getenv("DEBUG", "false").lower() == "true"
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")

# .env.production.example의 미치환 플레이스홀더(CHANGE_ME_*) 표식. 예제 파일을 복사한 뒤
# 값을 바꾸지 않고 그대로 운영에 올리는 가장 흔한 실수를 잡기 위해, prod에서는 이 표식이
# 들어간 시크릿/URL을 거부한다(openssl 출력은 16진수라 이 표식을 포함할 수 없다).
_PLACEHOLDER_MARK = "CHANGE_ME"

# Database — dev 편의 기본값(weave:weave). 프로덕션에서 이 약한 기본값으로 조용히 뜨면
# DB 비밀번호가 'weave'인 채 운영되므로(CFG-03/DEP-01), prod(DEBUG=false)에서는 기본값/
# 미설정/미치환 플레이스홀더를 거부한다(JWT_SECRET_KEY·ENCRYPT_KEY와 동일 패턴).
_DEFAULT_DATABASE_URL = "postgresql+asyncpg://weave:weave@db:5432/weave"
DATABASE_URL = os.getenv("DATABASE_URL", _DEFAULT_DATABASE_URL)
if not DEBUG and (not DATABASE_URL or DATABASE_URL == _DEFAULT_DATABASE_URL
                  or _PLACEHOLDER_MARK in DATABASE_URL):
    raise RuntimeError(
        "DATABASE_URL must be set with a non-default password in production "
        "(export DATABASE_URL=postgresql+asyncpg://USER:STRONG_PASSWORD@db:5432/DB)"
    )

# Alembic용 동기 URL (asyncpg -> psycopg 대신 간단하게 변환)
DATABASE_URL_SYNC = DATABASE_URL.replace("+asyncpg", "")

if DEBUG:
    # prod에서 실수로 DEBUG=true면 매 import마다 JWT 시크릿이 재생성돼 세션이 풀리고
    # /api/docs가 노출된다(CFG-05). 운영 점검을 돕기 위해 시작 시 경고를 남긴다.
    logging.getLogger("weave").warning(
        "DEBUG=true: 개발 전용 모드입니다. 프로덕션에서는 반드시 DEBUG=false로 두세요 "
        "(JWT 시크릿 자동재생성·/api/docs 노출)."
    )

# JWT — 프로덕션에서 미설정 시 멀티워커 환경에서 인증 깨짐 방지
JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "")
if not JWT_SECRET_KEY:
    if DEBUG:
        JWT_SECRET_KEY = secrets.token_hex(32)
    else:
        raise RuntimeError("JWT_SECRET_KEY must be set (export JWT_SECRET_KEY=$(openssl rand -hex 32))")
elif not DEBUG and _PLACEHOLDER_MARK in JWT_SECRET_KEY:
    raise RuntimeError("JWT_SECRET_KEY must not be the example placeholder in production")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_HOURS = int(os.getenv("JWT_EXPIRE_HOURS", "24"))  # (레거시 — access는 분 단위 사용)

# 단기 access 토큰 + 장기 refresh 토큰(SEC-29). access 만료를 짧게 둬 탈취 시 노출창을
# 줄이고, 장기 세션은 서버측 저장 refresh 토큰으로 갱신한다(로그아웃·비번재설정으로 즉시 폐기).
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))
REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "7"))

# Cookie
COOKIE_NAME = "weave_token"
REFRESH_COOKIE_NAME = "weave_refresh"
# refresh 쿠키는 /api/auth 경로에만 전송(매 요청에 실리지 않게 노출 최소화)
REFRESH_COOKIE_PATH = "/api/auth"
COOKIE_SECURE = not DEBUG
COOKIE_SAMESITE = "lax"
COOKIE_HTTPONLY = True

# Encryption — 프로덕션에서 미설정 시 민감 데이터 평문 저장 방지.
# ⚠️ 회전 주의: crypto.hash_token이 이 키로 토큰 해시를 peppering하므로, ENCRYPT_KEY를
# 교체하면 저장된 refresh 토큰·PAT 해시가 모두 검증 불가가 되어 전 사용자가 한 번 강제
# 로그아웃되고 PAT는 재발급이 필요하다. 키 회전 시 강제 재로그인 이벤트를 계획할 것.
ENCRYPT_KEY = os.getenv("ENCRYPT_KEY", "")
if not ENCRYPT_KEY:
    if DEBUG:
        ENCRYPT_KEY = "dev-only-encrypt-key"
    else:
        raise RuntimeError("ENCRYPT_KEY must be set (export ENCRYPT_KEY=$(openssl rand -hex 32))")
elif not DEBUG and _PLACEHOLDER_MARK in ENCRYPT_KEY:
    raise RuntimeError("ENCRYPT_KEY must not be the example placeholder in production")

# Frontend base URL — 비밀번호 재설정 링크 등 절대 URL 구성용.
# 미설정이면 재설정 링크는 허용된 요청 Origin(없으면 첫 허용 origin)으로 절대 URL을 만들고
# (core/controller/admin.py), 칩 링크 등은 상대경로를 쓴다.
FRONTEND_URL = os.getenv("FRONTEND_URL", "").rstrip("/")

# 비밀번호 재설정 토큰 만료 (시간)
PASSWORD_RESET_TOKEN_EXPIRE_HOURS = int(os.getenv("PASSWORD_RESET_TOKEN_EXPIRE_HOURS", "1"))

# Web Push (VAPID)
VAPID_PUBLIC_KEY = os.getenv("VAPID_PUBLIC_KEY", "")
VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY", "")
VAPID_SUBJECT = os.getenv("VAPID_SUBJECT", "mailto:admin@weave.local")

# GitHub App 연동 (PR 기반 태스크 자동 전환; 커밋 링크는 v2). 비밀번호 같은 하드요구가 아니라
# 브랜치 admin이 repo를 연결하기 전까지 기능이 꺼져 있어 빈 기본값을 허용한다. 다만
# 예제 파일을 복사하고 치환을 잊으면 잡도록, prod에서는 webhook secret의 CHANGE_ME
# 플레이스홀더를 거부한다(JWT_SECRET_KEY·ENCRYPT_KEY와 동일 안전장치).
GITHUB_APP_ID = os.getenv("GITHUB_APP_ID", "")
# private key는 멀티라인 PEM → .env/compose 안전을 위해 base64(단일행)로 받아 디코드한다.
# 생성: base64 -w0 your-app.private-key.pem  (macOS: base64 -i your-app.private-key.pem | tr -d '\n')
_GITHUB_APP_PRIVATE_KEY_B64 = os.getenv("GITHUB_APP_PRIVATE_KEY", "")
GITHUB_APP_PRIVATE_KEY = (
    base64.b64decode(_GITHUB_APP_PRIVATE_KEY_B64).decode("utf-8")
    if _GITHUB_APP_PRIVATE_KEY_B64 else ""
)
GITHUB_WEBHOOK_SECRET = os.getenv("GITHUB_WEBHOOK_SECRET", "")
if not DEBUG and GITHUB_WEBHOOK_SECRET and _PLACEHOLDER_MARK in GITHUB_WEBHOOK_SECRET:
    raise RuntimeError("GITHUB_WEBHOOK_SECRET must not be the example placeholder in production")

# WebSocket 협업 메시지 최대 크기(바이트). Yjs 업데이트/동기화는 바이너리 CRDT 인코딩이며
# 증분 업데이트는 보통 수 KB 수준이지만, 대형 프레임 반복으로 인한 메모리/CPU 고갈(DoS)을
# 막기 위해 앱 레벨 상한을 둔다(SEC-20).
# uvicorn 기본 ws_max_size(16MB)보다 보수적으로 잡되 큰 문서 초기 동기화는 통과하도록 여유.
WS_MAX_MESSAGE_BYTES = int(os.getenv("WS_MAX_MESSAGE_BYTES", str(2 * 1024 * 1024)))

# WebSocket 협업 연결의 멤버십 재검증 주기(초). 핸드셰이크 후 제거된 멤버가 편집 세션을
# 유지하지 못하도록 수신 메시지마다(스로틀) 멤버십을 재확인한다(LOG-03).
WS_MEMBERSHIP_RECHECK_SECS = int(os.getenv("WS_MEMBERSHIP_RECHECK_SECS", "30"))

# 신뢰 프록시 IP/CIDR (CFG-01). reverse proxy(nginx) 뒤에서만 X-Forwarded-For/X-Real-IP를
# 신뢰한다. 직접 피어가 이 목록 밖이면 클라이언트가 보낸 포워딩 헤더는 위조로 보고 무시해,
# 헤더 한 줄로 IP 기반 레이트리밋(로그인 5/분 등)을 우회하지 못하게 한다.
# 이 기본값(사설/루프백 전체)은 임의 토폴로지에서 곧바로 동작하기 위한 느슨한 폴백이며,
# 같은 사설망의 다른 호스트가 X-Real-IP를 위조할 여지가 있다. 그래서 프로덕션 compose는
# nginx에 정적 IP를 부여하고 TRUSTED_PROXIES를 그 IP/32로 좁혀 nginx만 신뢰하게 한다
# (docker-compose.prod.yml). backend를 공개망에 직접 노출할 때도 동일하게 좁혀야 한다.
TRUSTED_PROXIES = os.getenv(
    "TRUSTED_PROXIES",
    "127.0.0.1/32,::1/128,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16",
)
TRUSTED_PROXY_NETWORKS = []
for _cidr in TRUSTED_PROXIES.split(","):
    _cidr = _cidr.strip()
    if not _cidr:
        continue
    try:
        TRUSTED_PROXY_NETWORKS.append(ipaddress.ip_network(_cidr, strict=False))
    except ValueError:
        pass

# 전역 요청 본문 크기 상한(바이트, SEC-32). 앱 레벨에서 Content-Length를 검사해, nginx를
# 우회한 backend 직접 접근(개발/오설정)에서도 대형 본문으로 인한 메모리 고갈을 막는다.
# nginx client_max_body_size(20M)와 정합. 0 이하면 검사 비활성.
MAX_REQUEST_BODY_BYTES = int(os.getenv("MAX_REQUEST_BODY_BYTES", str(20 * 1024 * 1024)))

# 단일 DB 쿼리 최대 실행 시간(ms, SEC-33). 재귀 의존성 검사 등 병리적 쿼리가 커넥션을
# 무한 점유하지 못하도록 Postgres statement_timeout으로 강제 중단한다. 0이면 비활성.
DB_STATEMENT_TIMEOUT_MS = int(os.getenv("DB_STATEMENT_TIMEOUT_MS", "15000"))

# 비용 큰 엔드포인트 레이트리밋(SEC-11). 계정당(IP가 아니라 user_id 기준) 제한해
# 공유 NAT 환경에서 정상 사용자를 막지 않으면서 LLM 비용 증폭/집계 부하 남용을 차단한다.
# AI 채팅은 LLM API 비용이 직접 발생하므로 더 보수적으로 잡는다.
AI_CHAT_RATE_LIMIT = os.getenv("AI_CHAT_RATE_LIMIT", "20/minute")
AGGREGATE_RATE_LIMIT = os.getenv("AGGREGATE_RATE_LIMIT", "60/minute")

# AI 스트리밍 응답 누적 길이 상한(문자, SEC-27). LLM max_tokens(4096)가 1차 상한이지만,
# 오작동/변조된 LLM 엔드포인트가 무한 스트림을 보내 프론트 마크다운 렌더 CPU를 고갈시키는
# 것을 막는 백엔드 backstop. 정상 응답(보통 <16KB)보다 훨씬 크되 병리적 길이는 차단.
AI_MAX_RESPONSE_CHARS = int(os.getenv("AI_MAX_RESPONSE_CHARS", "100000"))
