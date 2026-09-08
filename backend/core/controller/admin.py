import secrets
import asyncio
import logging
from datetime import datetime, timedelta, timezone
from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger("weave.admin")

from config import FRONTEND_URL, PASSWORD_RESET_TOKEN_EXPIRE_HOURS
from core.model import user as user_model
from core.model import smtp_config as smtp_config_model
from core.model import password_reset_token as reset_token_model
from core.model import workspace as workspace_model
from library.locale_prefs import COMPAT_TIME_ZONE
from library import smtp_client, crypto, messages
from library.locale_prefs import normalize_language_region

RESET_TOKEN_BYTES = 32
RESET_PATH = "/auth/reset"


async def _user_locale(user_id, db: AsyncSession) -> str:
    """이메일 수신자의 표시 언어. 설정이 없거나 손상됐으면 en."""
    if user_id is None:
        return messages.DEFAULT_LOCALE
    region = normalize_language_region(await user_model.get_language_region(user_id, db))
    return messages.normalize_locale(region['locale'] if region else None)


def _build_reset_link(raw_token: str) -> str:
    """재설정 링크 구성. FRONTEND_URL이 있으면 절대 URL, 없으면 상대경로."""
    path = f"{RESET_PATH}?token={raw_token}"
    return f"{FRONTEND_URL}{path}" if FRONTEND_URL else path


async def create_user(body, request: Request, db: AsyncSession):
    """관리자가 수동으로 사용자 생성"""
    existing = await user_model.find_by_email(body.email, db)
    if existing:
        return {'status': False, 'message': 'EMAIL_ALREADY_EXISTS'}

    password_hash = crypto.hash_password(body.password)
    user_id = await user_model.create(body.email, password_hash, body.username, db)

    if body.role == 'admin':
        await user_model.update_role(user_id, 'admin', db)

    return {'status': True, 'user_id': user_id}


async def list_users(request: Request, db: AsyncSession):
    """전체 사용자 목록 조회"""
    users = await user_model.find_all(db)
    return {'status': True, 'users': users}


async def update_user_role(user_id: int, body, request: Request, db: AsyncSession):
    """사용자 역할 변경"""
    admin_id = request.state.payload.get('user_id')

    # 자기 자신의 역할은 변경 불가
    if user_id == admin_id:
        return {'status': False, 'message': 'CANNOT_CHANGE_OWN_ROLE'}

    target = await user_model.find_by_id(user_id, db)
    if not target:
        return {'status': False, 'message': 'USER_NOT_FOUND'}

    await user_model.update_role(user_id, body.role, db)
    return {'status': True}


async def update_user_status(user_id: int, body, request: Request, db: AsyncSession):
    """사용자 상태 변경 (승인/거부)"""
    admin_id = request.state.payload.get('user_id')

    # 자기 자신의 상태는 변경 불가
    if user_id == admin_id:
        return {'status': False, 'message': 'CANNOT_CHANGE_OWN_STATUS'}

    target = await user_model.find_by_id(user_id, db)
    if not target:
        return {'status': False, 'message': 'USER_NOT_FOUND'}

    await user_model.update_status(user_id, body.status, db)
    return {'status': True}


async def reset_user_password(user_id: int, body, request: Request, db: AsyncSession):
    """사용자 비밀번호 초기화 — 일회용·만료 재설정 링크 발급(SEC-07).

    임시 평문 비밀번호를 더 이상 생성/반환하지 않는다. 대신 secrets로 토큰을 생성하고
    해시만 저장(at-rest)한 뒤, 사용자가 직접 새 비밀번호를 설정하는 단일사용 링크를 발급한다.
    SMTP가 설정돼 있으면 링크를 이메일로 발송하고, 미설정이면 링크/토큰을 관리자에게 반환한다
    (단일사용+만료라 평문 비밀번호보다 위험이 훨씬 낮다)."""
    admin_id = request.state.payload.get('user_id')

    # 자기 자신의 비밀번호는 초기화 불가
    if user_id == admin_id:
        return {'status': False, 'message': 'CANNOT_RESET_OWN_PASSWORD'}

    target = await user_model.find_by_id(user_id, db)
    if not target:
        return {'status': False, 'message': 'USER_NOT_FOUND'}

    # 일회용 재설정 토큰 생성 — 평문은 한 번만 노출하고 해시로 저장한다(PAT 동일 패턴).
    raw_token = "rst_" + secrets.token_urlsafe(RESET_TOKEN_BYTES)
    token_hash = crypto.hash_token(raw_token)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=PASSWORD_RESET_TOKEN_EXPIRE_HOURS)
    await reset_token_model.create(token_hash, user_id, expires_at, db)

    # 사용자가 링크에서 직접 새 비번을 설정하므로 must_change_password는 불필요 — 해제해 둔다.
    await user_model.set_must_change_password(user_id, False, db)

    reset_link = _build_reset_link(raw_token)

    # SMTP 설정이 있으면 링크를 이메일로 발송
    smtp_config = await smtp_config_model.get_config_for_sending(db)
    if smtp_config:
        # 수신자가 정해진 메일이므로 **그 사용자의 언어**로 렌더한다(관리자 언어가 아니다).
        locale = await _user_locale(user_id, db)
        email_html = smtp_client.email_shell(
            f'<h2 style="color:#5E6AD2;margin-bottom:16px;">'
            f'{messages.render(locale, "email.passwordReset.heading")}</h2>'
            f'<p style="color:#333;line-height:1.6;">'
            f'{messages.render(locale, "email.passwordReset.body")}<br>'
            f'{messages.render(locale, "email.passwordReset.expiry", hours=PASSWORD_RESET_TOKEN_EXPIRE_HOURS)}</p>'
            f'<div style="text-align:center;margin:24px 0;">'
            f'<a href="{reset_link}" style="display:inline-block;background:#5E6AD2;color:#fff;'
            f'text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:bold;">'
            f'{messages.render(locale, "email.passwordReset.button")}</a></div>'
            f'<p style="color:#999;font-size:12px;line-height:1.6;">'
            f'{messages.render(locale, "email.passwordReset.ignore")}</p>'
            '<hr style="border:none;border-top:1px solid #E5E5E5;margin:24px 0;">'
            f'<p style="color:#999;font-size:12px;">{messages.render(locale, "email.footer")}</p>'
        )
        try:
            asyncio.create_task(
                smtp_client.send_email(smtp_config, [target['email']],
                                       messages.render(locale, 'email.passwordReset.subject'),
                                       email_html)
            )
            return {'status': True, 'email_sent': True}
        except Exception as e:
            logger.error("Failed to send reset email: %s", e)
            # 발송 실패 시 평문 비밀번호가 아니라 단일사용 링크/토큰을 관리자에게 반환
            return {'status': True, 'email_sent': False,
                    'reset_link': reset_link, 'reset_token': raw_token}

    # SMTP 미설정: 단일사용 링크/토큰을 관리자에게 반환 (평문 비밀번호 아님)
    return {'status': True, 'email_sent': False,
            'reset_link': reset_link, 'reset_token': raw_token}


# ── SMTP 설정 ────────────────────────────────────────────────────────────

async def get_smtp_config(request: Request, db: AsyncSession):
    """SMTP 설정 조회"""
    config = await smtp_config_model.get_config(db)
    if not config:
        return {'status': True, 'config': None}
    return {'status': True, 'config': config}


async def save_smtp_config(body, request: Request, db: AsyncSession):
    """SMTP 설정 저장"""
    admin_id = request.state.payload.get('user_id')
    config = await smtp_config_model.upsert_config(
        smtp_host=body.smtp_host,
        smtp_port=body.smtp_port,
        smtp_user=body.smtp_user,
        smtp_password=body.smtp_password,
        sender_email=body.sender_email,
        sender_name=body.sender_name,
        use_tls=body.use_tls,
        updated_by=admin_id,
        db=db,
    )
    if not config:
        return {'status': False, 'message': 'SMTP_PASSWORD_REQUIRED'}
    return {'status': True, 'config': config}


async def test_smtp(body, request: Request, db: AsyncSession):
    """SMTP 테스트 이메일 발송"""
    config = await smtp_config_model.get_config_for_sending(db)
    if not config:
        return {'status': False, 'message': 'SMTP_NOT_CONFIGURED'}

    # 테스트 메일은 요청한 관리자가 읽는다 — 관리자의 언어로 보낸다.
    locale = await _user_locale(request.state.payload.get('user_id'), db)
    result = await smtp_client.send_test_email(config, body.test_email, locale)
    return result


# ── 사용자 삭제 ──────────────────────────────────────────────────────────

async def delete_user(user_id: int, request: Request, db: AsyncSession):
    """사용자 소프트 삭제"""
    admin_id = request.state.payload.get('user_id')

    if user_id == admin_id:
        return {'status': False, 'message': 'CANNOT_DELETE_SELF'}

    target = await user_model.find_by_id(user_id, db)
    if not target:
        return {'status': False, 'message': 'USER_NOT_FOUND'}

    await user_model.soft_delete(user_id, db)
    return {'status': True}


# ── 워크스페이스 설정 ─────────────────────────────────────────────────────────

async def get_workspace_settings(request: Request, db: AsyncSession):
    """관리자용 워크스페이스 설정 조회 — 공용 timezone 포함."""
    settings = await workspace_model.get_settings(db)
    if not settings:
        return {'status': False, 'message': 'NOT_INITIALIZED'}
    return {
        'status': True,
        'workspace_name': settings['workspace_name'],
        'time_zone': settings['time_zone'] or COMPAT_TIME_ZONE,
    }


async def update_workspace_time_zone(body, request: Request, db: AsyncSession):
    """워크스페이스 공용 timezone 변경(관리자 전용).

    앞으로의 Scrum 주차·회고 기간·스프린트 기본 날짜만 이 값을 따른다. 이미 저장된
    date-only 값은 그대로 둔다(소급 변환 금지).
    """
    if not await workspace_model.update_time_zone(body.time_zone, db):
        return {'status': False, 'message': 'NOT_INITIALIZED'}
    return {'status': True, 'time_zone': body.time_zone}
