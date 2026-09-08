"""Task 서브리소스(label/assignee/custom field) 부분 add/remove 컨트롤러.

update_task의 전체 replace를 건드리지 않고, 단일 항목을 안전하게
추가/제거/설정하는 전용 경로. 모든 라우트가 get_task_in_branch_or_error로
cross-branch IDOR를 먼저 차단한다.
"""
from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from core.errors import ErrorCode, error_response
from core.model import task as task_model
from core.model import branch_member as member_model
from core.model import task_type_config as type_model
from library import activity_service
from library import notification_service
from library.custom_field_validator import validate_custom_field_values
from library.assignee_cascade import cascade_main_assignee_to_subtasks, main_of


async def get_task_in_branch_or_error(task_id: int, branch_id: int, request: Request, db: AsyncSession):
    """(task, None) 성공 / (None, error_dict) 실패. 멤버십 + task-branch 소속 검증."""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return None, error_response(ErrorCode.NOT_BRANCH_MEMBER)
    task = await task_model.find_by_id(task_id, db)
    if not task or task['branch_id'] != branch_id:
        return None, error_response(ErrorCode.TASK_NOT_FOUND)
    return task, None


async def add_task_label(task_id: int, label_id: int, branch_id: int, request: Request, db: AsyncSession):
    """Task에 라벨 하나 추가(기존 라벨 유지)."""
    task, err = await get_task_in_branch_or_error(task_id, branch_id, request, db)
    if err:
        return err
    if await task_model.count_label_ids_in_branch(branch_id, [label_id], db) != 1:
        return error_response(ErrorCode.LABEL_NOT_FOUND)
    user_id = request.state.payload.get('user_id')
    old_labels = task.get('labels') or []
    await task_model.add_label(task_id, label_id, db)
    updated = await task_model.find_by_id(task_id, db)
    await activity_service.log_task_label_change(
        task_id, branch_id, user_id, old_labels, updated.get('labels') or [], db)
    return {'status': True}


async def remove_task_label(task_id: int, label_id: int, branch_id: int, request: Request, db: AsyncSession):
    """Task에서 라벨 하나 제거."""
    task, err = await get_task_in_branch_or_error(task_id, branch_id, request, db)
    if err:
        return err
    if await task_model.count_label_ids_in_branch(branch_id, [label_id], db) != 1:
        return error_response(ErrorCode.LABEL_NOT_FOUND)
    user_id = request.state.payload.get('user_id')
    old_labels = task.get('labels') or []
    await task_model.remove_label(task_id, label_id, db)
    updated = await task_model.find_by_id(task_id, db)
    await activity_service.log_task_label_change(
        task_id, branch_id, user_id, old_labels, updated.get('labels') or [], db)
    return {'status': True}


async def add_task_assignee(task_id: int, user_id_to_add: int, role: str,
                            branch_id: int, request: Request, db: AsyncSession):
    """Task에 담당자 하나 추가/전이(결정 B 전이 표). role은 'sub'(기본) 또는 'main'."""
    task, err = await get_task_in_branch_or_error(task_id, branch_id, request, db)
    if err:
        return err
    if not await member_model.is_member(branch_id, user_id_to_add, db):
        return error_response(ErrorCode.INVALID_ASSIGNEE)

    old = task.get('assignees') or []
    current_role = {a['user_id']: a['role'] for a in old}.get(user_id_to_add)
    actor_id = request.state.payload.get('user_id')

    if role == 'sub':
        if current_role == 'main':
            return error_response(ErrorCode.INVALID_ASSIGNEE)  # 의도 모호 차단(결정 B)
        if current_role == 'sub':
            return {'status': True}  # 멱등 no-op
        await task_model.upsert_assignee(task_id, user_id_to_add, 'sub', db)
    else:  # role == 'main'
        if current_role == 'main':
            return {'status': True}  # 멱등 no-op
        await task_model.remove_main_except(task_id, user_id_to_add, db)  # 기존 main 제거
        await task_model.upsert_assignee(task_id, user_id_to_add, 'main', db)

    updated = await task_model.find_by_id(task_id, db)
    new = updated.get('assignees') or []
    # 추가/제거(기존 main 제거 포함)는 set-diff, main 승격은 role 로그(replace 경로와 동일 헬퍼)
    await activity_service.log_task_assignee_change(task_id, branch_id, actor_id, old, new, db)
    await activity_service.log_task_assignee_role_changes(task_id, branch_id, actor_id, old, new, db)
    # 새로 담당자가 된 유저에게 알림(이미 담당자였으면 skip)
    if current_role is None:
        username = request.state.payload.get('username', '')
        display_id = task.get('display_id', '')
        title = task.get('title', '')
        link = f'/branch/{branch_id}/task/{task_id}'
        await notification_service.notify_bulk(
            [user_id_to_add], 'task_assigned', actor_id,
            'taskAssigned', link, 'task', task_id, db,
            actor=username, ref=f'{display_id} {title}',
        )
    # main 지정이면 부모 Main 변경을 직접 하위에 전파(WEAVE-43, replace 경로와 같은 헬퍼·규칙).
    # sub 추가는 무전파. 멱등 no-op(current_role == 'main')은 위에서 이미 return.
    if role == 'main' and task.get('parent_task_id') is None:
        await cascade_main_assignee_to_subtasks(
            task_id, main_of(old), user_id_to_add, branch_id, actor_id,
            request.state.payload.get('username', ''), db)
    return {'status': True}


async def remove_task_assignee(task_id: int, user_id_to_remove: int,
                               branch_id: int, request: Request, db: AsyncSession):
    """Task에서 담당자 하나 제거(main/sub 무관)."""
    task, err = await get_task_in_branch_or_error(task_id, branch_id, request, db)
    if err:
        return err
    actor_id = request.state.payload.get('user_id')
    old = task.get('assignees') or []
    await task_model.remove_assignee(task_id, user_id_to_remove, db)
    updated = await task_model.find_by_id(task_id, db)
    await activity_service.log_task_assignee_change(
        task_id, branch_id, actor_id, old, updated.get('assignees') or [], db)
    return {'status': True}


async def set_task_custom_field(task_id: int, field_id: int, value,
                                branch_id: int, request: Request, db: AsyncSession):
    """Task의 custom field 한 키만 병합/clear(나머지 보존). 신규 도구는 엄격 검증."""
    task, err = await get_task_in_branch_or_error(task_id, branch_id, request, db)
    if err:
        return err
    # 태스크의 최종 task_type → type_id 해석 후 키/타입 엄격 검증
    type_cfg = await type_model.find_by_key(branch_id, task['task_type'], db)
    if not type_cfg:
        return error_response(ErrorCode.INVALID_TASK_TYPE)
    verr = await validate_custom_field_values(
        type_cfg['type_id'], {str(field_id): value}, db, strict=True)
    if verr:
        return error_response(verr)
    await task_model.merge_custom_field(task_id, field_id, value, db)
    return {'status': True}
