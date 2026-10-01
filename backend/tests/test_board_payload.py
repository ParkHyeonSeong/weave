"""보드 카드 페이로드 — 보드의 에픽 필터·정렬·카드 표시가 읽는 필드.

보드 필터 바의 '에픽' 칩은 task.epic_id를, 다중 정렬의 마감일·생성일은 due_date·created_at을
비교한다(frontend/library/filterSpec.js LEAF, frontend/library/taskViewState.js val).
보드 조회가 이 값을 빼면 에픽을 고르는 순간 그 에픽의 카드까지 모두 사라지고,
마감일·생성일 정렬은 비교할 값이 없어 task_id 순으로 무너진다.

Style: direct controller calls, rollback-isolated db_session fixture.
"""
from types import SimpleNamespace

from sqlalchemy import text

from core.controller import branch as branch_ctrl
from core.controller import task as task_ctrl
from routers.schema import branch as branch_schema
from routers.schema import task as task_schema


def _req(user_id: int):
    return SimpleNamespace(state=SimpleNamespace(payload={'user_id': user_id}))


async def _make_user(db, email, username):
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status)
        VALUES (:e, :p, :u, 'active') RETURNING user_id
    """), {"e": email, "p": b"x", "u": username})
    return row.scalar_one()


async def _make_branch(db, user_id, key):
    res = await branch_ctrl.create(
        branch_schema.BranchCreate(branch_name="B", key=key), _req(user_id), db)
    return res["branch_id"]


async def _make_active_sprint(db, branch_id, user_id):
    row = await db.execute(text("""
        INSERT INTO sprint (branch_id, sprint_name, status, created_by)
        VALUES (:b, 'Sprint 1', 'active', :u) RETURNING sprint_id
    """), {"b": branch_id, "u": user_id})
    return row.scalar_one()


async def _make_epic(db, branch_id, user_id):
    row = await db.execute(text("""
        INSERT INTO epic (branch_id, epic_name, color, created_by)
        VALUES (:b, 'Payments', '#16A34A', :u) RETURNING epic_id
    """), {"b": branch_id, "u": user_id})
    return row.scalar_one()


async def test_board_cards_carry_epic_due_and_created(db_session):
    alice = await _make_user(db_session, "a_bp@board.test", "a_bp")
    branch = await _make_branch(db_session, alice, "BPAY")
    sprint = await _make_active_sprint(db_session, branch, alice)
    epic = await _make_epic(db_session, branch, alice)

    with_meta = (await task_ctrl.create(
        task_schema.TaskCreate(title="With epic and due", sprint_id=sprint,
                               epic_id=epic, due_date="2026-10-02"),
        branch, _req(alice), db_session))["task_id"]
    plain = (await task_ctrl.create(
        task_schema.TaskCreate(title="Plain", sprint_id=sprint),
        branch, _req(alice), db_session))["task_id"]

    res = await task_ctrl.get_board(branch, None, _req(alice), db_session)
    assert res["status"] is True
    cards = {t["task_id"]: t for col in res["columns"].values() for t in col}

    meta = cards[with_meta]
    assert meta["epic_id"] == epic
    assert str(meta["due_date"]) == "2026-10-02"
    assert meta["created_at"] is not None

    bare = cards[plain]
    assert bare["epic_id"] is None
    assert bare["due_date"] is None
    assert bare["created_at"] is not None
