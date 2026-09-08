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


# ---------------------------------------------------------------------------
# 구버전 행 보강 — 조회 시점에 branch의 **현재** 설정으로 best-effort
# ---------------------------------------------------------------------------
#
# 과거 시점의 라벨은 저장돼 있지 않다. 그 뒤 이름이 바뀌었으면 지금 이름으로 보이고,
# 삭제된 key는 라벨을 만들 수 없다(프런트가 locale 폴백을 렌더한다).

from core.controller import activity_log as activity_ctrl   # noqa: E402


async def _legacy_log(db, branch_id, task_id, actor_id, changes):
    """라벨 없이 저장된 예전 행(migration 042 이후 ~ 이번 변경 전 형태)."""
    row = await db.execute(text("""
        INSERT INTO activity_log (entity_type, entity_id, branch_id, actor_id, action,
                                  changes, summary)
        VALUES ('task', :e, :b, :u, 'updated', CAST(:c AS jsonb), '상태 todo -> in_progress')
        RETURNING log_id
    """), {"e": task_id, "b": branch_id, "u": actor_id, "c": json.dumps(changes)})
    return row.scalar_one()


def _change_by_field(activities, field):
    for activity in activities:
        for ch in activity['changes']:
            if ch.get('field') == field:
                return ch
    raise AssertionError(f'{field} change를 찾지 못했다')


async def test_legacy_rows_are_backfilled_with_current_labels_on_task_activity(db_session):
    """라벨 없이 저장된 예전 행도 조회하면 현재 표시 라벨이 붙는다(내부 key 단독 노출 없음)."""
    user = await _make_user(db_session, 'act-legacy@test.local', 'act-legacy')
    bid = await _make_branch(db_session, user, 'ACTL')
    tid = await _make_task(db_session, bid, user)
    await _legacy_log(db_session, bid, tid, user, [
        {'field': 'status', 'old': 'todo', 'new': 'in_progress'},
        {'field': 'task_type', 'old': 'task', 'new': 'bug'},
    ])

    res = await activity_ctrl.get_task_activity(tid, bid, 30, 0, _req(user), db_session)
    assert res['status'] is True
    status = _change_by_field(res['activities'], 'status')
    ttype = _change_by_field(res['activities'], 'task_type')
    assert status['old_label'] == '해야 할 일' and status['new_label'] == '진행 중'
    assert ttype['old_label'] == '업무' and ttype['new_label'] == '버그'
    # 원본 key는 그대로 남는다(식별 정보).
    assert status['old'] == 'todo' and status['new'] == 'in_progress'


async def test_branch_activity_uses_the_same_backfill(db_session):
    """같은 행을 branch 피드에서 열어도 결과가 같다."""
    user = await _make_user(db_session, 'act-legacy2@test.local', 'act-legacy2')
    bid = await _make_branch(db_session, user, 'ACTL2')
    tid = await _make_task(db_session, bid, user)
    await _legacy_log(db_session, bid, tid, user,
                      [{'field': 'status', 'old': 'todo', 'new': 'in_progress'}])

    task_res = await activity_ctrl.get_task_activity(tid, bid, 30, 0, _req(user), db_session)
    branch_res = await activity_ctrl.get_branch_activity(bid, 30, 0, _req(user), db_session)
    task_change = _change_by_field(task_res['activities'], 'status')
    branch_change = _change_by_field(branch_res['activities'], 'status')
    assert task_change['old_label'] == branch_change['old_label'] == '해야 할 일'
    assert task_change['new_label'] == branch_change['new_label'] == '진행 중'


async def test_stored_labels_are_never_overwritten_by_current_config(db_session):
    """기록 당시 라벨이 있으면 현재 이름이 달라도 그대로 둔다(그때 보이던 이름을 지킨다)."""
    user = await _make_user(db_session, 'act-keep@test.local', 'act-keep')
    bid = await _make_branch(db_session, user, 'ACTK')
    tid = await _make_task(db_session, bid, user)
    await _legacy_log(db_session, bid, tid, user, [{
        'field': 'status', 'old': 'todo', 'new': 'in_progress',
        'old_label': '옛 이름', 'new_label': '옛 진행',
    }])

    res = await activity_ctrl.get_task_activity(tid, bid, 30, 0, _req(user), db_session)
    status = _change_by_field(res['activities'], 'status')
    assert status['old_label'] == '옛 이름'      # 현재 설정은 '해야 할 일'이지만 덮어쓰지 않는다
    assert status['new_label'] == '옛 진행'


async def test_deleted_key_gets_no_invented_label(db_session):
    """현재 설정에도 없는 key는 서버가 문구를 만들지 않는다 — 프런트가 읽는 사람 언어로 낸다."""
    user = await _make_user(db_session, 'act-del@test.local', 'act-del')
    bid = await _make_branch(db_session, user, 'ACTD')
    tid = await _make_task(db_session, bid, user)
    await _legacy_log(db_session, bid, tid, user, [
        {'field': 'status', 'old': 'todo', 'new': 'archived_long_ago'},
        {'field': 'task_type', 'old': 'task', 'new': 'gone_type'},
    ])

    res = await activity_ctrl.get_task_activity(tid, bid, 30, 0, _req(user), db_session)
    status = _change_by_field(res['activities'], 'status')
    ttype = _change_by_field(res['activities'], 'task_type')
    assert status['old_label'] == '해야 할 일'          # 살아 있는 쪽은 보강된다
    assert status['new_label'] is None                  # 삭제된 key는 비워 둔다
    assert ttype['new_label'] is None
    assert status['new'] == 'archived_long_ago'         # key는 식별 정보로 남는다


async def test_backfill_queries_branch_config_once_per_request(db_session, monkeypatch):
    """행·change마다 조회하지 않는다 — branch당 status 1회, task_type 1회."""
    from library import activity_service

    user = await _make_user(db_session, 'act-once@test.local', 'act-once')
    bid = await _make_branch(db_session, user, 'ACTO')
    tid = await _make_task(db_session, bid, user)
    for _ in range(5):
        await _legacy_log(db_session, bid, tid, user, [
            {'field': 'status', 'old': 'todo', 'new': 'in_progress'},
            {'field': 'task_type', 'old': 'task', 'new': 'bug'},
        ])

    calls = {'status': 0, 'type': 0}
    real_status = activity_service._status_labels
    real_type = activity_service._type_labels

    async def counted_status(branch_id, db):
        calls['status'] += 1
        return await real_status(branch_id, db)

    async def counted_type(branch_id, db):
        calls['type'] += 1
        return await real_type(branch_id, db)

    monkeypatch.setattr(activity_service, '_status_labels', counted_status)
    monkeypatch.setattr(activity_service, '_type_labels', counted_type)

    res = await activity_ctrl.get_task_activity(tid, bid, 30, 0, _req(user), db_session)
    assert len(res['activities']) == 5
    assert calls == {'status': 1, 'type': 1}


async def test_backfill_skips_the_query_when_nothing_needs_labels(db_session, monkeypatch):
    """보강할 것이 없으면 조회 자체를 하지 않는다(신규 행만 있는 흐름)."""
    from library import activity_service

    user = await _make_user(db_session, 'act-skip@test.local', 'act-skip')
    bid = await _make_branch(db_session, user, 'ACTS')
    tid = await _make_task(db_session, bid, user)
    await _legacy_log(db_session, bid, tid, user, [{
        'field': 'status', 'old': 'todo', 'new': 'in_progress',
        'old_label': '해야 할 일', 'new_label': '진행 중',
    }])

    called = {'n': 0}

    async def boom(branch_id, db):
        called['n'] += 1
        return {}

    monkeypatch.setattr(activity_service, '_status_labels', boom)
    monkeypatch.setattr(activity_service, '_type_labels', boom)
    await activity_ctrl.get_task_activity(tid, bid, 30, 0, _req(user), db_session)
    assert called['n'] == 0
