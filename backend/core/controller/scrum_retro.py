from datetime import date

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from core.errors import error_response, ErrorCode
from core.model import scrum_board as board_model
from core.model import scrum_member as member_model
from core.model import scrum_retro as retro_model
from library.scrum_cells import read_cells, write_cell_into_doc
from library.time_context import workspace_today
from library.ws_collab_manager import scrum_retro_collab_manager
from routers.schema.scrum_cell import VALID_MODES, VALID_RETRO_KEYS, RetroCellWrite

# 회고 기간은 board 구성원 전원이 같은 period_start/period_end를 봐야 하므로 workspace
# timezone으로만 계산한다. 개인 language_region.time_zone은 여기 절대 섞지 않는다 —
# 섞으면 같은 board에서 사용자마다 다른 회고 행이 만들어진다.


async def _require_member(board_id: int, request: Request, db: AsyncSession):
    board = await board_model.find_by_id(board_id, db)
    if not board:
        return None, error_response(ErrorCode.BOARD_NOT_FOUND)
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(board_id, user_id, db):
        return None, error_response(ErrorCode.PERMISSION_DENIED)
    return board, None


async def get_current(board_id: int, request: Request, db: AsyncSession):
    """현재 기간 회고 보장/반환. manual이면 retro=None(목록에서 수동 생성)."""
    board, err = await _require_member(board_id, request, db)
    if err:
        return err
    retro = await retro_model.get_or_create_current(
        board_id, board['retro_cadence'], board['retro_interval_weeks'],
        board['retro_anchor_weekday'], await workspace_today(db), db)
    return {'status': True, 'retro': retro}


async def get_period(board_id: int, request: Request, db: AsyncSession,
                     target: date | None = None):
    """앵커 날짜(target, 기본=workspace timezone의 오늘)가 속한 회고 기간을 보장/반환.
    이전·다음 기간 이동 앵커(prev_date/next_date)와 현재 기간 여부(is_current)도 함께 준다.
    manual 주기면 retro=None(자동 회고 없음)."""
    board, err = await _require_member(board_id, request, db)
    if err:
        return err
    cadence = board['retro_cadence']
    interval = board['retro_interval_weeks']
    anchor_weekday = board['retro_anchor_weekday']
    when = target or await workspace_today(db)
    retro = await retro_model.get_or_create_for_date(
        board_id, cadence, interval, anchor_weekday, when, db)
    if retro is None:
        return {'status': True, 'retro': None,
                'prev_date': None, 'next_date': None, 'is_current': True}
    prev_date, next_date = retro_model.neighbor_anchors(
        cadence, interval, anchor_weekday, when)
    today_period = retro_model.compute_period(
        cadence, interval, anchor_weekday, await workspace_today(db))
    return {
        'status': True,
        'retro': retro,
        'prev_date': prev_date.isoformat() if prev_date else None,
        'next_date': next_date.isoformat() if next_date else None,
        'is_current': bool(today_period and today_period[0] == retro['period_start']),
    }


async def list_retros(board_id: int, request: Request, db: AsyncSession):
    board, err = await _require_member(board_id, request, db)
    if err:
        return err
    return {'status': True, 'retros': await retro_model.list_by_board(board_id, db)}


async def get_retro_cells(board_id: int, retro_id: int, request: Request, db: AsyncSession):
    """회고 KPT 셀(멤버×keep/problem/try) 내용을 평문으로 반환. 멤버 전용."""
    _, err = await _require_member(board_id, request, db)
    if err:
        return err
    retro = await retro_model.find_by_id(retro_id, db)
    if not retro or retro['board_id'] != board_id:
        return error_response(ErrorCode.RETRO_NOT_FOUND)
    members = await member_model.find_by_board(board_id, db)
    keys = [f"{m['user_id']}:{k}" for m in members for k in VALID_RETRO_KEYS]
    state = await scrum_retro_collab_manager.snapshot_state(retro_id, db)
    return {'status': True, 'retro': retro, 'cells': read_cells(state, keys)}


async def write_retro_cell(board_id: int, retro_id: int, body: RetroCellWrite,
                           request: Request, db: AsyncSession):
    """토큰 주체 본인의 회고 KPT 셀 1개를 쓴다. 멤버 전용."""
    _, err = await _require_member(board_id, request, db)
    if err:
        return err
    retro = await retro_model.find_by_id(retro_id, db)
    if not retro or retro['board_id'] != board_id:
        return error_response(ErrorCode.RETRO_NOT_FOUND)
    if body.key not in VALID_RETRO_KEYS or body.mode not in VALID_MODES:
        return error_response(ErrorCode.INVALID_CELL)
    user_id = request.state.payload.get('user_id')
    key = f"{user_id}:{body.key}"  # 본인 강제
    await scrum_retro_collab_manager.apply_external_mutation(
        retro_id,
        lambda doc: write_cell_into_doc(doc, key, body.text, body.mode),
        db)
    return {'status': True, 'retro_id': retro_id, 'cell': key}
