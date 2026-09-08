from datetime import date, timedelta

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from core.model import scrum_board as board_model
from core.model import scrum_retro as retro_model
from core.model import scrum_week as week_model
from library.scrum_cells import cell_has_content
from library.time_context import workspace_today


async def home_cards(request: Request, db: AsyncSession):
    """홈 조건부 카드: 오늘 미작성 보드 + 회고 due 보드."""
    user_id = request.state.payload.get('user_id')
    # 공용 기간이므로 workspace timezone. 같은 board를 보는 서울/뉴욕 구성원이 같은 주차와
    # 같은 '오늘 미작성' 판정을 받아야 한다.
    return await collect_cards(user_id, await workspace_today(db), db)


async def collect_cards(user_id: int, today: date, db: AsyncSession):
    """결정적 집계 (today 주입). today_pending + retro_due 계산."""
    weekday = today.weekday()  # Mon=0 .. Sun=6
    iso_year, iso_week, _ = today.isocalendar()
    boards = await board_model.find_accessible(user_id, db)

    today_pending = []
    retro_due = []

    for b in boards:
        bid = b['board_id']
        # --- today_pending (주말 제외) ---
        if weekday <= 4:
            wk = await week_model.find_by_week(bid, iso_year, iso_week, db)
            state = await week_model.get_yjs_state(wk['week_id'], db) if wk else None
            if not cell_has_content(state, f"{user_id}:{weekday}:plan"):
                today_pending.append({'board_id': bid, 'name': b['name'], 'color': b['color']})
        # --- retro_due ---
        period = retro_model.compute_period(
            b['retro_cadence'], b['retro_interval_weeks'], b['retro_anchor_weekday'], today)
        if period:
            start, end = period
            # monthly는 마지막 날(end)에만 1일 노출되지 않도록 월 마지막 7일 창을 사용.
            due_from = end - timedelta(days=6) if b['retro_cadence'] == 'monthly' else end
            if today >= due_from:  # 회고 시점 도달
                existing = await retro_model.find_by_period(bid, start, db)
                if not existing or existing['status'] != 'done':
                    retro_due.append({'board_id': bid, 'name': b['name'], 'color': b['color'],
                                      'period_start': start.isoformat(), 'period_end': end.isoformat()})

    return {'status': True, 'today_pending': today_pending, 'retro_due': retro_due}
