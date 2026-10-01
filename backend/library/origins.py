"""CORS·WebSocket 공용 origin 허용 정책 단일 소스 (H-1/SEC-39, H-2/SEC-30·38).

- HTTP CORS: cors_allow_origins() / ALLOWED_ORIGIN_REGEX 를 CORSMiddleware에 넣는다.
- WebSocket: is_allowed_origin(origin, host) 로 핸드셰이크 Origin을 검증해 cross-site
  WebSocket hijacking을 막는다(쿠키 SameSite=lax의 belt-and-suspenders).

prod는 리버스 프록시 뒤에서 프론트와 API가 동일 출처이므로 Origin==Host(동일 출처)면
허용한다 → ALLOWED_ORIGINS에 자기 도메인을 굳이 넣지 않아도 정상 동작한다.
단, 비밀번호 재설정 메일 링크(core/controller/admin.py)는 FRONTEND_URL이 없으면 Host를 믿지 않고
이 허용 목록으로 주소를 정하므로, 운영에서는 ALLOWED_ORIGINS에 공개 origin을 넣어야 한다.
"""
import os
import re

from config import DEBUG

FRONTEND_PORT = os.getenv("FRONTEND_PORT", "3000")
_env = os.getenv("ALLOWED_ORIGINS")

# 명시 허용 목록(prod 권장). 설정되면 dev/prod 무관 이 목록(+동일 출처)만 신뢰한다.
ALLOWED_ORIGIN_LIST = [o.strip() for o in _env.split(",") if o.strip()] if _env else None

# 명시 목록이 없을 때의 기본 허용(루프백 표준 포트).
_DEFAULT_LOCALHOST = [
    f"http://localhost:{FRONTEND_PORT}",
    f"http://127.0.0.1:{FRONTEND_PORT}",
]

# 개발 편의: 명시 목록 없이 DEBUG면 루프백(localhost/127.0.0.1) 임의 포트를 허용한다.
# 이전엔 LAN 사설대역 전체(10/8·192.168/16·172.16/12)를 credentials와 함께 허용해 같은
# 네트워크의 다른 머신도 신뢰 대상이었다 — 루프백으로 좁혀 그 위험을 제거한다(SEC-30/38).
# LAN/외부 접근이 필요하면 ALLOWED_ORIGINS로 명시 설정한다.
# $ 앵커: fullmatch가 아닌 .match()/.search()로 재사용돼도 'localhost:3000.evil.com' 같은
# 접미사 우회를 허용하지 않도록 끝을 고정한다(footgun 방지).
_LOOPBACK_RE = re.compile(r"https?://(localhost|127\.0\.0\.1)(:\d+)?$")
ALLOWED_ORIGIN_REGEX = _LOOPBACK_RE.pattern if (DEBUG and not ALLOWED_ORIGIN_LIST) else None


def cors_allow_origins():
    """CORSMiddleware allow_origins 값(명시 목록 or 기본 localhost)."""
    return ALLOWED_ORIGIN_LIST if ALLOWED_ORIGIN_LIST else _DEFAULT_LOCALHOST


def _authority(origin: str) -> str:
    """'https://host:port' -> 'host:port'. http/https 이외 스킴은 ''로 처리해
    동일 출처 비교(authority==Host)에서 제외한다 — 'ftp://host' 류의 우회 차단."""
    if not origin.startswith(("http://", "https://")):
        return ''
    return origin.split('://', 1)[1]


def is_allowed_origin(origin: str, host: str = '') -> bool:
    """WebSocket 핸드셰이크 Origin 검증(SEC-39). 브라우저는 WS에 항상 Origin을 보내므로
    Origin 부재/불일치는 거절한다(우리 프론트는 CSWSH 벡터가 아닌 동일 출처)."""
    if not origin:
        return False
    # 동일 출처: Origin 권한부 == 요청 Host (리버스 프록시 뒤 prod 동일 출처 포함).
    if host and _authority(origin) == host:
        return True
    if ALLOWED_ORIGIN_LIST:
        return origin in ALLOWED_ORIGIN_LIST
    if DEBUG:
        return bool(_LOOPBACK_RE.fullmatch(origin))
    return origin in _DEFAULT_LOCALHOST


async def reject_ws_if_forbidden_origin(ws) -> bool:
    """WS 핸드셰이크 Origin이 허용 출처가 아니면 거절하고 True를 반환한다(SEC-39).
    호출부는 인증 전에 호출하고 True면 즉시 return — cross-site WebSocket hijacking 차단.
    accept 전 close라서 uvicorn은 이를 HTTP 403으로 응답한다(4403은 앱 레벨 의도 표시이며
    클라이언트에는 close code가 아닌 HTTP 403으로 전달된다)."""
    if not is_allowed_origin(ws.headers.get('origin', ''), ws.headers.get('host', '')):
        await ws.close(code=4403, reason="Forbidden origin")
        return True
    return False
