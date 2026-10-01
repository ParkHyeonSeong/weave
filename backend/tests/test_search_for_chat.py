"""Inline ref 검색(search_for_chat) 확장 — task/issue/doc 매칭 범위 + 랭킹.

모델 레벨 호출, raw-INSERT seeding, rollback-isolated db_session 픽스처.
(seed 헬퍼는 test_idor_my_tasks_scope.py 패턴을 따른다.)
"""
from sqlalchemy import text

from core.model import task as task_model
from core.model import task_issue as issue_model
from core.model import canvas_page as canvas_page_model


# --------------------------------------------------------------------------
# seed helpers (raw INSERT — 실제 스키마 컬럼명)
# --------------------------------------------------------------------------

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
    bid = row.scalar_one()
    for key_, label, color_, category, sort in [
        ("todo", "To Do", "#9CA3AF", "todo", 0),
        ("done", "Done", "#16A34A", "done", 1),
    ]:
        await db.execute(text("""
            INSERT INTO workflow_status (branch_id, key, label, color, category, sort_order)
            VALUES (:b, :k, :l, :c, :cat, :s)
        """), {"b": bid, "k": key_, "l": label, "c": color_, "cat": category, "s": sort})
    return bid


async def _add_branch_member(db, branch_id, user_id, role="member"):
    await db.execute(text("""
        INSERT INTO branch_member (branch_id, user_id, role)
        VALUES (:b, :u, :r)
    """), {"b": branch_id, "u": user_id, "r": role})


async def _make_task(db, branch_id, created_by, title="task", description=None):
    """task 1건 생성. (task_id, display_number) 반환."""
    row = await db.execute(text(
        "SELECT COALESCE(MAX(display_number), 0) + 1 FROM task WHERE branch_id = :b"),
        {"b": branch_id})
    dn = row.scalar_one()
    res = await db.execute(text("""
        INSERT INTO task (branch_id, display_number, title, description, status, created_by)
        VALUES (:b, :dn, :t, :d, 'todo', :u) RETURNING task_id
    """), {"b": branch_id, "dn": dn, "t": title, "d": description, "u": created_by})
    return res.scalar_one(), dn


async def _seed_branch_with_member(db, email, key):
    """user + branch + 멤버십을 만들고 (user_id, branch_id) 반환."""
    uid = await _make_user(db, email, email.split("@")[0])
    bid = await _make_branch(db, uid, key=key)
    await _add_branch_member(db, bid, uid)
    return uid, bid


# --------------------------------------------------------------------------
# Task 검색
# --------------------------------------------------------------------------

async def test_task_search_matches_description(db_session):
    """제목엔 없고 description 본문에만 있는 키워드로도 찾는다."""
    uid, bid = await _seed_branch_with_member(db_session, "t1@ref.test", "RFA")
    tid, _ = await _make_task(db_session, bid, uid,
                              title="로그인 화면", description="OAuth 리다이렉트 처리")
    res = await task_model.search_for_chat(uid, "OAuth", False, db_session)
    assert any(t["task_id"] == tid for t in res)


async def test_task_search_matches_display_id_and_number(db_session):
    """KEY-번호 형태와 숫자 단독 모두로 찾는다."""
    uid, bid = await _seed_branch_with_member(db_session, "t2@ref.test", "RFB")
    tid, dn = await _make_task(db_session, bid, uid, title="무관한 제목")
    by_key = await task_model.search_for_chat(uid, f"RFB-{dn}", False, db_session)
    by_num = await task_model.search_for_chat(uid, str(dn), False, db_session)
    assert any(t["task_id"] == tid for t in by_key)
    assert any(t["task_id"] == tid for t in by_num)


async def test_task_search_ranks_title_above_body(db_session):
    """제목 매칭이 본문 매칭보다 먼저 온다."""
    uid, bid = await _seed_branch_with_member(db_session, "t3@ref.test", "RFC")
    body_hit, _ = await _make_task(db_session, bid, uid,
                                   title="기타 작업", description="alpha 관련 메모")
    title_hit, _ = await _make_task(db_session, bid, uid, title="alpha 설계")
    res = await task_model.search_for_chat(uid, "alpha", False, db_session)
    ids = [t["task_id"] for t in res]
    assert ids.index(title_hit) < ids.index(body_hit)


async def test_task_search_exact_display_id_ranks_first(db_session):
    """입력이 KEY-번호와 정확히 같으면(대소문자 무시) 그 태스크가 맨 앞에 온다.

    'RFX-1'은 RFX-10·RFX-11의 부분일치이기도 하다. 부분일치 쪽을 더 최근에 수정된 것으로
    만들어, 정확 일치 랭킹이 없으면 그쪽이 앞서도록 한다(⌘K에서 WV-12가 WV-120 아래로 묻히던 회귀).
    """
    uid, bid = await _seed_branch_with_member(db_session, "t5@ref.test", "RFX")
    exact_id, dn = await _make_task(db_session, bid, uid, title="정확 일치 대상")    # RFX-1
    others = [(await _make_task(db_session, bid, uid, title="다른 태스크"))[0]
              for _ in range(10)]                                                   # RFX-2..RFX-11
    await db_session.execute(
        text("UPDATE task SET updated_at = NOW() + interval '1 hour' WHERE task_id = ANY(:ids)"),
        {"ids": others})
    for q in (f"RFX-{dn}", f"rfx-{dn}"):
        res = await task_model.search_for_chat(uid, q, False, db_session)
        ids = [t["task_id"] for t in res]
        assert len(ids) >= 3, q                 # RFX-1 + 부분일치 RFX-10·RFX-11
        assert ids[0] == exact_id, q


async def test_task_search_result_has_no_rank_key(db_session):
    """정렬 보조 _rank 는 응답에 노출되지 않는다(스키마 불변)."""
    uid, bid = await _seed_branch_with_member(db_session, "t4@ref.test", "RFD")
    await _make_task(db_session, bid, uid, title="visible")
    res = await task_model.search_for_chat(uid, "visible", False, db_session)
    assert res and "_rank" not in res[0]
    assert res[0]["display_id"] == f"RFD-{res[0]['display_number']}"


# --------------------------------------------------------------------------
# Issue 검색
# --------------------------------------------------------------------------

async def _make_issue(db, task_id, created_by, title="issue", body=None):
    res = await db.execute(text("""
        INSERT INTO task_issue (task_id, title, body, created_by)
        VALUES (:t, :ti, :b, :u) RETURNING issue_id
    """), {"t": task_id, "ti": title, "b": body, "u": created_by})
    return res.scalar_one()


async def test_issue_search_matches_body(db_session):
    """제목엔 없고 body 본문에만 있는 키워드로도 찾는다."""
    uid, bid = await _seed_branch_with_member(db_session, "i1@ref.test", "RFI")
    tid, _ = await _make_task(db_session, bid, uid, title="parent")
    iid = await _make_issue(db_session, tid, uid,
                            title="재현 안 됨", body="staging 에서 timeout 발생")
    res = await issue_model.search_for_chat(uid, "timeout", db_session)
    assert any(i["issue_id"] == iid for i in res)


async def test_issue_search_matches_parent_task_id(db_session):
    """부모 task 의 KEY-번호 로도 그 task 의 이슈를 찾는다."""
    uid, bid = await _seed_branch_with_member(db_session, "i2@ref.test", "RFJ")
    tid, dn = await _make_task(db_session, bid, uid, title="parent")
    iid = await _make_issue(db_session, tid, uid, title="무관 제목")
    res = await issue_model.search_for_chat(uid, f"RFJ-{dn}", db_session)
    assert any(i["issue_id"] == iid for i in res)


async def test_issue_search_ranks_title_first_and_no_rank_key(db_session):
    """제목 매칭이 body 매칭보다 먼저, _rank 미노출."""
    uid, bid = await _seed_branch_with_member(db_session, "i3@ref.test", "RFK")
    tid, _ = await _make_task(db_session, bid, uid, title="parent")
    body_hit = await _make_issue(db_session, tid, uid, title="기타", body="beta 메모")
    title_hit = await _make_issue(db_session, tid, uid, title="beta 버그")
    res = await issue_model.search_for_chat(uid, "beta", db_session)
    ids = [i["issue_id"] for i in res]
    assert ids.index(title_hit) < ids.index(body_hit)
    assert "_rank" not in res[0]


async def test_issue_search_ranks_parent_id_above_body(db_session):
    """부모 task ID(KEY-번호) 매칭이 body 매칭보다 먼저 온다(task 검색과 동일 위계)."""
    uid, bid = await _seed_branch_with_member(db_session, "i4@ref.test", "RFM")
    t_id, dn = await _make_task(db_session, bid, uid, title="parent id")
    id_hit = await _make_issue(db_session, t_id, uid, title="무관", body="무관")        # 부모 = RFM-{dn}
    t_body, _ = await _make_task(db_session, bid, uid, title="parent body")
    body_hit = await _make_issue(db_session, t_body, uid,
                                 title="무관", body=f"RFM-{dn} 참조")                    # body에 'RFM-{dn}' 텍스트
    # 랭킹이 없으면(동률) created_at DESC 로 body_hit 이 먼저 오도록 더 최근으로 만든다.
    # → 랭킹이 동작해야만 id_hit 이 앞서므로 회귀를 확실히 잡는다.
    await db_session.execute(
        text("UPDATE task_issue SET created_at = NOW() + interval '1 hour' WHERE issue_id = :i"),
        {"i": body_hit})
    res = await issue_model.search_for_chat(uid, f"RFM-{dn}", db_session)
    ids = [i["issue_id"] for i in res]
    assert ids.index(id_hit) < ids.index(body_hit)


# --------------------------------------------------------------------------
# Doc(Canvas page) 검색
# --------------------------------------------------------------------------

async def _make_canvas(db, created_by, name="Canvas", key="CV"):
    res = await db.execute(text("""
        INSERT INTO canvas (canvas_name, key, created_by)
        VALUES (:n, :k, :u) RETURNING canvas_id
    """), {"n": name, "k": key, "u": created_by})
    return res.scalar_one()


async def _add_canvas_member(db, canvas_id, user_id, role="member"):
    await db.execute(text("""
        INSERT INTO canvas_member (canvas_id, user_id, role)
        VALUES (:c, :u, :r)
    """), {"c": canvas_id, "u": user_id, "r": role})


async def _make_page(db, canvas_id, created_by, title="page", content=None):
    res = await db.execute(text("""
        INSERT INTO canvas_page (canvas_id, title, content, created_by)
        VALUES (:c, :t, :ct, :u) RETURNING page_id
    """), {"c": canvas_id, "t": title, "ct": content, "u": created_by})
    return res.scalar_one()


async def _seed_canvas_with_member(db, email, key):
    uid = await _make_user(db, email, email.split("@")[0])
    cid = await _make_canvas(db, uid, key=key)
    await _add_canvas_member(db, cid, uid)
    return uid, cid


async def test_doc_search_matches_canvas_name(db_session):
    """페이지 제목/본문엔 없고 캔버스 이름에만 있는 키워드로도 찾는다."""
    uid, cid = await _seed_canvas_with_member(db_session, "d1@ref.test", "CVA")
    await db_session.execute(text("UPDATE canvas SET canvas_name='Roadmap' WHERE canvas_id=:c"),
                             {"c": cid})
    pid = await _make_page(db_session, cid, uid, title="무관 페이지", content="내용")
    res = await canvas_page_model.search_for_chat(uid, "Roadmap", db_session)
    assert any(p["page_id"] == pid for p in res)


async def test_doc_search_ranks_title_above_content(db_session):
    """제목 매칭이 본문 매칭보다 먼저 온다."""
    uid, cid = await _seed_canvas_with_member(db_session, "d2@ref.test", "CVB")
    body_hit = await _make_page(db_session, cid, uid, title="기타", content="gamma 포함")
    title_hit = await _make_page(db_session, cid, uid, title="gamma 문서", content="x")
    res = await canvas_page_model.search_for_chat(uid, "gamma", db_session)
    ids = [p["page_id"] for p in res]
    assert ids.index(title_hit) < ids.index(body_hit)
    assert "_rank" not in res[0]


# --------------------------------------------------------------------------
# HTML 노이즈 제거 (Phase 2)
# --------------------------------------------------------------------------

async def test_task_search_strips_html_tags_and_attrs(db_session):
    """description HTML의 태그·속성은 검색에서 제외, 본문 텍스트·멘션 이름은 포함."""
    uid, bid = await _seed_branch_with_member(db_session, "h1@ref.test", "RFN")
    tid, _ = await _make_task(
        db_session, bid, uid, title="무관",
        description='<p>hello</p><span data-id="5" data-type="mention">@Alice</span>')

    async def hit(q):
        res = await task_model.search_for_chat(uid, q, False, db_session)
        return any(t["task_id"] == tid for t in res)

    assert await hit("hello")        # 본문 텍스트
    assert await hit("Alice")        # 멘션 이름
    assert not await hit("span")     # 태그명
    assert not await hit("data-id")  # 속성명


async def test_issue_search_strips_html_tags(db_session):
    """issue body HTML의 태그는 검색에서 제외, 본문 텍스트는 포함."""
    uid, bid = await _seed_branch_with_member(db_session, "h2@ref.test", "RFO")
    tid, _ = await _make_task(db_session, bid, uid, title="parent")
    iid = await _make_issue(db_session, tid, uid, title="무관",
                            body='<p>refresh token leak</p>')

    async def hit(q):
        res = await issue_model.search_for_chat(uid, q, db_session)
        return any(i["issue_id"] == iid for i in res)

    assert await hit("refresh")
    assert not await hit("p")        # <p> 태그명


async def test_doc_search_strips_html_tags(db_session):
    """canvas page content HTML의 태그는 검색에서 제외, 본문 텍스트는 포함."""
    uid, cid = await _seed_canvas_with_member(db_session, "h3@ref.test", "CVC")
    pid = await _make_page(db_session, cid, uid, title="무관",
                           content='<ul><li>quarterly roadmap</li></ul>')

    async def hit(q):
        res = await canvas_page_model.search_for_chat(uid, q, db_session)
        return any(p["page_id"] == pid for p in res)

    assert await hit("roadmap")
    assert not await hit("li")       # <li> 태그명


# --------------------------------------------------------------------------
# parent_task_id 필드 포함 여부 (Task 7)
# --------------------------------------------------------------------------

async def _make_subtask(db, branch_id, created_by, parent_task_id, title="sub"):
    """parent_task_id가 채워진 하위 task 1건. (task_id, display_number) 반환."""
    row = await db.execute(text(
        "SELECT COALESCE(MAX(display_number), 0) + 1 FROM task WHERE branch_id = :b"),
        {"b": branch_id})
    dn = row.scalar_one()
    res = await db.execute(text("""
        INSERT INTO task (branch_id, display_number, title, status, created_by, parent_task_id)
        VALUES (:b, :dn, :t, 'todo', :u, :p) RETURNING task_id
    """), {"b": branch_id, "dn": dn, "t": title, "u": created_by, "p": parent_task_id})
    return res.scalar_one(), dn


async def test_task_search_rows_carry_parent_task_id(db_session):
    """search_for_chat 결과 행은 parent_task_id를 포함한다 — 상위는 None, 하위는 부모 id."""
    uid, bid = await _seed_branch_with_member(db_session, "tparent@ref.test", "RFP")
    parent_id, _ = await _make_task(db_session, bid, uid, title="parentpick top")
    sub_id, _ = await _make_subtask(db_session, bid, uid, parent_id, title="parentpick child")
    res = await task_model.search_for_chat(uid, "parentpick", False, db_session)
    by_id = {t["task_id"]: t for t in res}
    assert "parent_task_id" in by_id[parent_id]
    assert by_id[parent_id]["parent_task_id"] is None
    assert by_id[sub_id]["parent_task_id"] == parent_id
