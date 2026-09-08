from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from core.errors import error_response, ErrorCode
from core.guard.branch_scope import find_resource_in_branch
from core.model import sprint as sprint_model
from core.model import branch_member as member_model
from core.model import task as task_model
from library.date_validator import is_valid_date_order
from library.time_context import workspace_today


async def create(body, branch_id: int, request: Request, db: AsyncSession):
    """Sprint 생성"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return error_response(ErrorCode.NOT_BRANCH_MEMBER)

    if not is_valid_date_order(body.start_date, body.end_date):
        return error_response(ErrorCode.INVALID_DATE_RANGE)

    sprint_id = await sprint_model.create(
        branch_id=branch_id,
        sprint_name=body.sprint_name,
        goal=body.goal,
        start_date=body.start_date,
        end_date=body.end_date,
        created_by=user_id,
        db=db,
    )
    return {'status': True, 'sprint_id': sprint_id}


async def get_list(branch_id: int, request: Request, db: AsyncSession):
    """Sprint 목록"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return error_response(ErrorCode.NOT_BRANCH_MEMBER)

    sprints = await sprint_model.find_by_branch(branch_id, db)
    return {'status': True, 'sprints': sprints}


async def update(sprint_id: int, body, branch_id: int, request: Request, db: AsyncSession):
    """Sprint 수정"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return error_response(ErrorCode.NOT_BRANCH_MEMBER)

    sprint = await sprint_model.find_by_id(sprint_id, db)
    if not sprint or sprint['branch_id'] != branch_id:
        return error_response(ErrorCode.SPRINT_NOT_FOUND)

    fields = body.model_dump(exclude_none=True)
    # 명시적 null로 보낸 날짜만 clear 허용 (NOT NULL 컬럼의 null은 위에서 드롭됨)
    for f in ('start_date', 'end_date'):
        if f in body.model_fields_set and getattr(body, f) is None:
            fields[f] = None
    new_start = fields.get('start_date', sprint['start_date'])
    new_end = fields.get('end_date', sprint['end_date'])
    if not is_valid_date_order(new_start, new_end):
        return error_response(ErrorCode.INVALID_DATE_RANGE)

    await sprint_model.update(sprint_id, fields, db)
    return {'status': True}


async def delete(sprint_id: int, branch_id: int, request: Request, db: AsyncSession):
    """Sprint 삭제"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return error_response(ErrorCode.NOT_BRANCH_MEMBER)

    sprint = await sprint_model.find_by_id(sprint_id, db)
    if not sprint or sprint['branch_id'] != branch_id:
        return error_response(ErrorCode.SPRINT_NOT_FOUND)

    await sprint_model.delete(sprint_id, db)
    return {'status': True}


async def start(sprint_id: int, branch_id: int, request: Request, db: AsyncSession):
    """Sprint 시작 (future → active)"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return error_response(ErrorCode.NOT_BRANCH_MEMBER)

    sprint = await sprint_model.find_by_id(sprint_id, db)
    if not sprint or sprint['branch_id'] != branch_id:
        return error_response(ErrorCode.SPRINT_NOT_FOUND)

    if sprint['status'] != 'future':
        return error_response(ErrorCode.SPRINT_NOT_FUTURE)

    # 태스크가 없으면 시작 불가
    counts = await task_model.count_by_sprint_status(sprint_id, db)
    if counts['done_count'] + counts['incomplete_count'] == 0:
        return error_response(ErrorCode.SPRINT_EMPTY)

    fields = {'status': 'active'}
    if not sprint['start_date']:
        # 스프린트 날짜는 구성원이 공유하는 저장 값 → workspace timezone의 오늘.
        # 서버/컨테이너 로컬 날짜(date.today())를 쓰면 UTC 컨테이너에서 하루 어긋난다.
        fields['start_date'] = await workspace_today(db)

    await sprint_model.update(sprint_id, fields, db)
    return {'status': True}


async def complete(sprint_id: int, body, branch_id: int, request: Request, db: AsyncSession):
    """Sprint 완료 (active → closed), 미완료 task 이동"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return error_response(ErrorCode.NOT_BRANCH_MEMBER)

    sprint = await sprint_model.find_by_id(sprint_id, db)
    if not sprint or sprint['branch_id'] != branch_id:
        return error_response(ErrorCode.SPRINT_NOT_FOUND)

    if sprint['status'] != 'active':
        return error_response(ErrorCode.SPRINT_NOT_ACTIVE)

    # 미완료 task 이동
    to_sprint_id = None
    if body.move_to and body.move_to != 'backlog':
        # 형식 검증: sprint_id는 양의 정수이므로 isdigit()이면 충분.
        # 비숫자('abc')·음수('-1')·공백·소수점 등은 int() 호출 전에 거부(500 방지).
        if not body.move_to.isdigit():
            return error_response(ErrorCode.INVALID_MOVE_TARGET)
        to_sprint_id = int(body.move_to)
        # cross-branch IDOR 방어: 이월 대상 sprint가 현재 branch 소속인지 검증
        if not await find_resource_in_branch(to_sprint_id, branch_id, 'sprint', db):
            return error_response(ErrorCode.TARGET_SPRINT_NOT_FOUND)

    moved = await task_model.move_incomplete(sprint_id, to_sprint_id, db)

    # sprint 상태 변경
    fields = {'status': 'closed'}
    if not sprint['end_date']:
        # 시작일과 같은 정책 — 공유 날짜는 workspace timezone 기준이다.
        fields['end_date'] = await workspace_today(db)

    await sprint_model.update(sprint_id, fields, db)
    return {'status': True, 'moved_count': moved}


async def reorder(body, branch_id: int, request: Request, db: AsyncSession):
    """Sprint 순서 변경"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return error_response(ErrorCode.NOT_BRANCH_MEMBER)

    await sprint_model.reorder(branch_id, body.sprint_ids, db)
    return {'status': True}


async def get_task_counts(sprint_id: int, branch_id: int, request: Request, db: AsyncSession):
    """Sprint 내 완료/미완료 task 수 조회"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return error_response(ErrorCode.NOT_BRANCH_MEMBER)

    counts = await task_model.count_by_sprint_status(sprint_id, db)
    return {'status': True, **counts}
