from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from core.errors import error_response, ErrorCode
from core.model import activity_log as log_model
from core.model import branch_member as member_model
from core.model import canvas_member as canvas_member_model
from core.guard.branch_scope import find_resource_in_branch
from library import activity_service


async def get_task_activity(task_id: int, branch_id: int, limit: int, offset: int,
                            request: Request, db: AsyncSession):
    """Task 활동 이력"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return error_response(ErrorCode.NOT_BRANCH_MEMBER)

    # task가 정말 이 branch 소속인지 검증 — 다른 branch task의 활동 열람 방지(LOG-11)
    if not await find_resource_in_branch(task_id, branch_id, 'task', db):
        return error_response(ErrorCode.TASK_NOT_FOUND)

    activities = await log_model.find_by_entity('task', task_id, limit, offset, db)
    # 구버전 행(status·task_type 라벨 없음)을 현재 설정으로 보강 — branch당 1회 조회.
    activities = await activity_service.backfill_missing_key_labels(activities, branch_id, db)
    return {'status': True, 'activities': activities}


async def get_branch_activity(branch_id: int, limit: int, offset: int,
                              request: Request, db: AsyncSession):
    """브랜치 전체 활동 피드"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return error_response(ErrorCode.NOT_BRANCH_MEMBER)

    activities = await log_model.find_by_branch(branch_id, limit, offset, db)
    # task 활동과 같은 규칙으로 보강한다(같은 행을 두 화면에서 다르게 보여주지 않는다).
    activities = await activity_service.backfill_missing_key_labels(activities, branch_id, db)
    return {'status': True, 'activities': activities}


async def get_canvas_page_activity(canvas_id: int, page_id: int, limit: int, offset: int,
                                   request: Request, db: AsyncSession):
    """Canvas 페이지 활동 이력"""
    user_id = request.state.payload.get('user_id')
    if not await canvas_member_model.is_member(canvas_id, user_id, db):
        return error_response(ErrorCode.NOT_CANVAS_MEMBER)

    # page가 이 canvas 소속인지 검증 — 다른 canvas page의 활동 열람 방지(LOG-11).
    # 캔버스 페이지 접근은 branch가 아니라 canvas 멤버십으로 가드하므로(위 is_member),
    # branch 스코프 없이(branch_id=None) 페이지를 가져온 뒤 canvas_id 일치만 확인한다.
    page = await find_resource_in_branch(page_id, None, 'canvas_page', db)
    if not page or page['canvas_id'] != canvas_id:
        return error_response(ErrorCode.PAGE_NOT_FOUND)

    activities = await log_model.find_by_entity('canvas_page', page_id, limit, offset, db)
    return {'status': True, 'activities': activities}


async def get_canvas_activity(canvas_id: int, limit: int, offset: int,
                              request: Request, db: AsyncSession):
    """캔버스 전체 활동 피드"""
    user_id = request.state.payload.get('user_id')
    if not await canvas_member_model.is_member(canvas_id, user_id, db):
        return error_response(ErrorCode.NOT_CANVAS_MEMBER)

    activities = await log_model.find_by_canvas(canvas_id, limit, offset, db)
    return {'status': True, 'activities': activities}
