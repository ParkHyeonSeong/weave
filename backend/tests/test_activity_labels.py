"""활동 이력이 **내부 key가 아니라 그때 보이던 라벨**을 함께 남기는지.

status·task_type은 DB에 내부 key로 저장된다(todo, bug …). 활동 이력이 그 key를 그대로
보여주면 어떤 언어 사용자에게도 의미가 없다. 라벨을 테스트에서 주입하지 않고 **실제 기록
경로**(controller → activity_service.log_task_change)로 만들어진 changes를 검사한다.
"""
import json
from types import SimpleNamespace

from sqlalchemy import text

from core.controller import task as task_ctrl
from core.model import activity_log as log_model
from core.model import task as task_model


def _req(user_id):
    return SimpleNamespace(state=SimpleNamespace(payload={'user_id': user_id, 'username': 'u'}))


async def _make_user(db, email, username):
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status)
        VALUES (:e, :p, :u, 'active') RETURNING user_id
    """), {"e": email, "p": b"x", "u": username})
    return row.scalar_one()


async def _make_branch(db, created_by, key):
    row = await db.execute(text("""
        INSERT INTO branch (branch_name, key, description, visibility, color, created_by)
        VALUES ('ACT', :k, 'desc', 'private', '#5E6AD2', :u) RETURNING branch_id
    """), {"k": key, "u": created_by})
    bid = row.scalar_one()
    # 사용자가 직접 만든 이름 — 번역 대상이 아니다(그대로 보존되어야 한다).
    for key_, label, category, sort in [
        ("todo", "해야 할 일", "todo", 0),
        ("in_progress", "진행 중", "in_progress", 1),
    ]:
        await db.execute(text("""
            INSERT INTO workflow_status (branch_id, key, label, color, category, sort_order)
            VALUES (:b, :k, :l, '#9CA3AF', :c, :s)
        """), {"b": bid, "k": key_, "l": label, "c": category, "s": sort})
    for type_key, type_name, sort in [("task", "업무", 0), ("bug", "버그", 1)]:
        await db.execute(text("""
            INSERT INTO task_type_config (branch_id, type_key, type_name, icon, color, sort_order)
            VALUES (:b, :k, :n, 'circle', '#5E6AD2', :s)
        """), {"b": bid, "k": type_key, "n": type_name, "s": sort})
    await db.execute(text("""
        INSERT INTO branch_member (branch_id, user_id, role) VALUES (:b, :u, 'owner')
    """), {"b": bid, "u": created_by})
    return bid


async def _make_task(db, branch_id, created_by):
    row = await db.execute(text("""
        INSERT INTO task (branch_id, display_number, title, status, task_type, priority,
                          due_date, created_by)
        VALUES (:b, 1, 'T', 'todo', 'task', 'low', DATE '2026-09-01', :u)
        RETURNING task_id
    """), {"b": branch_id, "u": created_by})
    return row.scalar_one()


async def _changes(db, task_id):
    rows = await log_model.find_by_entity('task', task_id, 10, 0, db) \
        if hasattr(log_model, 'find_by_entity') else None
    if rows is None:
        res = await db.execute(text("""
            SELECT changes FROM activity_log
            WHERE entity_type = 'task' AND entity_id = :t
            ORDER BY log_id DESC LIMIT 1
        """), {"t": task_id})
        raw = res.scalar_one()
        return json.loads(raw) if isinstance(raw, str) else raw
    return rows[0]['changes']


async def test_status_and_type_changes_record_display_labels(db_session):
    """실제 update 경로가 status·task_type의 old_label/new_label을 남긴다."""
    from routers.schema import task as task_schema

    user = await _make_user(db_session, 'act-1@test.local', 'act1')
    bid = await _make_branch(db_session, user, 'ACT1')
    tid = await _make_task(db_session, bid, user)

    body = task_schema.TaskUpdate(status='in_progress', task_type='bug')
    res = await task_ctrl.update(tid, body, bid, _req(user), db_session)
    assert res['status'] is True, res

    changes = {c['field']: c for c in await _changes(db_session, tid)}
    assert changes['status']['old'] == 'todo' and changes['status']['new'] == 'in_progress'
    # 내부 key가 아니라 그때 보이던 라벨이 함께 있다 — 사용자가 만든 이름은 그대로 보존한다.
    assert changes['status']['old_label'] == '해야 할 일'
    assert changes['status']['new_label'] == '진행 중'
    assert changes['task_type']['old_label'] == '업무'
    assert changes['task_type']['new_label'] == '버그'


async def test_priority_and_date_changes_keep_raw_values_for_the_client(db_session):
    """priority·date-only는 서버가 라벨을 붙이지 않는다 — 표시 언어는 읽는 사람이 정한다.

    (프런트 activitySummary가 priority enum과 date-only를 각각 카탈로그 라벨·locale 표기로 옮긴다.)
    """
    import datetime
    from routers.schema import task as task_schema

    user = await _make_user(db_session, 'act-2@test.local', 'act2')
    bid = await _make_branch(db_session, user, 'ACT2')
    tid = await _make_task(db_session, bid, user)

    body = task_schema.TaskUpdate(priority='urgent', due_date=datetime.date(2026, 12, 31))
    res = await task_ctrl.update(tid, body, bid, _req(user), db_session)
    assert res['status'] is True, res

    changes = {c['field']: c for c in await _changes(db_session, tid)}
    assert changes['priority']['old'] == 'low' and changes['priority']['new'] == 'urgent'
    assert 'old_label' not in changes['priority']
    # date-only는 문자열 그대로 — 시간대 변환 없이 저장된다.
    assert changes['due_date']['old'] == '2026-09-01'
    assert changes['due_date']['new'] == '2026-12-31'
    assert await task_model.find_by_id(tid, db_session) is not None
