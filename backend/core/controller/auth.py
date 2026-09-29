import secrets
import jwt
from datetime import datetime, timezone, timedelta
from fastapi import Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from config import (
    JWT_SECRET_KEY, JWT_ALGORITHM,
    ACCESS_TOKEN_EXPIRE_MINUTES, REFRESH_TOKEN_EXPIRE_DAYS,
    COOKIE_NAME, COOKIE_SECURE, COOKIE_SAMESITE, COOKIE_HTTPONLY,
    REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH,
)
from core.model import user as user_model
from core.model import workspace as workspace_model
from core.model import password_reset_token as reset_token_model
from core.model import refresh_token as refresh_token_model
from library import crypto
from library.client_ip import get_client_ip
from library.validator import UnAuthorizedException

# 로그인 타이밍 사이드채널 방지용 더미 해시(SEC-13-C): 존재하지 않는 이메일에도 실제
# 계정과 동일한 cost로 bcrypt를 수행해 응답 시간으로 존재를 추론하지 못하게 한다.
# 신규 해시와 같은 cost=12(crypto.hash_password)로 만들어 cost 차이도 없앤다.
# 더미와의 매칭 결과는 login의 `not user` 가드가 폐기하므로 인증에는 영향이 없다.
_DUMMY_HASH = crypto.hash_password('_dummy_never_matches_')


def _create_token(user_id: int, email: str, username: str, role: str = 'member') -> str:
    payload = {
        'user_id': user_id,
        'email': email,
        'username': username,
        'role': role,
        'exp': datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)


def _set_auth_cookie(response: Response, token: str):
    """응답에 단기 access 쿠키 설정"""
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        httponly=COOKIE_HTTPONLY,
        samesite=COOKIE_SAMESITE,
        secure=COOKIE_SECURE,
        path="/",
    )


def _clear_auth_cookie(response: Response):
    """access 쿠키 삭제"""
    response.delete_cookie(
        key=COOKIE_NAME, path="/",
        samesite=COOKIE_SAMESITE, secure=COOKIE_SECURE,
    )


async def _issue_refresh_cookie(response: Response, user_id: int, db: AsyncSession):
    """장기 refresh 토큰을 발급(DB 저장 + 쿠키 설정, SEC-29). 해시만 저장한다."""
    raw = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    await refresh_token_model.create(user_id, crypto.hash_token(raw), expires_at, db)
    response.set_cookie(
        key=REFRESH_COOKIE_NAME,
        value=raw,
        max_age=REFRESH_TOKEN_EXPIRE_DAYS * 86400,
        httponly=True,
        samesite=COOKIE_SAMESITE,
        secure=COOKIE_SECURE,
        path=REFRESH_COOKIE_PATH,
    )


def _clear_refresh_cookie(response: Response):
    response.delete_cookie(
        key=REFRESH_COOKIE_NAME, path=REFRESH_COOKIE_PATH,
        samesite=COOKIE_SAMESITE, secure=COOKIE_SECURE,
    )


async def register(body, request: Request, response: Response, db: AsyncSession):
    """회원가입 (이메일 열거 방지: SEC-13-A).

    신규 이메일과 이미 가입된 이메일에 대해 응답이 외부에서 구별 불가능하도록 한다.
    - 응답 구조: 모드별 중립 응답을 신규/기존 동일하게 반환(EMAIL_ALREADY_EXISTS 미사용).
    - 타이밍: 이메일 존재 여부와 무관하게 항상 bcrypt 해싱을 수행해 "존재 체크는 빠르고
      해싱은 느린" 차이를 제거.
    - public 모드: 자동로그인(profile/쿠키)을 하지 않는다. 신규는 active 계정을 생성하되
      쿠키를 내려주지 않고, 사용자는 로그인 화면에서 별도 로그인한다(이 UX가 비열거에 필수).
    기존 이메일이면 어떤 계정도 새로 만들지 않는다.
    """
    # 비밀번호 정책 검증 — 이메일 존재 여부와 무관하게 동일하게 거부하므로 열거/타이밍 영향 없음.
    if not body.password or len(body.password) < crypto.MIN_PASSWORD_LENGTH:
        return {'status': False, 'message': 'PASSWORD_TOO_SHORT'}

    # 초기화 여부 확인
    settings = await workspace_model.get_settings(db)
    if not settings:
        return {'status': False, 'message': 'NOT_INITIALIZED'}

    existing = await user_model.find_by_email(body.email, db)

    # 존재 여부와 무관하게 항상 해싱 수행(타이밍 사이드채널 제거). 기존 이메일이면
    # 해시는 사용하지 않고 버린다(계정 미생성).
    password_hash = await crypto.hash_password_async(body.password)

    # private 모드: 승인 대기. 신규/기존 모두 동일한 중립 응답.
    if settings['registration_policy'] == 'private':
        if not existing:
            await user_model.create(body.email, password_hash, body.username, db, status='pending')
        return {'status': True, 'pending': True, 'message': 'REGISTRATION_PENDING'}

    # public 모드: 신규는 active 계정 생성(자동로그인 없음). 신규/기존 모두 동일한 중립 응답.
    if not existing:
        await user_model.create(body.email, password_hash, body.username, db)
    return {'status': True, 'message': 'REGISTRATION_SUCCESS'}


async def login(body, request: Request, response: Response, db: AsyncSession):
    """로그인 (계정 열거·타이밍 사이드채널 방지: SEC-13-B/C).

    존재 여부와 무관하게 항상 bcrypt를 수행하고(없으면 더미 해시), 자격증명이 틀리면
    존재/상태를 구분할 수 없는 단일 INVALID_CREDENTIALS를 반환한다. 계정 상태(pending/
    rejected/inactive)는 비밀번호가 맞아 소유권이 입증된 뒤에만 공개한다.
    """
    user = await user_model.find_by_email(body.email, db)

    # 존재 여부와 무관하게 항상 bcrypt 실행 — 없는 계정엔 더미 해시로 시간을 맞춘다(SEC-13-C).
    stored_password = user['password'] if user else _DUMMY_HASH
    if user and isinstance(stored_password, memoryview):
        stored_password = bytes(stored_password)
    password_correct = await crypto.check_password(body.password, stored_password)

    # 존재하지 않거나 비밀번호가 틀리면 동일 응답 — 존재·상태를 노출하지 않는다(SEC-13-B).
    if not user or not password_correct:
        return {'status': False, 'message': 'INVALID_CREDENTIALS'}

    # 비밀번호가 맞은 뒤에만 계정 상태를 공개한다(소유권 입증됨 → UX 안전).
    if user.get('status') == 'pending':
        return {'status': False, 'message': 'ACCOUNT_PENDING'}
    if user.get('status') == 'rejected':
        return {'status': False, 'message': 'ACCOUNT_REJECTED'}
    if user.get('status') == 'inactive':
        return {'status': False, 'message': 'ACCOUNT_INACTIVE'}

    ip = get_client_ip(request)
    await user_model.update_login(user['user_id'], ip, db)

    role = user.get('role', 'member')
    token = _create_token(user['user_id'], user['email'], user['username'], role)
    _set_auth_cookie(response, token)
    await _issue_refresh_cookie(response, user['user_id'], db)

    profile = {
        'user_id': user['user_id'],
        'email': user['email'],
        'username': user['username'],
        'role': role,
        'avatar_url': user.get('avatar_url'),
        'avatar_color': user.get('avatar_color'),
    }

    # 비밀번호 변경 강제 플래그
    if user.get('must_change_password'):
        profile['must_change_password'] = True

    return {'status': True, 'profile': profile}


async def me(request: Request):
    """현재 인증 사용자 프로필 반환"""
    payload = request.state.payload
    return {
        'status': True,
        'profile': {
            'user_id': payload.get('user_id'),
            'email': payload.get('email'),
            'username': payload.get('username'),
            'role': payload.get('role'),
        },
    }


async def refresh(request: Request, response: Response, db: AsyncSession):
    """refresh 쿠키로 새 access 토큰 발급(SEC-29).

    유효한 refresh 토큰이면 새 access 쿠키를 내리고 refresh 토큰을 회전(기존 폐기+신규 발급)
    한다 — 회전으로 탈취·재사용을 탐지/제한한다. 사용자 정보는 DB에서 다시 읽어 최신 역할을
    반영한다. 토큰이 없거나 만료/폐기됐으면 401(NEED_LOGIN)."""
    raw = request.cookies.get(REFRESH_COOKIE_NAME, '')
    # 원자적 소비(DELETE...RETURNING)로 회전 — 같은 토큰 동시 사용 시 단일 승자만 통과.
    row = await refresh_token_model.consume_by_hash(crypto.hash_token(raw), db) if raw else None
    if not row:
        raise UnAuthorizedException(status=False, message='NEED_LOGIN')

    user = await user_model.find_by_id(row['user_id'], db)
    if not user or user.get('status') != 'active':
        # 비활성/삭제 계정이면 토큰은 이미 소비됐으니 그대로 거부
        raise UnAuthorizedException(status=False, message='NEED_LOGIN')

    role = user.get('role', 'member')
    access = _create_token(user['user_id'], user['email'], user['username'], role)
    _set_auth_cookie(response, access)
    await _issue_refresh_cookie(response, user['user_id'], db)
    return {'status': True}


async def logout(request: Request, response: Response, db: AsyncSession):
    """로그아웃 - access·refresh 쿠키 삭제 + 서버측 refresh 토큰 폐기"""
    raw = request.cookies.get(REFRESH_COOKIE_NAME, '')
    if raw:
        await refresh_token_model.delete_by_hash(crypto.hash_token(raw), db)
    _clear_auth_cookie(response)
    _clear_refresh_cookie(response)
    return {'status': True}


async def reset_password(body, db: AsyncSession):
    """일회용·만료 재설정 토큰으로 새 비밀번호 설정 (SEC-07, 미인증).

    토큰을 해시 매칭으로 조회(평문 미저장)하고 미만료·미사용일 때만 새 비밀번호를 설정한다.
    열거 방지를 위해 잘못된/만료/사용된 토큰은 모두 동일한 INVALID_OR_EXPIRED_TOKEN을 반환한다.
    """
    # 새 비밀번호 정책 검증 (crypto.MIN_PASSWORD_LENGTH) — 토큰을 소비하기 전에 거부한다.
    if not body.new_password or len(body.new_password) < crypto.MIN_PASSWORD_LENGTH:
        return {'status': False, 'message': 'PASSWORD_TOO_SHORT'}

    token_hash = crypto.hash_token(body.token)
    row = await reset_token_model.find_valid_by_hash(token_hash, db)
    if not row:
        return {'status': False, 'message': 'INVALID_OR_EXPIRED_TOKEN'}

    # 단일사용 처리를 먼저 시도해 경합(동시 소비)을 차단한다.
    claimed = await reset_token_model.mark_used(row['token_id'], db)
    if not claimed:
        return {'status': False, 'message': 'INVALID_OR_EXPIRED_TOKEN'}

    new_hash = await crypto.hash_password_async(body.new_password)
    await user_model.update_password(row['user_id'], new_hash, db)
    # 비밀번호 재설정 시 기존 모든 세션 무효화(SEC-29) — 탈취 세션 강제 종료
    await refresh_token_model.delete_all_for_user(row['user_id'], db)
    return {'status': True}
