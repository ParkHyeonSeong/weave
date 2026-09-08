from fastapi import Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from core.controller.auth import _create_token, _set_auth_cookie, _issue_refresh_cookie
from core.model import workspace as workspace_model
from core.model import user as user_model
from library import crypto


async def check_initialized(db: AsyncSession):
    """초기화 상태 확인.

    이 엔드포인트는 미인증으로 노출된다. 초기화 전(미설정)에는 workspace_name /
    registration_policy 등 워크스페이스 메타데이터를 일절 흘리지 않고 initialized=False
    플래그만 반환한다(정보 노출 최소화). 초기화 후에는 프론트(Header 워크스페이스명 표시
    등)가 필요로 하므로 그대로 반환한다."""
    settings = await workspace_model.get_settings(db)
    if settings:
        return {
            'status': True,
            'initialized': True,
            'workspace_name': settings['workspace_name'],
            'registration_policy': settings['registration_policy'],
            # 공용 기간(Scrum 오늘·ISO week·회고) 계산의 단일 소스. 프런트는 이 응답 하나만
            # 읽어 WorkspaceSettingsProvider에 담고, Header·Scrum이 각자 다시 조회하지 않는다.
            'time_zone': settings['time_zone'],
        }
    return {'status': True, 'initialized': False}


async def initialize(body, request: Request, response: Response, db: AsyncSession):
    """초기 설정 실행 (최초 1회).

    경합(TOCTOU) 가드: get_settings 사전 확인만으로는 동시 요청이 둘 다 "미초기화"로
    통과할 수 있다. 실제 단일 소유권은 workspace_settings 싱글톤(setting_id=1) INSERT
    가 결정한다 -- create_settings가 ON CONFLICT로 행을 삽입한 요청에만 True를 돌려준다.
    진 쪽은 방금 만든 관리자 user를 롤백해 버리고 ALREADY_INITIALIZED를 반환(500 아님)."""
    # 빠른 경로: 이미 초기화된 경우 차단 (권위적 가드는 아래 settings INSERT)
    existing = await workspace_model.get_settings(db)
    if existing:
        return {'status': False, 'message': 'ALREADY_INITIALIZED'}

    # 이메일 중복 체크
    existing_user = await user_model.find_by_email(body.email, db)
    if existing_user:
        return {'status': False, 'message': 'EMAIL_ALREADY_EXISTS'}

    # 관리자 계정 생성
    password_hash = crypto.hash_password(body.password)
    user_id = await user_model.create(body.email, password_hash, body.username, db)

    # admin 역할 부여
    await user_model.update_role(user_id, 'admin', db)

    # 첫 관리자의 개인 언어·시간대 — 관리자 생성과 같은 트랜잭션에 넣는다. 아래 settings INSERT에서
    # 경합에 지면 db.rollback()이 이 쓰기도 함께 되돌리므로 반쪽 상태가 남지 않는다.
    if getattr(body, 'language_region', None) is not None:
        await user_model.update_ui_prefs(
            user_id, {'language_region': body.language_region.model_dump()}, db)

    # 워크스페이스 설정 저장 -- 원자적 경합 가드. 졌으면 user 생성까지 되돌리고 차단.
    created = await workspace_model.create_settings(
        workspace_name=body.workspace_name,
        registration_policy=body.registration_policy,
        admin_user_id=user_id,
        db=db,
        time_zone=body.time_zone,
    )
    if not created:
        await db.rollback()
        return {'status': False, 'message': 'ALREADY_INITIALIZED'}

    # 쿠키 발급(access + refresh, SEC-29)
    token = _create_token(user_id, body.email, body.username, 'admin')
    _set_auth_cookie(response, token)
    await _issue_refresh_cookie(response, user_id, db)

    return {
        'status': True,
        'profile': {
            'user_id': user_id,
            'email': body.email,
            'username': body.username,
            'role': 'admin',
        },
    }
