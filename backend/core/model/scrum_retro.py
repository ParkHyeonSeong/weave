from datetime import date, timedelta

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

_EPOCH_MONDAY = date(2000, 1, 3)  # 알려진 월요일 기준점 (주 그룹 정렬용)
_COLS = "retro_id, board_id, period_start, period_end, template, status, yjs_updated_at"


def _monday_of(d: date) -> date:
    return d - timedelta(days=d.weekday())  # weekday(): Mon=0


def _add_months(d: date, months: int) -> date:
    """월 단위 이동 후 그 달 1일 반환 (월간 주기 이웃 계산용)."""
    total = d.year * 12 + (d.month - 1) + months
    y, m = divmod(total, 12)
    return date(y, m + 1, 1)


def _period_weeks(cadence: str, interval_weeks) -> int:
    """주 단위 주기의 한 기간 길이(주). weekly=1, biweekly=2, every_n_weeks=N(≥2)."""
    return 1 if cadence == 'weekly' else (2 if cadence == 'biweekly'
                                          else max(2, int(interval_weeks or 2)))


def compute_period(cadence: str, interval_weeks, anchor_weekday: int, today: date):
    """today가 속한 회고 기간 (period_start, period_end). manual이면 None."""
    if cadence == 'manual':
        return None
    if cadence == 'monthly':
        start = today.replace(day=1)
        return start, _add_months(start, 1) - timedelta(days=1)
    n = _period_weeks(cadence, interval_weeks)
    monday = _monday_of(today)
    weeks_since = (monday - _EPOCH_MONDAY).days // 7
    group_first = (weeks_since // n) * n
    start = _EPOCH_MONDAY + timedelta(weeks=group_first)
    last_monday = start + timedelta(weeks=n - 1)
    return start, last_monday + timedelta(days=anchor_weekday)


def neighbor_anchors(cadence: str, interval_weeks, anchor_weekday: int, target_date: date):
    """target_date가 속한 기간의 직전·직후 기간 안에 드는 앵커 날짜 (prev, next).
    이 날짜를 다시 compute_period에 넣으면 이웃 기간이 나온다 — 가변 길이·주말 갭을
    프론트가 몰라도 되도록 백엔드가 이동 앵커를 계산해 준다. manual이면 (None, None)."""
    period = compute_period(cadence, interval_weeks, anchor_weekday, target_date)
    if period is None:
        return None, None
    start, _ = period
    prev = start - timedelta(days=1)            # 시작 하루 전 = 반드시 직전 기간 안
    if cadence == 'monthly':
        nxt = _add_months(start, 1)             # 다음 달 1일
    else:
        nxt = start + timedelta(weeks=_period_weeks(cadence, interval_weeks))  # 다음 그룹 첫 월요일
    return prev, nxt


async def _ensure_retro(board_id: int, start: date, end: date, db: AsyncSession) -> dict:
    """(board, period_start) 회고 행을 보장하고 dict 반환. 읽기 우선·동시생성 안전."""
    sel = text(f"SELECT {_COLS} FROM scrum_retro WHERE board_id=:b AND period_start=:s")
    p = {'b': board_id, 's': start}
    row = (await db.execute(sel, p)).fetchone()
    if row:
        return dict(row._mapping)
    await db.execute(text("""
        INSERT INTO scrum_retro (board_id, period_start, period_end, template, status)
        VALUES (:b, :s, :e, 'kpt', 'open')
        ON CONFLICT (board_id, period_start) DO NOTHING
    """), {'b': board_id, 's': start, 'e': end})
    row = (await db.execute(sel, p)).fetchone()
    return dict(row._mapping)


async def get_or_create_for_date(board_id: int, cadence: str, interval_weeks,
                                 anchor_weekday: int, target_date: date, db: AsyncSession):
    """target_date가 속한 기간 회고를 보장하고 dict 반환. manual이면 None(자동 생성 안 함)."""
    period = compute_period(cadence, interval_weeks, anchor_weekday, target_date)
    if period is None:
        return None
    return await _ensure_retro(board_id, period[0], period[1], db)


async def get_or_create_current(board_id: int, cadence: str, interval_weeks,
                                anchor_weekday: int, today: date, db: AsyncSession):
    """현재 기간 회고를 보장하고 dict 반환. manual이면 None(자동 생성 안 함).
    get_or_create_for_date(target=today) 위임 — '현재' 의미를 이름으로 보존하는 얇은 래퍼."""
    return await get_or_create_for_date(board_id, cadence, interval_weeks,
                                        anchor_weekday, today, db)


async def find_by_period(board_id: int, period_start: date, db: AsyncSession) -> dict | None:
    """(board, period_start)의 회고 메타 dict 반환. 없으면 None."""
    row = (await db.execute(text(
        "SELECT retro_id, status FROM scrum_retro WHERE board_id=:b AND period_start=:s"),
        {'b': board_id, 's': period_start})).fetchone()
    return dict(row._mapping) if row else None


async def find_by_id(retro_id: int, db: AsyncSession):
    row = (await db.execute(text(f"SELECT {_COLS} FROM scrum_retro WHERE retro_id=:r"),
                            {'r': retro_id})).fetchone()
    return dict(row._mapping) if row else None


async def list_by_board(board_id: int, db: AsyncSession):
    res = await db.execute(text(f"""
        SELECT {_COLS} FROM scrum_retro WHERE board_id=:b ORDER BY period_start DESC
    """), {'b': board_id})
    return [dict(r._mapping) for r in res.fetchall()]


async def get_yjs_state(retro_id: int, db: AsyncSession, for_update: bool = False) -> bytes | None:
    # for_update: scrum_week.get_yjs_state와 같다(방 입장·방 없는 REST 쓰기가 행을 잠그고 읽는다).
    lock = " FOR UPDATE" if for_update else ""
    row = (await db.execute(text(f"SELECT yjs_state FROM scrum_retro WHERE retro_id=:r{lock}"),
                            {'r': retro_id})).fetchone()
    return row[0] if row else None


async def save_yjs_state(retro_id: int, yjs_state: bytes, db: AsyncSession):
    await db.execute(text("""
        UPDATE scrum_retro SET yjs_state=:y, yjs_updated_at=NOW(), updated_at=NOW()
        WHERE retro_id=:r
    """), {'r': retro_id, 'y': yjs_state})
