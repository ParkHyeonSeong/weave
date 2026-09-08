"""부모 태스크 Main 담당자 변경을 직접 하위태스크에 조건부 전파한다(WEAVE-43).

규칙: new_main이 non-null이고 old_main과 다를 때만 동작. 직접 하위 중
main == old_main 또는 main 없음인 것만 새 main으로 바꾼다 — 이미 다른 main을
가진 하위는 의도적 분리로 보고 건드리지 않는다. 하위 Sub는 보존한다(새 main이
Sub였다면 승격, set_assignees가 중복 제거). 실제 바뀐 하위마다 replace 경로와
같은 활동 로그·task_assigned 알림을 남긴다(이미 담당자였던 유저·actor 본인 제외).

Accepted limitation: "일부러 Unassigned로 둔 하위"와 "미배정 하위"를 데이터로
구분할 수 없어 둘 다 따라간다.

controller/task.py(replace)와 controller/task_subresource.py(granular main)가 공유한다.
library에 두는 이유: 두 컨트롤러가 서로 import하지 않게 하기 위해. 하위는
find_subtasks가 빈 목록이라 하위 자체 변경에서 호출돼도 no-op(재귀 없음).
"""
from sqlalchemy.ext.asyncio import AsyncSession

from core.model import task as task_model
from library import activity_service
from library import notification_service


def main_of(assignees) -> int | None:
    """assignees 리스트에서 main user_id(없으면 None)."""
    return next((a['user_id'] for a in (assignees or []) if a['role'] == 'main'), None)


async def cascade_main_assignee_to_subtasks(parent_task_id: int, old_main, new_main,
                                            branch_id: int, actor_id: int, actor_name: str,
                                            db: AsyncSession) -> list[int]:
    """전파된 하위 task_id 목록(무전파면 빈 리스트)."""
    if new_main is None or new_main == old_main:
        return []
    changed = []
    for child in await task_model.find_subtasks(parent_task_id, db):
        old_list = child.get('assignees') or []
        child_main = main_of(old_list)
        if child_main is not None and child_main != old_main:
            continue  # 분리된 하위 — 유지
        if child_main == new_main:
            continue  # 이미 새 main
        subs = [a['user_id'] for a in old_list if a['role'] == 'sub' and a['user_id'] != new_main]
        await task_model.set_assignees(child['task_id'], new_main, subs, db)
        updated = await task_model.find_by_id(child['task_id'], db)
        new_list = updated.get('assignees') or []
        await activity_service.log_task_assignee_change(
            child['task_id'], branch_id, actor_id, old_list, new_list, db)
        await activity_service.log_task_assignee_role_changes(
            child['task_id'], branch_id, actor_id, old_list, new_list, db)
        if new_main not in {a['user_id'] for a in old_list}:
            await notification_service.notify_bulk(
                [new_main], 'task_assigned', actor_id,
                'taskAssigned',
                f'/branch/{branch_id}/task/{child["task_id"]}', 'task', child['task_id'], db,
                actor=actor_name, ref=f'{child["display_id"]} {child["title"]}',
            )
        changed.append(child['task_id'])
    return changed
