from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from library.locale_prefs import COMPAT_TIME_ZONE


async def get_settings(db: AsyncSession):
    """워크스페이스 설정 조회 (초기화 여부 확인)"""
    result = await db.execute(text("""
        SELECT setting_id, workspace_name, registration_policy, time_zone,
               initialized_at, initialized_by
        FROM workspace_settings
        WHERE setting_id = 1
    """))
    row = result.fetchone()
    return dict(row._mapping) if row else None


async def get_time_zone(db: AsyncSession) -> str:
    """워크스페이스 공용 timezone(IANA ID).

    Scrum의 '오늘'/ISO week, 회고 기간처럼 **모든 구성원이 같은 값을 봐야 하는** 경계에만 쓴다.
    개인 timestamp 표시나 개인 연체 계산에는 쓰지 않는다(그건 language_region.time_zone).

    미초기화(설치 직후 setup 이전) 상태에서는 마이그레이션 064의 호환값을 돌려준다 —
    호출부가 None을 폴백 분기로 따로 처리하지 않게 하려는 것이다.
    """
    result = await db.execute(text("""
        SELECT time_zone FROM workspace_settings WHERE setting_id = 1
    """))
    row = result.fetchone()
    return (row._mapping['time_zone'] if row else None) or COMPAT_TIME_ZONE


async def create_settings(workspace_name: str, registration_policy: str,
                          admin_user_id: int, db: AsyncSession,
                          time_zone: str = COMPAT_TIME_ZONE) -> bool:
    """초기 워크스페이스 설정 생성 (최초 1회만 가능).

    workspace_settings는 setting_id=1 단일행 싱글톤(PK + CHECK setting_id=1).
    동시 요청이 둘 다 "미초기화"로 통과해도, 두 번째 INSERT는 PK 충돌로 자연히
    무효화된다(ON CONFLICT DO NOTHING). 실제로 행을 삽입한 요청만 True를 받아
    관리자/워크스페이스의 단일 소유권을 보장한다(TOCTOU 경합 가드).

    time_zone은 검증된 IANA ID여야 한다(routers/schema/setup.py가 강제). 기본값은
    이전 클라이언트 호환용 Asia/Seoul — 새 프런트는 항상 명시 전송한다.

    Returns:
        True  -- 이 호출이 설정 행을 실제로 삽입함(초기화 성공)
        False -- 이미 설정이 존재해 삽입되지 않음(경합에서 진 쪽)
    """
    result = await db.execute(text("""
        INSERT INTO workspace_settings (setting_id, workspace_name, registration_policy,
                                        time_zone, initialized_by)
        VALUES (1, :workspace_name, :registration_policy, :time_zone, :admin_user_id)
        ON CONFLICT (setting_id) DO NOTHING
    """), {
        'workspace_name': workspace_name,
        'registration_policy': registration_policy,
        'time_zone': time_zone,
        'admin_user_id': admin_user_id,
    })
    return result.rowcount == 1
