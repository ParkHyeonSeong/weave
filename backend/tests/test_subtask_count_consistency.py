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
