"""쓰기 경로 5곳 markdown ingress 휴리스틱 (§3.4).

HTML 통과·md 변환·plain text 개행 보존을 컨트롤러 직접 호출로 검증.
Style: test_controller_task_errors.py (raw INSERT 시드 + 실제 스키마 객체).
"""
from types import SimpleNamespace

from sqlalchemy import text

from core.controller import canvas_page as page_ctrl
from core.controller import task as task_ctrl
from core.controller import task_comment as comment_ctrl
from core.controller import task_issue as issue_ctrl
from core.model import canvas_page as page_model
from core.model import task as task_model
from core.model import task_issue as issue_model
from routers.schema import canvas_page as page_schema
from routers.schema import task as task_schema
from routers.schema import task_comment as comment_schema
from routers.schema import task_issue as issue_schema


def _req(user_id, username="tester"):
    return SimpleNamespace(state=SimpleNamespace(
        payload={"user_id": user_id, "username": username}))


# --- 시드 헬퍼: test_controller_task_errors.py:33-99에서 그대로 복제 ---

async def _make_user(db, email, username):
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status)
        VALUES (:e, :p, :u, 'active') RETURNING user_id
    """), {"e": email, "p": b"x", "u": username})
    return row.scalar_one()


async def _make_branch(db, created_by, name="Branch", key="KEY"):
    """Create a branch and seed its 4 default workflow statuses + default task_type."""
    row = await db.execute(text("""
        INSERT INTO branch (branch_name, key, description, visibility, color, created_by)
        VALUES (:n, :k, 'desc', 'private', '#5E6AD2', :u) RETURNING branch_id
    """), {"n": name, "k": key, "u": created_by})
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
    # default task_type so create() passes INVALID_TASK_TYPE check
    await db.execute(text("""
        INSERT INTO task_type_config (branch_id, type_key, type_name, icon, color, sort_order)
        VALUES (:b, 'task', 'Task', 'check', '#5E6AD2', 0)
    """), {"b": bid})
    return bid


async def _add_member(db, branch_id, user_id, role="member"):
    await db.execute(text("""
        INSERT INTO branch_member (branch_id, user_id, role)
        VALUES (:b, :u, :r)
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


async def _make_task_sequence(db, branch_id):
    await db.execute(text("""
        INSERT INTO task_sequence (branch_id, last_number)
        VALUES (:b, COALESCE((SELECT MAX(display_number) FROM task WHERE branch_id = :b), 0))
        ON CONFLICT (branch_id) DO UPDATE SET last_number = EXCLUDED.last_number
    """), {"b": branch_id})


# canvas 시드 — test_ref_status_hydration.py:64-83에서 그대로 복제
async def _make_canvas(db, created_by, name="Canvas", key="CVS"):
    # canvas.key는 NOT NULL + UNIQUE (migrations/versions/012_create_wiki_tables.py)
    row = await db.execute(text("""
        INSERT INTO canvas (canvas_name, key, created_by)
        VALUES (:n, :k, :u) RETURNING canvas_id
    """), {"n": name, "k": key, "u": created_by})
    cid = row.scalar_one()
    await db.execute(text("""
        INSERT INTO canvas_member (canvas_id, user_id, role)
        VALUES (:c, :u, 'owner')
    """), {"c": cid, "u": created_by})
    return cid


async def _seed_branch(db, key):
    user = await _make_user(db, f"{key}@ing.test", key)
    branch = await _make_branch(db, user, name=key, key=key)
    await _add_member(db, branch, user, "member")
    await _make_task_sequence(db, branch)
    return user, branch


# ---- task.description ----

async def test_task_create_converts_markdown_description(db_session):
    user, branch = await _seed_branch(db_session, "ING_A")
    body = task_schema.TaskCreate(title="t", description="# 제목\n\n- 항목")
    res = await task_ctrl.create(body, branch, _req(user), db_session)
    assert res["status"] is True
    task = await task_model.find_by_id(res["task_id"], db_session)
    assert "<h1>제목</h1>" in task["description"]
    assert "<li>항목</li>" in task["description"]


async def test_task_create_html_passthrough(db_session):
    user, branch = await _seed_branch(db_session, "ING_B")
    html = '<p>이미 <strong>HTML</strong></p>'
    body = task_schema.TaskCreate(title="t", description=html)
    res = await task_ctrl.create(body, branch, _req(user), db_session)
    task = await task_model.find_by_id(res["task_id"], db_session)
    assert task["description"] == html


async def test_task_create_empty_label_link_fallback(db_session):
    # [](url)이 빈 <a></a>로 렌더되면 ingress에서 URL 무음 소실 — 라벨 폴백 계약(WEAVE-37)
    user, branch = await _seed_branch(db_session, "ING_LNK")
    body = task_schema.TaskCreate(title="t", description="[](https://example.com)")
    res = await task_ctrl.create(body, branch, _req(user), db_session)
    assert res["status"] is True
    task = await task_model.find_by_id(res["task_id"], db_session)
    assert '>https://example.com</a>' in task["description"]


async def test_task_update_converts_markdown(db_session):
    user, branch = await _seed_branch(db_session, "ING_C")
    tid = await _make_task(db_session, branch, user)
    body = task_schema.TaskUpdate(description="**굵게**")
    res = await task_ctrl.update(tid, body, branch, _req(user), db_session)
    assert res["status"] is True
    task = await task_model.find_by_id(tid, db_session)
    assert "<strong>굵게</strong>" in task["description"]


# ---- task_comment.content ----

async def test_comment_create_and_update_convert_markdown(db_session):
    user, branch = await _seed_branch(db_session, "ING_D")
    tid = await _make_task(db_session, branch, user)
    res = await comment_ctrl.create_comment(
        comment_schema.CommentCreate(content="line1\nline2"), branch, tid,
        _req(user), db_session)
    assert res["status"] is True
    assert "<br" in res["comment"]["content"]  # plain text 개행 보존(breaks=True)
    cid = res["comment"]["comment_id"]
    res2 = await comment_ctrl.update_comment(
        comment_schema.CommentUpdate(content="**수정**"), branch, tid, cid,
        _req(user), db_session)
    assert "<strong>수정</strong>" in res2["comment"]["content"]


# ---- task_issue.body + issue comment (close 포함) ----

async def test_issue_body_and_comments_convert_markdown(db_session):
    user, branch = await _seed_branch(db_session, "ING_E")
    tid = await _make_task(db_session, branch, user)
    res = await issue_ctrl.create_issue(
        issue_schema.IssueCreate(title="이슈", body="- [ ] 할일"), branch, tid,
        _req(user), db_session)
    assert res["status"] is True
    iid = res["issue_id"]
    issue = await issue_model.find_by_id(iid, db_session)
    assert "checkbox" in issue["body"]

    await issue_ctrl.update_issue(
        issue_schema.IssueUpdate(body="**갱신**"), branch, tid, iid,
        _req(user), db_session)
    issue = await issue_model.find_by_id(iid, db_session)
    assert "<strong>갱신</strong>" in issue["body"]

    await issue_ctrl.create_comment(
        issue_schema.CommentCreate(content="`code` 댓글"), branch, tid, iid,
        _req(user), db_session)
    # close-with-comment 경로도 동일 휴리스틱
    await issue_ctrl.close_issue(
        issue_schema.IssueTransition(comment="**닫으며** 한마디"), branch, tid, iid,
        _req(user), db_session)
    comments = await issue_model.find_comments(iid, db_session)
    assert any("<code>code</code>" in c["content"] for c in comments)
    assert any("<strong>닫으며</strong>" in c["content"] for c in comments)


async def test_issue_comment_update_converts_markdown_and_passthrough(db_session):
    # update_comment(이슈 댓글 수정) 경로 — md 변환 + HTML 무변환 통과 둘 다 검증.
    user, branch = await _seed_branch(db_session, "ING_F")
    tid = await _make_task(db_session, branch, user)
    res = await issue_ctrl.create_issue(
        issue_schema.IssueCreate(title="이슈"), branch, tid, _req(user), db_session)
    iid = res["issue_id"]
    cres = await issue_ctrl.create_comment(
        issue_schema.CommentCreate(content="원본 댓글"), branch, tid, iid,
        _req(user), db_session)
    assert cres["status"] is True
    cid = cres["comment_id"]

    res2 = await issue_ctrl.update_comment(
        issue_schema.CommentUpdate(content="**수정된** 댓글"), branch, tid, iid, cid,
        _req(user), db_session)
    assert res2["status"] is True
    comments = await issue_model.find_comments(iid, db_session)
    target = next(c for c in comments if c["comment_id"] == cid)
    assert "<strong>수정된</strong>" in target["content"]

    html = '<p>그대로 <em>HTML</em></p>'
    res3 = await issue_ctrl.update_comment(
        issue_schema.CommentUpdate(content=html), branch, tid, iid, cid,
        _req(user), db_session)
    assert res3["status"] is True
    comments = await issue_model.find_comments(iid, db_session)
    target = next(c for c in comments if c["comment_id"] == cid)
    assert target["content"] == html


# ---- canvas_page.content (ensure_html이 sanitize_html보다 먼저) ----

async def test_canvas_page_create_and_update_convert_markdown(db_session):
    user = await _make_user(db_session, "cv@ing.test", "cv_ing")
    canvas = await _make_canvas(db_session, user, name="C", key="INGC")
    res = await page_ctrl.create(
        canvas, page_schema.CanvasPageCreate(title="p", content="# 문서 제목"),
        _req(user), db_session)
    assert res["status"] is True
    page = await page_model.find_by_id(res["page_id"], db_session)
    assert "<h1>문서 제목</h1>" in page["content"]

    await page_ctrl.update(
        canvas, res["page_id"], page_schema.CanvasPageUpdate(content="**본문**"),
        _req(user), db_session)
    page = await page_model.find_by_id(res["page_id"], db_session)
    assert "<strong>본문</strong>" in page["content"]


async def test_canvas_typst_page_content_untouched(db_session):
    # typst 페이지의 content는 raw Typst 소스 — md 변환도 sanitize도 금지 (P0 가드).
    # <intro>는 Typst 라벨 문법: nh3에 태우면 미지 태그로 제거된다(기존 잠재버그의 재현 핀).
    user = await _make_user(db_session, "ty@ing.test", "ty_ing")
    canvas = await _make_canvas(db_session, user, name="T", key="INGT")
    src = "#set page(margin: 2cm)\n= 제목 <intro>\n본문 *강조*, @intro 참조"
    res = await page_ctrl.create(
        canvas, page_schema.CanvasPageCreate(title="t", content=src, type="typst"),
        _req(user), db_session)
    page = await page_model.find_by_id(res["page_id"], db_session)
    assert page["content"] == src  # <intro> 라벨 포함 바이트 동일

    src2 = src + "\n#pagebreak()"
    await page_ctrl.update(
        canvas, res["page_id"], page_schema.CanvasPageUpdate(content=src2),
        _req(user), db_session)
    page = await page_model.find_by_id(res["page_id"], db_session)
    assert page["content"] == src2


async def test_canvas_typst_page_copy_keeps_source_byte_identical(db_session):
    # 복제도 create/update와 같은 P0 가드(TY-01): nh3에 태우면 <intro> 라벨이 지워지고
    # '<'·'&'가 '&lt;'·'&amp;'로 바뀌어 복제본이 컴파일 오류가 나거나 PDF에 엔티티가 찍힌다.
    user = await _make_user(db_session, "tyc@ing.test", "tyc_ing")
    canvas = await _make_canvas(db_session, user, name="TC", key="INGTC")
    src = ('#set heading(numbering: "1.")\n= 개요 <intro>\n'
           "@intro 참조, 수식 $a < b$, R&D 팀\n#let x = 1 < 2\n")
    res = await page_ctrl.create(
        canvas, page_schema.CanvasPageCreate(title="t", content=src, type="typst"),
        _req(user), db_session)

    copied = await page_ctrl.copy(
        canvas, res["page_id"], page_schema.CanvasPageCopy(), _req(user), db_session)
    assert copied["status"] is True
    page = await page_model.find_by_id(copied["page_id"], db_session)
    assert page["type"] == "typst"
    assert page["content"] == src  # 라벨·'<'·'&' 포함 원본과 바이트 동일


async def test_canvas_document_page_copy_still_sanitized(db_session):
    # 반대쪽 분기 핀: document 복제는 계속 정화한다(SEC-17 — 정화 도입 전에 저장된 오염의 전파 차단).
    # create 경로는 이미 정화하므로 레거시 행은 직접 INSERT로 흉내낸다.
    user = await _make_user(db_session, "dcc@ing.test", "dcc_ing")
    canvas = await _make_canvas(db_session, user, name="DC", key="INGDC")
    row = await db_session.execute(text("""
        INSERT INTO canvas_page (canvas_id, title, content, position, created_by, updated_by, type)
        VALUES (:c, 'legacy', :html, 0, :u, :u, 'document') RETURNING page_id
    """), {"c": canvas, "u": user, "html": "<p>ok</p><script>alert(1)</script>"})
    pid = row.scalar_one()

    copied = await page_ctrl.copy(
        canvas, pid, page_schema.CanvasPageCopy(), _req(user), db_session)
    assert copied["status"] is True
    page = await page_model.find_by_id(copied["page_id"], db_session)
    assert "<script" not in page["content"]
    assert "<p>ok</p>" in page["content"]


async def test_canvas_overview_page_update_converts_markdown(db_session):
    # update의 'overview' 분기도 document와 동일하게 변환+정화 대상.
    # overview 페이지는 page_ctrl.create로 못 만들므로(canvas 생성 시에만 시딩) 직접 INSERT.
    user = await _make_user(db_session, "ov@ing.test", "ov_ing")
    canvas = await _make_canvas(db_session, user, name="O", key="INGO")
    row = await db_session.execute(text("""
        INSERT INTO canvas_page (canvas_id, title, content, position, created_by, updated_by, type)
        VALUES (:c, 'Overview', '', 0, :u, :u, 'overview') RETURNING page_id
    """), {"c": canvas, "u": user})
    pid = row.scalar_one()

    res = await page_ctrl.update(
        canvas, pid, page_schema.CanvasPageUpdate(content="## 개요"),
        _req(user), db_session)
    assert res["status"] is True
    page = await page_model.find_by_id(pid, db_session)
    assert "<h2>개요</h2>" in page["content"]
