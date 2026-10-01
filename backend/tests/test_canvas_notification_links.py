"""캔버스 알림 링크. 본문 멘션 알림은 실제 문서 라우트(/canvas/{c}/{p})로 가야 한다 — 예전
'/canvas/{c}/page/{p}'는 프론트에 라우트가 없어 404였다. 댓글(스레드) 알림 5종은 문서를 열면서 그
스레드를 댓글 패널에 띄우도록 ?comment={annotation_id}를 단다(CanvasPageView가 읽는다).

컨트롤러 직접 호출 + rollback-isolated db_session. Seed 헬퍼는 test_controller_canvas_errors.py와 같은 패턴.
"""
from types import SimpleNamespace

from sqlalchemy import text

from core.controller import canvas_annotation as annotation_ctrl
from core.controller import canvas_page as page_ctrl
from core.model import notification as noti_model
from routers.schema import canvas_annotation as ann_schema
from routers.schema.canvas_page import CanvasPageUpdate


def _req(user_id, username="u"):
    return SimpleNamespace(state=SimpleNamespace(payload={"user_id": user_id, "username": username}))


def _mention(uid):
    return f'<span data-mention="true" data-user-id="{uid}" data-username="u{uid}" class="mention">@u{uid}</span>'


async def _make_user(db, email, username):
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status)
        VALUES (:e, :p, :u, 'active') RETURNING user_id
    """), {"e": email, "p": b"x", "u": username})
    return row.scalar_one()


async def _make_canvas(db, created_by, key):
    row = await db.execute(text("""
        INSERT INTO canvas (canvas_name, key, description, visibility, color, created_by)
        VALUES (:n, :k, 'desc', 'private', '#16A34A', :u) RETURNING canvas_id
    """), {"n": key, "k": key, "u": created_by})
    return row.scalar_one()


async def _add_member(db, canvas_id, user_id, role="member"):
    await db.execute(text("""
        INSERT INTO canvas_member (canvas_id, user_id, role) VALUES (:c, :u, :r)
    """), {"c": canvas_id, "u": user_id, "r": role})


async def _make_page(db, canvas_id, created_by):
    row = await db.execute(text("""
        INSERT INTO canvas_page (canvas_id, title, content, position, created_by, updated_by, type)
        VALUES (:c, 'Page', '<p></p>', 0, :u, :u, 'document') RETURNING page_id
    """), {"c": canvas_id, "u": created_by})
    return row.scalar_one()


async def _seed(db, key):
    """alice(문서 작성자) + bob·carol(멤버) + 캔버스 + alice의 문서. 반환: (alice, bob, carol, canvas, page)"""
    alice = await _make_user(db, f"{key}_a@t.t", f"{key}_a")
    bob = await _make_user(db, f"{key}_b@t.t", f"{key}_b")
    carol = await _make_user(db, f"{key}_c@t.t", f"{key}_c")
    canvas = await _make_canvas(db, alice, key)
    await _add_member(db, canvas, alice, "admin")
    await _add_member(db, canvas, bob)
    await _add_member(db, canvas, carol)
    page = await _make_page(db, canvas, alice)
    return alice, bob, carol, canvas, page


async def _links(db, user_id, ntype):
    return [n["link"] for n in await noti_model.find_by_user(user_id, db=db) if n["type"] == ntype]


async def _open_thread(db, canvas, page, author, username, content="<p>질문</p>"):
    body = ann_schema.AnnotationCreate(quoted_text="text", content=content)
    res = await annotation_ctrl.create_annotation(body, canvas, page, _req(author, username), db)
    assert res["status"] is True
    return res["annotation_id"]


async def test_page_body_mention_links_to_document_route(db_session):
    alice, bob, _carol, canvas, page = await _seed(db_session, "CNL1")

    body = CanvasPageUpdate(content=f"<p>{_mention(bob)} 확인 부탁</p>")
    res = await page_ctrl.update(canvas, page, body, _req(alice, "CNL1_a"), db_session)

    assert res["status"] is True
    assert await _links(db_session, bob, "mention") == [f"/canvas/{canvas}/{page}"]


async def test_new_thread_notifications_open_that_thread(db_session):
    alice, bob, carol, canvas, page = await _seed(db_session, "CNL2")

    ann_id = await _open_thread(db_session, canvas, page, bob, "CNL2_b",
                                content=f"<p>{_mention(carol)} 봐 주세요</p>")

    link = f"/canvas/{canvas}/{page}?comment={ann_id}"
    assert await _links(db_session, alice, "annotation_created") == [link]   # 문서 작성자
    assert await _links(db_session, carol, "mention") == [link]              # 댓글 멘션


async def test_resolve_notification_opens_that_thread(db_session):
    alice, bob, _carol, canvas, page = await _seed(db_session, "CNL3")
    ann_id = await _open_thread(db_session, canvas, page, bob, "CNL3_b")

    res = await annotation_ctrl.update_annotation(
        ann_schema.AnnotationUpdate(status="resolved"), canvas, page, ann_id, _req(alice, "CNL3_a"), db_session)

    assert res["status"] is True
    assert await _links(db_session, bob, "annotation_resolved") == [f"/canvas/{canvas}/{page}?comment={ann_id}"]


async def test_reply_notifications_open_that_thread(db_session):
    alice, bob, carol, canvas, page = await _seed(db_session, "CNL4")
    ann_id = await _open_thread(db_session, canvas, page, bob, "CNL4_b")

    res = await annotation_ctrl.create_reply(
        ann_schema.ReplyCreate(content=f"<p>{_mention(alice)} 답합니다</p>"),
        canvas, page, ann_id, _req(carol, "CNL4_c"), db_session)

    assert res["status"] is True
    link = f"/canvas/{canvas}/{page}?comment={ann_id}"
    assert await _links(db_session, bob, "annotation_reply") == [link]   # 스레드 작성자
    assert await _links(db_session, alice, "mention") == [link]          # 답글 멘션
