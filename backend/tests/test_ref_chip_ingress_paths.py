"""Weave 링크 → ref 칩 저장: 멤버 범위 조회·ingest_rich_text·저장 경로 (DB 사용).

설계: docs/superpowers/specs/2026-10-22-ref-link-chip-ingress-design.md §5.1·§5.3·§5.5·§5.8
Style: test_markdown_ingress.py (raw INSERT 시드 + 컨트롤러 직접 호출).
"""
from types import SimpleNamespace

import pytest
from sqlalchemy import text

import config
from core.model import canvas_page as page_model
from core.model import task as task_model
from core.model import task_issue as issue_model
from library import origins
from library import ref_chip_ingress as rci
from library.html_markdown import markdown_to_html
from library.html_sanitize import sanitize_html


def _req(user_id, username="tester"):
    return SimpleNamespace(state=SimpleNamespace(
        payload={"user_id": user_id, "username": username}))


@pytest.fixture(autouse=True)
def _internal_origin(monkeypatch):
    # 절대 주소 판정을 환경과 무관하게 고정한다(운영은 ALLOWED_ORIGINS에 공개 주소).
    monkeypatch.setattr(config, 'FRONTEND_URL', '')
    monkeypatch.setattr(origins, 'ALLOWED_ORIGIN_LIST', ['http://localhost:3000'])


# --- 시드 (test_markdown_ingress.py / test_ref_status_hydration.py 방식) ---------

async def _make_user(db, email, username):
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status)
        VALUES (:e, :p, :u, 'active') RETURNING user_id
    """), {"e": email, "p": b"x", "u": username})
    return row.scalar_one()


async def _make_branch(db, created_by, key):
    row = await db.execute(text("""
        INSERT INTO branch (branch_name, key, description, visibility, color, created_by)
        VALUES (:n, :k, 'desc', 'private', '#5E6AD2', :u) RETURNING branch_id
    """), {"n": key, "k": key, "u": created_by})
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
    await db.execute(text("""
        INSERT INTO task_type_config (branch_id, type_key, type_name, icon, color, sort_order)
        VALUES (:b, 'task', 'Task', 'check', '#5E6AD2', 0)
    """), {"b": bid})
    await db.execute(text("""
        INSERT INTO task_sequence (branch_id, last_number) VALUES (:b, 0)
        ON CONFLICT (branch_id) DO NOTHING
    """), {"b": bid})
    return bid


async def _add_member(db, branch_id, user_id, role="member"):
    await db.execute(text("""
        INSERT INTO branch_member (branch_id, user_id, role) VALUES (:b, :u, :r)
    """), {"b": branch_id, "u": user_id, "r": role})


async def _make_task(db, branch_id, created_by, title="Task", status="todo"):
    row = await db.execute(text(
        "SELECT COALESCE(MAX(display_number), 0) + 1 FROM task WHERE branch_id = :b"), {"b": branch_id})
    dn = row.scalar_one()
    res = await db.execute(text("""
        INSERT INTO task (branch_id, display_number, title, status, created_by)
        VALUES (:b, :dn, :t, :s, :u) RETURNING task_id
    """), {"b": branch_id, "dn": dn, "t": title, "s": status, "u": created_by})
    await db.execute(text("UPDATE task_sequence SET last_number = :dn WHERE branch_id = :b"),
                     {"dn": dn, "b": branch_id})
    return res.scalar_one()


async def _make_issue(db, task_id, created_by, title="Issue", status="open"):
    res = await db.execute(text("""
        INSERT INTO task_issue (task_id, title, body, status, created_by)
        VALUES (:t, :title, 'body', :s, :u) RETURNING issue_id
    """), {"t": task_id, "title": title, "s": status, "u": created_by})
    return res.scalar_one()


async def _make_canvas(db, created_by, key, name="Canvas"):
    row = await db.execute(text("""
        INSERT INTO canvas (canvas_name, key, created_by) VALUES (:n, :k, :u) RETURNING canvas_id
    """), {"n": name, "k": key, "u": created_by})
    cid = row.scalar_one()
    await db.execute(text("""
        INSERT INTO canvas_member (canvas_id, user_id, role) VALUES (:c, :u, 'owner')
    """), {"c": cid, "u": created_by})
    return cid


async def _make_page(db, canvas_id, created_by, title="Page"):
    res = await db.execute(text("""
        INSERT INTO canvas_page (canvas_id, title, created_by) VALUES (:c, :t, :u) RETURNING page_id
    """), {"c": canvas_id, "t": title, "u": created_by})
    return res.scalar_one()


async def _world(db, prefix):
    """user가 멤버인 브랜치 B·캔버스 C와, 멤버가 아닌 브랜치 X를 만든다."""
    user = await _make_user(db, f"{prefix}@rci.test", prefix)
    other = await _make_user(db, f"{prefix}o@rci.test", f"{prefix}o")
    b = await _make_branch(db, user, f"{prefix}B")
    await _add_member(db, b, user)
    x = await _make_branch(db, other, f"{prefix}X")
    await _add_member(db, x, other)
    c = await _make_canvas(db, user, f"{prefix}C", name="제품")
    return SimpleNamespace(user=user, other=other, b=b, x=x, c=c)


# --- ingest_rich_text (§5.3·§5.8) ------------------------------------------------

async def test_ingest_converts_member_task_link(db_session):
    w = await _world(db_session, "RCA")
    t = await _make_task(db_session, w.b, w.user, title="기본 결과")
    md = f'앞 [PRO-undefined](/branch/{w.b}/task/{t}) 뒤 [abs](http://localhost:3000/branch/{w.b}/task/{t})'
    out = await rci.ingest_rich_text(md, user_id=w.user, db=db_session)
    assert out.count(f'data-task-ref="true" data-task-id="{t}" data-branch-id="{w.b}"') == 2
    assert f'>RCAB-1 기본 결과<span' in out
    assert 'PRO-undefined' not in out and '<a ' not in out


async def test_ingest_issue_and_doc_chips(db_session):
    w = await _world(db_session, "RCB")
    t = await _make_task(db_session, w.b, w.user, title="부모")
    i = await _make_issue(db_session, t, w.user, title="재현", status="closed")
    p = await _make_page(db_session, w.c, w.user, title="설계")
    md = f'[a](/branch/{w.b}/task/{t}/issue/{i}) [b](/canvas/{w.c}/{p})'
    out = await rci.ingest_rich_text(md, user_id=w.user, db=db_session)
    assert (f'<span data-issue-ref="true" data-issue-id="{i}" data-task-id="{t}" '
            f'data-branch-id="{w.b}" data-display-id="RCBB-1" data-title="재현" data-status="closed" '
            f'class="issue-ref">RCBB-1 재현') in out
    assert '>Closed</span>' in out
    assert (f'<span data-doc-ref="true" data-page-id="{p}" data-canvas-id="{w.c}" data-title="설계" '
            f'data-canvas-name="제품" class="doc-ref">설계</span>') in out


async def test_ingest_keeps_link_when_not_chippable(db_session):
    w = await _world(db_session, "RCC")
    t = await _make_task(db_session, w.b, w.user, title="정상")
    t2 = await _make_task(db_session, w.b, w.user, title="둘째")
    tx = await _make_task(db_session, w.x, w.other, title="남의 것")
    i = await _make_issue(db_session, t, w.user)
    p = await _make_page(db_session, w.c, w.user)
    other_c = await _make_canvas(db_session, w.user, "RCCD")
    arch_b = await _make_branch(db_session, w.user, "RCCA")
    await _add_member(db_session, arch_b, w.user)
    ta = await _make_task(db_session, arch_b, w.user)
    await db_session.execute(text("UPDATE branch SET is_archived = TRUE WHERE branch_id = :b"), {"b": arch_b})
    arch_c = await _make_canvas(db_session, w.user, "RCCE")
    pa = await _make_page(db_session, arch_c, w.user)
    await db_session.execute(text("UPDATE canvas SET is_archived = TRUE WHERE canvas_id = :c"), {"c": arch_c})
    p_arch = await _make_page(db_session, w.c, w.user)
    await db_session.execute(text("UPDATE canvas_page SET is_archived = TRUE WHERE page_id = :p"), {"p": p_arch})
    keep = [
        f'/branch/{w.x}/task/{tx}',              # 비멤버 브랜치
        f'/branch/{w.b}/task/999999',            # 없는 태스크
        f'/branch/{w.x}/task/{t}',               # 브랜치 id 불일치
        f'/branch/{w.b}/task/{t2}/issue/{i}',    # 이슈의 태스크 불일치
        f'/canvas/{other_c}/{p}',                # 문서 캔버스 불일치
        f'/branch/{arch_b}/task/{ta}',           # 보관 브랜치
        f'/canvas/{arch_c}/{pa}',                # 보관 캔버스
        f'/canvas/{w.c}/{p_arch}',               # 보관 페이지
    ]
    md = f'[ok](/branch/{w.b}/task/{t}) ' + ' '.join(f'[k{n}]({href})' for n, href in enumerate(keep))
    out = await rci.ingest_rich_text(md, user_id=w.user, db=db_session)
    assert out.count('data-task-ref="true"') == 1
    for n, href in enumerate(keep):
        assert f'<a href="{href}">k{n}</a>' in out


async def test_ingest_html_input_untouched(db_session):
    w = await _world(db_session, "RCD")
    t = await _make_task(db_session, w.b, w.user)
    html = f'<p>x <a href="/branch/{w.b}/task/{t}">a</a></p>'
    assert await rci.ingest_rich_text(html, user_id=w.user, db=db_session) == html
    assert await rci.ingest_rich_text(html, user_id=w.user, db=db_session, sanitize=True) == sanitize_html(html)
    assert await rci.ingest_rich_text('', user_id=w.user, db=db_session) == ''
    assert await rci.ingest_rich_text(None, user_id=w.user, db=db_session) is None


async def test_ingest_no_links_identical(db_session):
    w = await _world(db_session, "RCE")
    md = '# 제목\n\n- 항목 [외부](https://github.com)'
    assert await rci.ingest_rich_text(md, user_id=w.user, db=db_session) == markdown_to_html(md)
    assert (await rci.ingest_rich_text(md, user_id=w.user, db=db_session, sanitize=True)
            == sanitize_html(markdown_to_html(md)))


async def test_ingest_limit_fallback_byte_identical(db_session):
    w = await _world(db_session, "RCF")
    t = await _make_task(db_session, w.b, w.user, title="한도")
    md = f'- [x](/branch/{w.b}/task/{t})'
    chip = await rci.ingest_rich_text(md, user_id=w.user, db=db_session)
    assert 'data-task-ref' in chip
    bound = rci.reserialize_upper_bound(chip)
    assert await rci.ingest_rich_text(md, user_id=w.user, db=db_session, limit=bound) == chip
    assert await rci.ingest_rich_text(md, user_id=w.user, db=db_session, limit=bound - 1) == markdown_to_html(md)


async def test_ingest_canvas_sanitize_then_bound(db_session):
    w = await _world(db_session, "RCG")
    t = await _make_task(db_session, w.b, w.user, title="캔버스")
    md = f'[x](/branch/{w.b}/task/{t}) [y](https://github.com)'
    out = await rci.ingest_rich_text(md, user_id=w.user, db=db_session, sanitize=True)
    assert 'data-task-ref' in out and 'style="background-color:#9CA3AF20;color:#9CA3AF"' in out
    assert out == sanitize_html(out)
    bound = rci.reserialize_upper_bound(out)
    assert await rci.ingest_rich_text(md, user_id=w.user, db=db_session, sanitize=True, limit=bound) == out
    assert (await rci.ingest_rich_text(md, user_id=w.user, db=db_session, sanitize=True, limit=bound - 1)
            == sanitize_html(markdown_to_html(md)))


async def test_lookup_single_query_per_kind(db_session, monkeypatch):
    w = await _world(db_session, "RCH")
    t1 = await _make_task(db_session, w.b, w.user)
    t2 = await _make_task(db_session, w.b, w.user)
    i1 = await _make_issue(db_session, t1, w.user)
    i2 = await _make_issue(db_session, t2, w.user)
    p = await _make_page(db_session, w.c, w.user)
    calls = {'task': 0, 'issue': 0, 'page': 0}

    def counting(kind, fn):
        async def wrapper(*args, **kwargs):
            calls[kind] += 1
            return await fn(*args, **kwargs)
        return wrapper

    monkeypatch.setattr(task_model, 'find_chip_refs', counting('task', task_model.find_chip_refs))
    monkeypatch.setattr(issue_model, 'find_chip_refs', counting('issue', issue_model.find_chip_refs))
    monkeypatch.setattr(page_model, 'find_chip_refs', counting('page', page_model.find_chip_refs))
    md = ' '.join([
        f'[a](/branch/{w.b}/task/{t1})', f'[b](/branch/{w.b}/task/{t1})', f'[c](/branch/{w.b}/task/{t2})',
        f'[d](/branch/{w.b}/task/{t1}/issue/{i1})', f'[e](/branch/{w.b}/task/{t2}/issue/{i2})',
        f'[f](/canvas/{w.c}/{p})',
    ])
    out = await rci.ingest_rich_text(md, user_id=w.user, db=db_session)
    assert calls == {'task': 1, 'issue': 1, 'page': 1}
    assert out.count('data-task-ref') == 3 and out.count('data-issue-ref') == 2 and out.count('data-doc-ref') == 1


# --- 11개 저장 경로 (§5.1) --------------------------------------------------------

from core.controller import canvas_page as page_ctrl  # noqa: E402
from core.controller import task as task_ctrl  # noqa: E402
from core.controller import task_comment as comment_ctrl  # noqa: E402
from core.controller import task_issue as issue_ctrl  # noqa: E402
from library.html_markdown import html_to_markdown  # noqa: E402
from routers.schema import canvas_page as page_schema  # noqa: E402
from routers.schema import task as task_schema  # noqa: E402
from routers.schema import task_comment as comment_schema  # noqa: E402
from routers.schema import task_issue as issue_schema  # noqa: E402

CHIP = 'data-task-ref="true"'


async def _linked(db, prefix):
    w = await _world(db, prefix)
    target = await _make_task(db, w.b, w.user, title="대상")
    host = await _make_task(db, w.b, w.user, title="글")
    w.target, w.host = target, host
    w.md = f'참고 [PRO-undefined](/branch/{w.b}/task/{target})'
    return w


async def test_path_task_create_and_update(db_session):
    w = await _linked(db_session, "RP1")
    res = await task_ctrl.create(task_schema.TaskCreate(title="t", description=w.md), w.b, _req(w.user), db_session)
    assert CHIP in (await task_model.find_by_id(res["task_id"], db_session))["description"]
    await task_ctrl.update(w.host, task_schema.TaskUpdate(description=w.md), w.b, _req(w.user), db_session)
    assert CHIP in (await task_model.find_by_id(w.host, db_session))["description"]


async def test_path_task_comment_create_and_update(db_session):
    w = await _linked(db_session, "RP2")
    res = await comment_ctrl.create_comment(
        comment_schema.CommentCreate(content=w.md), w.b, w.host, _req(w.user), db_session)
    assert CHIP in res["comment"]["content"]
    res2 = await comment_ctrl.update_comment(
        comment_schema.CommentUpdate(content=w.md + ' 수정'), w.b, w.host, res["comment"]["comment_id"],
        _req(w.user), db_session)
    assert CHIP in res2["comment"]["content"]


async def test_path_issue_body_comments_and_close(db_session):
    w = await _linked(db_session, "RP3")
    res = await issue_ctrl.create_issue(
        issue_schema.IssueCreate(title="이슈", body=w.md), w.b, w.host, _req(w.user), db_session)
    iid = res["issue_id"]
    assert CHIP in (await issue_model.find_by_id(iid, db_session))["body"]
    await issue_ctrl.update_issue(
        issue_schema.IssueUpdate(body=w.md + ' 갱신'), w.b, w.host, iid, _req(w.user), db_session)
    assert CHIP in (await issue_model.find_by_id(iid, db_session))["body"]
    cres = await issue_ctrl.create_comment(
        issue_schema.CommentCreate(content=w.md + ' 댓글'), w.b, w.host, iid, _req(w.user), db_session)
    await issue_ctrl.update_comment(
        issue_schema.CommentUpdate(content=w.md + ' 댓글 수정'), w.b, w.host, iid, cres["comment_id"],
        _req(w.user), db_session)
    await issue_ctrl.close_issue(
        issue_schema.IssueTransition(comment=w.md + ' 닫으며'), w.b, w.host, iid, _req(w.user), db_session)
    comments = await issue_model.find_comments(iid, db_session)
    edited = next(c for c in comments if c["comment_id"] == cres["comment_id"])
    assert CHIP in edited["content"] and '댓글 수정' in edited["content"]
    assert any(CHIP in c["content"] and '닫으며' in c["content"] for c in comments)


async def test_path_canvas_page_create_and_update(db_session):
    w = await _linked(db_session, "RP4")
    res = await page_ctrl.create(
        w.c, page_schema.CanvasPageCreate(title="p", content=w.md), _req(w.user), db_session)
    page = await page_model.find_by_id(res["page_id"], db_session)
    assert CHIP in page["content"] and 'style="background-color:#9CA3AF20;color:#9CA3AF"' in page["content"]
    await page_ctrl.update(
        w.c, res["page_id"], page_schema.CanvasPageUpdate(content=w.md + ' 갱신'), _req(w.user), db_session)
    page = await page_model.find_by_id(res["page_id"], db_session)
    assert CHIP in page["content"] and '갱신' in page["content"]


async def test_path_comment_over_limit_stores_plain_links(db_session):
    # A안: 칩으로 바꾸면 1만 자 댓글 한도를 넘는 본문은 전체를 기존 출력 그대로 저장한다.
    w = await _world(db_session, "RP5")
    host = await _make_task(db_session, w.b, w.user, title="글")
    tids = [await _make_task(db_session, w.b, w.user, title="새 실험의 기본 결과·3D·Export 연결")
            for _ in range(21)]
    md = ' '.join(f'[PRO-{n}](/branch/{w.b}/task/{t})' for n, t in enumerate(tids))
    res = await comment_ctrl.create_comment(
        comment_schema.CommentCreate(content=md), w.b, host, _req(w.user), db_session)
    assert res["comment"]["content"] == markdown_to_html(md)
    few = ' '.join(f'[PRO-{n}](/branch/{w.b}/task/{t})' for n, t in enumerate(tids[:5]))
    res2 = await comment_ctrl.create_comment(
        comment_schema.CommentCreate(content=few), w.b, host, _req(w.user), db_session)
    assert res2["comment"]["content"].count(CHIP) == 5


async def test_mcp_roundtrip_keeps_chips(db_session):
    # 칩 → MCP 마크다운 읽기(egress) → 그대로 다시 쓰기(ingress) → 칩 유지
    w = await _linked(db_session, "RP6")
    await task_ctrl.update(w.host, task_schema.TaskUpdate(description=w.md), w.b, _req(w.user), db_session)
    stored = (await task_model.find_by_id(w.host, db_session))["description"]
    assert CHIP in stored
    md2 = html_to_markdown(stored)
    assert f'(/branch/{w.b}/task/{w.target})' in md2
    await task_ctrl.update(w.host, task_schema.TaskUpdate(description=md2), w.b, _req(w.user), db_session)
    again = (await task_model.find_by_id(w.host, db_session))["description"]
    assert again == stored


async def test_ingest_out_of_range_id_stays_plain_link(db_session):
    # 독립 리뷰 Important 2: 범위 밖 id가 있어도 저장은 성공하고 그 링크만 일반 링크로 남는다.
    w = await _linked(db_session, "RP7")
    md = w.md + ' [huge](/branch/1/task/3000000000) [long](/branch/1/task/' + '9' * 5000 + ')'
    out = await rci.ingest_rich_text(md, user_id=w.user, db=db_session)
    assert CHIP in out
    assert '<a href="/branch/1/task/3000000000">huge</a>' in out
