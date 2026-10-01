"""close-with-comment 기능 테스트. 컨트롤러 직접호출 + rollback-isolated db_session.

Seed 헬퍼는 test_controller_task_subresources_errors.py와 동일 패턴.
"""
from types import SimpleNamespace

from sqlalchemy import text

from core.controller import task_issue as issue_ctrl
from core.model import task_issue as issue_model
from core.model import notification as noti_model
from routers.schema.task_issue import IssueUpdate


def _req(user_id, username="u"):
    return SimpleNamespace(state=SimpleNamespace(payload={"user_id": user_id, "username": username}))


async def _make_user(db, email, username):
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status)
        VALUES (:e, :p, :u, 'active') RETURNING user_id
    """), {"e": email, "p": b"x", "u": username})
    return row.scalar_one()


async def _make_branch(db, created_by, name="Branch", key="KEY"):
    row = await db.execute(text("""
        INSERT INTO branch (branch_name, key, description, visibility, color, created_by)
        VALUES (:n, :k, 'desc', 'private', '#5E6AD2', :u) RETURNING branch_id
    """), {"n": name, "k": key, "u": created_by})
    return row.scalar_one()


async def _add_member(db, branch_id, user_id, role="member"):
    await db.execute(text("""
        INSERT INTO branch_member (branch_id, user_id, role) VALUES (:b, :u, :r)
    """), {"b": branch_id, "u": user_id, "r": role})


async def _make_task(db, branch_id, created_by, title="Task"):
    row = await db.execute(text("""
        SELECT COALESCE(MAX(display_number), 0) + 1 FROM task WHERE branch_id = :b
    """), {"b": branch_id})
    dn = row.scalar_one()
    res = await db.execute(text("""
        INSERT INTO task (branch_id, display_number, title, status, created_by)
        VALUES (:b, :dn, :t, 'todo', :u) RETURNING task_id
    """), {"b": branch_id, "dn": dn, "t": title, "u": created_by})
    return res.scalar_one()


async def _make_issue(db, task_id, created_by, title="Issue", status="open"):
    res = await db.execute(text("""
        INSERT INTO task_issue (task_id, title, body, status, created_by)
        VALUES (:t, :title, 'body', :s, :u) RETURNING issue_id
    """), {"t": task_id, "title": title, "s": status, "u": created_by})
    return res.scalar_one()


async def test_create_and_find_events_ordered(db_session):
    alice = await _make_user(db_session, "ev_a@t.t", "ev_a")
    branch = await _make_branch(db_session, alice, name="EV1", key="EV1")
    await _add_member(db_session, branch, alice)
    task = await _make_task(db_session, branch, alice)
    issue = await _make_issue(db_session, task, alice)

    await issue_model.create_event(issue, alice, "closed", db_session)
    await issue_model.create_event(issue, alice, "reopened", db_session)

    events = await issue_model.find_events(issue, db_session)
    assert [e["event_type"] for e in events] == ["closed", "reopened"]
    assert events[0]["actor_name"] == "ev_a"


async def test_transition_status_conditional(db_session):
    alice = await _make_user(db_session, "tr_a@t.t", "tr_a")
    branch = await _make_branch(db_session, alice, name="TR1", key="TR1")
    await _add_member(db_session, branch, alice)
    task = await _make_task(db_session, branch, alice)
    issue = await _make_issue(db_session, task, alice, status="open")

    assert await issue_model.transition_status(issue, "closed", db_session) is True   # open->closed
    assert await issue_model.transition_status(issue, "closed", db_session) is False  # no-op
    assert await issue_model.transition_status(issue, "open", db_session) is True      # closed->open
    row = await issue_model.find_by_id(issue, db_session)
    assert row["status"] == "open"


async def test_update_issue_model_ignores_status(db_session):
    alice = await _make_user(db_session, "ui_a@t.t", "ui_a")
    branch = await _make_branch(db_session, alice, name="UI1", key="UI1")
    await _add_member(db_session, branch, alice)
    task = await _make_task(db_session, branch, alice)
    issue = await _make_issue(db_session, task, alice, status="open")

    await issue_model.update_issue(issue, {"title": "X", "status": "closed"}, db_session)
    row = await issue_model.find_by_id(issue, db_session)
    assert row["title"] == "X"
    assert row["status"] == "open"  # model.update_issue must NOT write status anymore


async def test_comment_mention_member_notified(db_session):
    alice = await _make_user(db_session, "mm_a@t.t", "mm_a")
    bob = await _make_user(db_session, "mm_b@t.t", "mm_b")
    branch = await _make_branch(db_session, alice, name="MM1", key="MM1")
    await _add_member(db_session, branch, alice)
    await _add_member(db_session, branch, bob)
    task = await _make_task(db_session, branch, alice)
    issue = await _make_issue(db_session, task, alice)

    body = SimpleNamespace(content=f'<p>hi <span data-user-id="{bob}">@bob</span></p>')
    res = await issue_ctrl.create_comment(body, branch, task, issue, _req(alice, "mm_a"), db_session)
    assert res["status"] is True

    notis = await noti_model.find_by_user(bob, db=db_session)
    assert any(n["type"] == "mention" for n in notis)


async def test_comment_mention_nonmember_not_notified(db_session):
    alice = await _make_user(db_session, "mn_a@t.t", "mn_a")
    carol = await _make_user(db_session, "mn_c@t.t", "mn_c")  # NOT a branch member
    branch = await _make_branch(db_session, alice, name="MN1", key="MN1")
    await _add_member(db_session, branch, alice)
    task = await _make_task(db_session, branch, alice)
    issue = await _make_issue(db_session, task, alice)

    body = SimpleNamespace(content=f'<p><span data-user-id="{carol}">@carol</span></p>')
    res = await issue_ctrl.create_comment(body, branch, task, issue, _req(alice, "mn_a"), db_session)
    assert res["status"] is True

    notis = await noti_model.find_by_user(carol, db=db_session)
    assert all(n["type"] != "mention" for n in notis)  # 비멤버는 멘션 알림 없음


async def test_create_issue_mention_nonmember_not_notified(db_session):
    alice = await _make_user(db_session, "ci_a@t.t", "ci_a")
    carol = await _make_user(db_session, "ci_c@t.t", "ci_c")  # NOT a branch member
    branch = await _make_branch(db_session, alice, name="CI1", key="CI1")
    await _add_member(db_session, branch, alice)
    task = await _make_task(db_session, branch, alice)

    body = SimpleNamespace(title="Bug", body=f'<p><span data-user-id="{carol}">@carol</span></p>')
    res = await issue_ctrl.create_issue(body, branch, task, _req(alice, "ci_a"), db_session)
    assert res["status"] is True

    notis = await noti_model.find_by_user(carol, db=db_session)
    assert all(n["type"] != "mention" for n in notis)  # 비멤버는 본문 멘션 알림도 없음


async def test_close_with_comment_folds_notification(db_session):
    alice = await _make_user(db_session, "cf_a@t.t", "cf_a")   # author
    bob = await _make_user(db_session, "cf_b@t.t", "cf_b")     # prior commenter
    branch = await _make_branch(db_session, alice, name="CF1", key="CF1")
    await _add_member(db_session, branch, alice)
    await _add_member(db_session, branch, bob)
    task = await _make_task(db_session, branch, alice)
    issue = await _make_issue(db_session, task, alice, status="open")

    # bob comments first → becomes a recipient
    await issue_ctrl.create_comment(SimpleNamespace(content="<p>first</p>"), branch, task, issue, _req(bob, "cf_b"), db_session)

    # alice closes WITH a comment
    res = await issue_ctrl.close_issue(SimpleNamespace(comment="<p>fixing</p>"), branch, task, issue, _req(alice, "cf_a"), db_session)
    assert res["status"] is True
    assert res["status_changed"] is True

    row = await issue_model.find_by_id(issue, db_session)
    assert row["status"] == "closed"

    events = await issue_model.find_events(issue, db_session)
    assert [e["event_type"] for e in events] == ["closed"]

    bob_types = [n["type"] for n in await noti_model.find_by_user(bob, db=db_session)]
    assert "issue_closed" in bob_types
    assert "issue_comment" not in bob_types  # folded: close 알림이 댓글 알림을 대체


async def test_close_without_comment(db_session):
    alice = await _make_user(db_session, "cw_a@t.t", "cw_a")
    branch = await _make_branch(db_session, alice, name="CW1", key="CW1")
    await _add_member(db_session, branch, alice)
    task = await _make_task(db_session, branch, alice)
    issue = await _make_issue(db_session, task, alice, status="open")

    res = await issue_ctrl.close_issue(SimpleNamespace(comment=None), branch, task, issue, _req(alice, "cw_a"), db_session)
    assert res["status"] is True and res["status_changed"] is True
    assert res["comment_id"] is None
    events = await issue_model.find_events(issue, db_session)
    assert [e["event_type"] for e in events] == ["closed"]


async def test_close_already_closed_no_duplicate_event(db_session):
    alice = await _make_user(db_session, "cc_a@t.t", "cc_a")
    branch = await _make_branch(db_session, alice, name="CC1", key="CC1")
    await _add_member(db_session, branch, alice)
    task = await _make_task(db_session, branch, alice)
    issue = await _make_issue(db_session, task, alice, status="closed")

    res = await issue_ctrl.close_issue(SimpleNamespace(comment=None), branch, task, issue, _req(alice, "cc_a"), db_session)
    assert res["status"] is True and res["status_changed"] is False
    assert await issue_model.find_events(issue, db_session) == []


async def test_reopen_with_comment(db_session):
    alice = await _make_user(db_session, "ro_a@t.t", "ro_a")
    branch = await _make_branch(db_session, alice, name="RO1", key="RO1")
    await _add_member(db_session, branch, alice)
    task = await _make_task(db_session, branch, alice)
    issue = await _make_issue(db_session, task, alice, status="closed")

    res = await issue_ctrl.reopen_issue(SimpleNamespace(comment="<p>back</p>"), branch, task, issue, _req(alice, "ro_a"), db_session)
    assert res["status"] is True and res["status_changed"] is True
    row = await issue_model.find_by_id(issue, db_session)
    assert row["status"] == "open"
    events = await issue_model.find_events(issue, db_session)
    assert [e["event_type"] for e in events] == ["reopened"]


async def test_close_comment_mention_notifies_member(db_session):
    alice = await _make_user(db_session, "cm_a@t.t", "cm_a")
    dan = await _make_user(db_session, "cm_d@t.t", "cm_d")
    branch = await _make_branch(db_session, alice, name="CM1", key="CM1")
    await _add_member(db_session, branch, alice)
    await _add_member(db_session, branch, dan)
    task = await _make_task(db_session, branch, alice)
    issue = await _make_issue(db_session, task, alice, status="open")

    body = SimpleNamespace(comment=f'<p>cc <span data-user-id="{dan}">@dan</span></p>')
    res = await issue_ctrl.close_issue(body, branch, task, issue, _req(alice, "cm_a"), db_session)
    assert res["status"] is True
    dan_types = [n["type"] for n in await noti_model.find_by_user(dan, db=db_session)]
    assert "mention" in dan_types  # 닫기-댓글 멘션도 발송돼야 함 (블로커 회귀 방지)


async def test_close_non_member_forbidden(db_session):
    alice = await _make_user(db_session, "cn_a@t.t", "cn_a")
    stranger = await _make_user(db_session, "cn_s@t.t", "cn_s")
    branch = await _make_branch(db_session, alice, name="CN1", key="CN1")
    await _add_member(db_session, branch, alice)
    task = await _make_task(db_session, branch, alice)
    issue = await _make_issue(db_session, task, alice, status="open")

    res = await issue_ctrl.close_issue(SimpleNamespace(comment=None), branch, task, issue, _req(stranger, "cn_s"), db_session)
    assert res["status"] is False
    assert res["code"] == "NOT_BRANCH_MEMBER"


async def test_update_issue_status_emits_event_and_notification(db_session):
    alice = await _make_user(db_session, "us_a@t.t", "us_a")
    bob = await _make_user(db_session, "us_b@t.t", "us_b")
    branch = await _make_branch(db_session, alice, name="US1", key="US1")
    await _add_member(db_session, branch, alice)
    await _add_member(db_session, branch, bob)
    task = await _make_task(db_session, branch, alice)
    issue = await _make_issue(db_session, task, alice, status="open")
    await issue_ctrl.create_comment(SimpleNamespace(content="<p>c</p>"), branch, task, issue, _req(bob, "us_b"), db_session)

    res = await issue_ctrl.update_issue(IssueUpdate(status="closed"), branch, task, issue, _req(alice, "us_a"), db_session)
    assert res["status"] is True
    assert [e["event_type"] for e in await issue_model.find_events(issue, db_session)] == ["closed"]
    bob_types = [n["type"] for n in await noti_model.find_by_user(bob, db=db_session)]
    assert "issue_closed" in bob_types


async def test_get_issue_timeline_comment_before_event_same_ts(db_session):
    alice = await _make_user(db_session, "gt_a@t.t", "gt_a")
    branch = await _make_branch(db_session, alice, name="GT1", key="GT1")
    await _add_member(db_session, branch, alice)
    task = await _make_task(db_session, branch, alice)
    issue = await _make_issue(db_session, task, alice, status="open")

    # 한 트랜잭션(컨트롤러 1회) → 댓글·이벤트 created_at 동일 (Postgres now())
    await issue_ctrl.close_issue(SimpleNamespace(comment="<p>done</p>"), branch, task, issue, _req(alice, "gt_a"), db_session)

    res = await issue_ctrl.get_issue(branch, task, issue, _req(alice, "gt_a"), db_session)
    tl = res["timeline"]
    assert [t["kind"] for t in tl] == ["comment", "event"]   # 댓글이 이벤트보다 먼저
    assert tl[0]["created_at"] == tl[1]["created_at"]        # 같은 timestamp 확인
    assert "comments" in res and len(res["comments"]) == 1   # comments 호환 유지


# -- 후속 알림 수신자: 태스크 담당자·닫거나 연 사람 (BG-03) --

async def _assign(db, task_id, user_id, role="main"):
    await db.execute(text("""
        INSERT INTO task_assignee (task_id, user_id, role) VALUES (:t, :u, :r)
    """), {"t": task_id, "u": user_id, "r": role})


async def _types(db, user_id):
    return sorted(n["type"] for n in await noti_model.find_by_user(user_id, db=db))


async def test_comment_notifies_main_and_sub_assignees(db_session):
    qa = await _make_user(db_session, "na_q@t.t", "na_q")    # 이슈 작성자
    dev = await _make_user(db_session, "na_d@t.t", "na_d")   # 주담당자, 댓글 없음
    sub = await _make_user(db_session, "na_s@t.t", "na_s")   # 부담당자, 댓글 없음
    branch = await _make_branch(db_session, qa, name="NA1", key="NA1")
    for u in (qa, dev, sub):
        await _add_member(db_session, branch, u)
    task = await _make_task(db_session, branch, qa)
    await _assign(db_session, task, dev, "main")
    await _assign(db_session, task, sub, "sub")
    issue = await _make_issue(db_session, task, qa)

    res = await issue_ctrl.create_comment(SimpleNamespace(content="<p>safari too</p>"), branch, task, issue, _req(qa, "na_q"), db_session)
    assert res["status"] is True

    assert await _types(db_session, dev) == ["issue_comment"]
    assert await _types(db_session, sub) == ["issue_comment"]
    assert await _types(db_session, qa) == []   # 본인 제외


async def test_close_with_comment_notifies_assignee_once(db_session):
    qa = await _make_user(db_session, "nc_q@t.t", "nc_q")
    dev = await _make_user(db_session, "nc_d@t.t", "nc_d")
    branch = await _make_branch(db_session, qa, name="NC1", key="NC1")
    await _add_member(db_session, branch, qa)
    await _add_member(db_session, branch, dev)
    task = await _make_task(db_session, branch, qa)
    await _assign(db_session, task, dev, "main")
    issue = await _make_issue(db_session, task, qa)

    res = await issue_ctrl.close_issue(SimpleNamespace(comment="<p>verified</p>"), branch, task, issue, _req(qa, "nc_q"), db_session)
    assert res["status_changed"] is True
    assert await _types(db_session, dev) == ["issue_closed"]   # folded: 댓글 알림 없이 1건


async def test_previous_closer_notified_on_comment_and_reopen(db_session):
    qa = await _make_user(db_session, "np_q@t.t", "np_q")    # 이슈 작성자
    dev = await _make_user(db_session, "np_d@t.t", "np_d")   # 담당자 아님, 댓글 없이 닫기만
    branch = await _make_branch(db_session, qa, name="NP1", key="NP1")
    await _add_member(db_session, branch, qa)
    await _add_member(db_session, branch, dev)
    task = await _make_task(db_session, branch, qa)
    issue = await _make_issue(db_session, task, qa)

    await issue_ctrl.close_issue(SimpleNamespace(comment=None), branch, task, issue, _req(dev, "np_d"), db_session)
    await issue_ctrl.create_comment(SimpleNamespace(content="<p>still broken</p>"), branch, task, issue, _req(qa, "np_q"), db_session)
    res = await issue_ctrl.reopen_issue(SimpleNamespace(comment=None), branch, task, issue, _req(qa, "np_q"), db_session)
    assert res["status_changed"] is True

    assert await _types(db_session, dev) == ["issue_comment", "issue_reopened"]


async def test_assignee_who_closed_gets_one_notification_per_action(db_session):
    qa = await _make_user(db_session, "nd_q@t.t", "nd_q")
    dev = await _make_user(db_session, "nd_d@t.t", "nd_d")   # 담당자이면서 과거에 닫은 사람
    branch = await _make_branch(db_session, qa, name="ND1", key="ND1")
    await _add_member(db_session, branch, qa)
    await _add_member(db_session, branch, dev)
    task = await _make_task(db_session, branch, qa)
    await _assign(db_session, task, dev, "main")
    issue = await _make_issue(db_session, task, qa)

    await issue_ctrl.close_issue(SimpleNamespace(comment=None), branch, task, issue, _req(dev, "nd_d"), db_session)
    await issue_ctrl.reopen_issue(SimpleNamespace(comment="<p>reproduced</p>"), branch, task, issue, _req(qa, "nd_q"), db_session)

    assert await _types(db_session, dev) == ["issue_reopened"]   # 중복 제거 + folded


async def test_create_issue_without_assignee_notifies_task_creator(db_session):
    owner = await _make_user(db_session, "nf_o@t.t", "nf_o")   # 태스크 생성자
    qa = await _make_user(db_session, "nf_q@t.t", "nf_q")
    branch = await _make_branch(db_session, owner, name="NF1", key="NF1")
    await _add_member(db_session, branch, owner)
    await _add_member(db_session, branch, qa)
    task = await _make_task(db_session, branch, owner)       # 담당자 없음

    res = await issue_ctrl.create_issue(SimpleNamespace(title="Bug", body=None), branch, task, _req(qa, "nf_q"), db_session)
    assert res["status"] is True
    assert await _types(db_session, owner) == ["issue_created"]


async def test_create_issue_with_assignee_does_not_notify_task_creator(db_session):
    owner = await _make_user(db_session, "nk_o@t.t", "nk_o")
    dev = await _make_user(db_session, "nk_d@t.t", "nk_d")
    qa = await _make_user(db_session, "nk_q@t.t", "nk_q")
    branch = await _make_branch(db_session, owner, name="NK1", key="NK1")
    for u in (owner, dev, qa):
        await _add_member(db_session, branch, u)
    task = await _make_task(db_session, branch, owner)
    await _assign(db_session, task, dev, "main")

    await issue_ctrl.create_issue(SimpleNamespace(title="Bug", body=None), branch, task, _req(qa, "nk_q"), db_session)
    assert await _types(db_session, dev) == ["issue_created"]
    assert await _types(db_session, owner) == []   # 담당자가 있으면 생성자 폴백 없음


async def test_new_follower_sources_skip_users_who_left_branch(db_session):
    qa = await _make_user(db_session, "nx_q@t.t", "nx_q")
    gone = await _make_user(db_session, "nx_g@t.t", "nx_g")   # 담당자·닫은 사람·태스크 생성자였다가 브랜치를 떠남
    branch = await _make_branch(db_session, qa, name="NX1", key="NX1")
    await _add_member(db_session, branch, qa)
    await _add_member(db_session, branch, gone)
    task = await _make_task(db_session, branch, qa)
    await _assign(db_session, task, gone, "main")
    issue = await _make_issue(db_session, task, qa)
    await issue_ctrl.close_issue(SimpleNamespace(comment=None), branch, task, issue, _req(gone, "nx_g"), db_session)
    orphan_task = await _make_task(db_session, branch, gone, title="Orphan")   # 담당자 없음
    await db_session.execute(text("DELETE FROM branch_member WHERE branch_id = :b AND user_id = :u"), {"b": branch, "u": gone})

    await issue_ctrl.reopen_issue(SimpleNamespace(comment="<p>again</p>"), branch, task, issue, _req(qa, "nx_q"), db_session)
    await issue_ctrl.create_comment(SimpleNamespace(content="<p>more</p>"), branch, task, issue, _req(qa, "nx_q"), db_session)
    await issue_ctrl.create_issue(SimpleNamespace(title="Bug", body=None), branch, orphan_task, _req(qa, "nx_q"), db_session)

    assert await _types(db_session, gone) == []   # 비멤버에게는 딥링크 알림을 보내지 않음
