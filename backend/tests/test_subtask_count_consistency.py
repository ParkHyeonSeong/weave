from datetime import date, timedelta

from sqlalchemy import text

from core.model import branch as branch_model
from core.model import epic as epic_model
from core.model import task as task_model


# ---------------------------------------------------------------------------
# seed helpers (mirror tests/test_branch_home.py)
# ---------------------------------------------------------------------------

async def _make_user(db, email, username):
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status)
        VALUES (:e, :p, :u, 'active') RETURNING user_id
    """), {"e": email, "p": b"x", "u": username})
    return row.scalar_one()


async def _make_branch(db, created_by, name="Count Branch", key="CNT", color="#5E6AD2"):
    row = await db.execute(text("""
        INSERT INTO branch (branch_name, key, description, visibility, color, created_by)
        VALUES (:n, :k, 'desc', 'private', :c, :u) RETURNING branch_id
    """), {"n": name, "k": key, "c": color, "u": created_by})
    bid = row.scalar_one()
    for key_, label, color_, category, sort in [
        ("todo", "To Do", "#9CA3AF", "todo", 0),
        ("in_progress", "In Progress", "#2563EB", "in_progress", 1),
        ("done", "Done", "#16A34A", "done", 2),
        ("cancelled", "Cancelled", "#DC2626", "cancelled", 3),
    ]:
        await db.execute(text("""
            INSERT INTO workflow_status (branch_id, key, label, color, category, sort_order)
            VALUES (:b, :k, :l, :c, :cat, :s)
        """), {"b": bid, "k": key_, "l": label, "c": color_, "cat": category, "s": sort})
    return bid


async def _add_member(db, branch_id, user_id, role="member"):
    await db.execute(text("""
        INSERT INTO branch_member (branch_id, user_id, role)
        VALUES (:b, :u, :r)
    """), {"b": branch_id, "u": user_id, "r": role})


async def _make_task(db, branch_id, created_by, status="todo", due_date=None,
                     sprint_id=None, epic_id=None, parent_task_id=None):
    row = await db.execute(text("""
        SELECT COALESCE(MAX(display_number), 0) + 1 FROM task WHERE branch_id = :b
    """), {"b": branch_id})
    dn = row.scalar_one()
    res = await db.execute(text("""
        INSERT INTO task (branch_id, display_number, title, status, due_date,
                          sprint_id, epic_id, parent_task_id, created_by)
        VALUES (:b, :dn, :t, :s, :d, :sp, :ep, :pt, :u) RETURNING task_id
    """), {"b": branch_id, "dn": dn, "t": f"task {dn}", "s": status,
           "d": due_date, "sp": sprint_id, "ep": epic_id,
           "pt": parent_task_id, "u": created_by})
    return res.scalar_one()


async def _make_sprint(db, branch_id, created_by, name="Sprint 1", status="active"):
    res = await db.execute(text("""
        INSERT INTO sprint (branch_id, sprint_name, status, created_by)
        VALUES (:b, :n, :s, :u) RETURNING sprint_id
    """), {"b": branch_id, "n": name, "s": status, "u": created_by})
    return res.scalar_one()


async def _make_epic(db, branch_id, created_by, name="Epic 1"):
    res = await db.execute(text("""
        INSERT INTO epic (branch_id, epic_name, status, created_by)
        VALUES (:b, :n, 'planned', :u) RETURNING epic_id
    """), {"b": branch_id, "n": name, "u": created_by})
    return res.scalar_one()


# ---------------------------------------------------------------------------
# (a) Epic task count — model/epic.py find_by_branch
# ---------------------------------------------------------------------------

async def test_epic_task_count_excludes_subtasks(db_session):
    owner = await _make_user(db_session, "epic@count.test", "epicowner")
    bid = await _make_branch(db_session, owner, name="Epic", key="EP")
    await _add_member(db_session, bid, owner, "admin")
    eid = await _make_epic(db_session, bid, owner, name="Alpha")

    parent = await _make_task(db_session, bid, owner, status="todo", epic_id=eid)
    # subtask under the parent — also carries epic_id but must NOT inflate the count
    await _make_task(db_session, bid, owner, status="todo", epic_id=eid,
                     parent_task_id=parent)

    epics = await epic_model.find_by_branch(bid, db_session)
    assert len(epics) == 1
    assert epics[0]["task_count"] == 1          # only the top-level parent


# ---------------------------------------------------------------------------
# (b) Sprint burndown — model/task.py count_by_sprint_status
# ---------------------------------------------------------------------------

async def test_sprint_burndown_excludes_subtasks(db_session):
    owner = await _make_user(db_session, "sprint@count.test", "sprintowner")
    bid = await _make_branch(db_session, owner, name="Sprint", key="SP")
    await _add_member(db_session, bid, owner, "admin")
    sid = await _make_sprint(db_session, bid, owner, name="S1", status="active")

    parent = await _make_task(db_session, bid, owner, status="todo", sprint_id=sid)
    # subtask in the same sprint, different status — must NOT be counted
    await _make_task(db_session, bid, owner, status="done", sprint_id=sid,
                     parent_task_id=parent)

    counts = await task_model.count_by_sprint_status(sid, db_session)
    assert counts["done_count"] == 0            # the done subtask is excluded
    assert counts["incomplete_count"] == 1      # only the top-level todo parent


async def _assign(db, task_id, user_id, role):
    await db.execute(text("""
        INSERT INTO task_assignee (task_id, user_id, role) VALUES (:t, :u, :r)
    """), {"t": task_id, "u": user_id, "r": role})


async def test_sprint_counts_with_subtasks_follow_parent_sprint(db_session):
    owner = await _make_user(db_session, "sprintall@count.test", "sprintallowner")
    other = await _make_user(db_session, "sprintother@count.test", "sprintother")
    bid = await _make_branch(db_session, owner, name="SprintAll", key="SA")
    await _add_member(db_session, bid, owner, "admin")
    await _add_member(db_session, bid, other, "member")
    sid = await _make_sprint(db_session, bid, owner, name="S1", status="active")
    other_sid = await _make_sprint(db_session, bid, owner, name="S2", status="active")

    parent = await _make_task(db_session, bid, owner, status="todo", sprint_id=sid)
    # 실제 저장 형태: 하위태스크 sprint_id는 NULL, 부모 sprint를 따른다
    sub_done = await _make_task(db_session, bid, owner, status="done", parent_task_id=parent)
    sub_todo = await _make_task(db_session, bid, owner, status="todo", parent_task_id=parent)
    solo = await _make_task(db_session, bid, owner, status="cancelled", sprint_id=sid)
    # 다른 스프린트 / 백로그 태스크는 제외
    elsewhere = await _make_task(db_session, bid, owner, status="todo", sprint_id=other_sid)
    await _make_task(db_session, bid, owner, status="todo", parent_task_id=elsewhere)
    await _make_task(db_session, bid, owner, status="todo")

    await _assign(db_session, parent, owner, "main")
    await _assign(db_session, sub_todo, owner, "sub")
    await _assign(db_session, sub_done, other, "main")
    await _assign(db_session, solo, other, "main")
    await _assign(db_session, elsewhere, owner, "main")

    counts = await task_model.count_by_sprint_for_user(sid, bid, owner, db_session)
    assert counts["all_total_count"] == 4       # parent + 2 subtasks + solo
    assert counts["all_done_count"] == 2        # done subtask + cancelled solo
    assert counts["my_count"] == 2              # main on parent + sub on subtask

    # 상위 태스크 기준 수치는 기존 count_by_sprint_status와 같다
    top_only = await task_model.count_by_sprint_status(sid, db_session)
    assert top_only == {"done_count": 1, "incomplete_count": 1}
    assert {k: counts[k] for k in top_only} == top_only

    # 다른 브랜치 id로는 이 스프린트를 세지 않는다
    other_bid = await _make_branch(db_session, owner, name="Other", key="OT")
    miss = await task_model.count_by_sprint_for_user(sid, other_bid, owner, db_session)
    assert miss["all_total_count"] == 0


# ---------------------------------------------------------------------------
# (c) Home KPI — model/branch.py home_stats
# ---------------------------------------------------------------------------

async def test_home_stats_excludes_subtasks(db_session):
    owner = await _make_user(db_session, "home@count.test", "homeowner")
    bid = await _make_branch(db_session, owner, name="Home", key="HM")
    await _add_member(db_session, bid, owner, "admin")

    this_week = date.today() + timedelta(days=3)
    parent = await _make_task(db_session, bid, owner, status="todo", due_date=this_week)
    # subtasks under the parent: an in_progress + a todo due this week.
    # Both must be excluded from open/in_progress/due_this_week.
    await _make_task(db_session, bid, owner, status="in_progress",
                     parent_task_id=parent)
    await _make_task(db_session, bid, owner, status="todo", due_date=this_week,
                     parent_task_id=parent)

    stats = await branch_model.home_stats(owner, date.today(), db_session)
    assert stats["open_count"] == 1             # only the top-level todo parent
    assert stats["in_progress_count"] == 0      # subtask in_progress excluded
    assert stats["due_this_week_count"] == 1    # only the parent's due date counts
