"""요청 단위 '오늘' 해석 — 개인 timezone과 workspace timezone을 명확히 갈라 놓는다.

    personal_today()   개인 파생 상태용. My Tasks 연체, saved filter의 $today/$today±Nd.
                       요청자의 language_region.time_zone → workspace → UTC 순으로 폴백.

    workspace_today()  팀 공용 기간용. Scrum의 오늘·현재 ISO week·데일리 기본 day·회고 기간.
                       **개인 timezone을 절대 섞지 않는다** — 같은 board의 구성원이 서로 다른
                       scrum_week row(board_id, iso_year, iso_week)를 만들면 문서가 갈라진다.
"""
from core.model import user as user_model
from core.model import workspace as workspace_model
from library.locale_prefs import (
    FALLBACK_TIME_ZONE,
    normalize_language_region,
    normalize_time_zone,
    today_in_zone,
)


async def personal_time_zone(user_id, db) -> str:
    """요청자의 개인 timezone. 없거나 손상됐으면 workspace, 그것도 안 되면 UTC."""
    if user_id is not None:
        region = normalize_language_region(await user_model.get_language_region(user_id, db))
        if region:
            return region['time_zone']
    return normalize_time_zone(await workspace_model.get_time_zone(db)) or FALLBACK_TIME_ZONE


async def personal_today(user_id, db, now=None):
    """개인 timezone 기준 오늘(datetime.date)."""
    return today_in_zone(await personal_time_zone(user_id, db), now)


async def workspace_today(db, now=None):
    """workspace timezone 기준 오늘(datetime.date)."""
    return today_in_zone(await workspace_model.get_time_zone(db), now)
