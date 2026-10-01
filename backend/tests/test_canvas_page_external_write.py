"""CV-02: 편집기 밖(MCP·REST)에서 고친 캔버스 본문이 편집기를 여는 순간 옛 내용으로 덮이지 않게 한다.

본문은 content(HTML)와 공동편집 상태 yjs_state 두 곳에 있다. 편집기는 yjs_state가 있으면 content를 무시하고 그 상태로
열려 옛 HTML을 다시 저장한다. 그래서
- 공동편집기의 자기 저장(origin='editor': 자동 저장·닫기 저장)은 지금처럼 content만 바꾼다.
- 그 밖의 본문 쓰기는 편집 중인 방이 없으면 같은 UPDATE에서 yjs_state를 비워 다음 편집기가 새 content에서 시작하게 하고,
  방이 열려 있으면(누가 편집 중) PAGE_BEING_EDITED로 거절해 아무것도 바꾸지 않는다.
- 제목·너비만 바꾸는 요청은 영향을 받지 않는다.

앞부분은 rollback 격리 fixture(db_session)로 컨트롤러를 직접 부른다. 뒷부분은 쓰기와 방 입장의 순서를 실제 Postgres 행
락으로 확인해야 해서 test_scrum_rest_write_lock.py처럼 테스트 DB에 커밋하고 끝나면 지운다.
"""
import asyncio
import contextlib
import uuid
from types import SimpleNamespace

import pytest
import pytest_asyncio
from pycrdt import Doc, Text, XmlElement, XmlFragment, XmlText
from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from core.controller import canvas_page as page_ctrl
from core.model import canvas_page as page_model
from library import ws_collab_manager as cm
from routers.schema import canvas_page as schema


def _req(user_id):
    return SimpleNamespace(state=SimpleNamespace(payload={'user_id': user_id, 'username': 'tester'}))


def _yjs(source):
    """Typst 편집기와 같은 모양의 Yjs 상태(Text 'typst')."""
    doc = Doc()
    doc['typst'] = Text(source)
    return doc.get_update()


def _typst_text(doc):
    return str(doc.get('typst', type=Text))


OLD_YJS = _yjs('OLD')


async def _seed(db, tag, page_type='document'):
    uid = (await db.execute(text("""
        INSERT INTO "user" (email, password, username, status)
        VALUES (:e, :p, :u, 'active') RETURNING user_id
    """), {'e': f'cv02-{tag}@test.local', 'p': b'x', 'u': f'cv02{tag}'})).scalar_one()
    cid = (await db.execute(text("""
        INSERT INTO canvas (canvas_name, key, description, visibility, color, created_by)
        VALUES ('CV02', :k, 'd', 'private', '#16A34A', :u) RETURNING canvas_id
    """), {'k': f'CV{tag}'[:10].upper(), 'u': uid})).scalar_one()
    await db.execute(text("""
        INSERT INTO canvas_member (canvas_id, user_id, role) VALUES (:c, :u, 'admin')
    """), {'c': cid, 'u': uid})
    pid = (await db.execute(text("""
        INSERT INTO canvas_page (canvas_id, title, content, position, created_by, updated_by, type,
                                 yjs_state, yjs_updated_at)
        VALUES (:c, 'P', :content, 0, :u, :u, :ty, :y, NOW()) RETURNING page_id
    """), {'c': cid, 'u': uid, 'ty': page_type, 'y': OLD_YJS,
           'content': 'OLD' if page_type == 'typst' else '<p>OLD</p>'})).scalar_one()
    return uid, cid, pid


async def _row(db, pid):
    return dict((await db.execute(text("""
        SELECT title, content, wide_mode, yjs_state, yjs_updated_at FROM canvas_page WHERE page_id = :p
    """), {'p': pid})).fetchone()._mapping)


@pytest.fixture
def mgr(monkeypatch):
    """컨트롤러가 보는 캔버스 협업 매니저를 테스트마다 새로 둔다(전역 방 목록을 건드리지 않는다)."""
    manager = cm.CollabManager(cm.CanvasPageStore())
    monkeypatch.setattr(page_ctrl, 'collab_manager', manager, raising=False)
    return manager


# ---------------------------------------------------------------------------
# 편집 중인 방이 없을 때
# ---------------------------------------------------------------------------

async def test_external_content_write_resets_collab_state(db_session, mgr):
    # MCP update_canvas_page(content=…) — 다음 편집기가 옛 yjs_state 대신 새 content에서 시작해야 한다
    uid, cid, pid = await _seed(db_session, 'ext')
    res = await page_ctrl.update(cid, pid, schema.CanvasPageUpdate(content='**AI 정리본**'),
                                 _req(uid), db_session)
    assert res == {'status': True}
    row = await _row(db_session, pid)
    assert '<strong>AI 정리본</strong>' in row['content']
    assert row['yjs_state'] is None and row['yjs_updated_at'] is None
    page = await page_model.find_by_id(pid, db_session)
    assert page['yjs_state'] is False                   # 편집기가 새 content로 문서를 채우는 신호


async def test_editor_save_keeps_collab_state(db_session, mgr):
    # 공동편집기의 자동 저장·닫기 저장 — 방 문서에서 뽑은 HTML이므로 yjs_state는 그대로 둔다
    uid, cid, pid = await _seed(db_session, 'edt')
    res = await page_ctrl.update(cid, pid, schema.CanvasPageUpdate(content='<p>typed</p>', origin='editor'),
                                 _req(uid), db_session)
    assert res == {'status': True}
    row = await _row(db_session, pid)
    assert row['content'] == '<p>typed</p>'
    assert bytes(row['yjs_state']) == OLD_YJS and row['yjs_updated_at'] is not None


async def test_external_typst_write_resets_collab_state(db_session, mgr):
    # Typst 소스도 같은 규칙 — 정화 없이 저장하고 yjs_state를 비운다
    uid, cid, pid = await _seed(db_session, 'typ', page_type='typst')
    res = await page_ctrl.update(cid, pid, schema.CanvasPageUpdate(content='= NEW'), _req(uid), db_session)
    assert res == {'status': True}
    row = await _row(db_session, pid)
    assert row['content'] == '= NEW' and row['yjs_state'] is None


# ---------------------------------------------------------------------------
# 누가 편집 중일 때(협업 방이 열려 있다)
# ---------------------------------------------------------------------------

async def test_external_content_write_rejected_while_room_is_open(db_session, mgr):
    uid, cid, pid = await _seed(db_session, 'busy')
    mgr.rooms[pid] = cm.Room(pid, Doc())
    res = await page_ctrl.update(
        cid, pid, schema.CanvasPageUpdate(title='T2', content='<p>AI</p>'), _req(uid), db_session)
    assert res['status'] is False
    assert res['code'] == 'PAGE_BEING_EDITED' and res['category'] == 'conflict'
    row = await _row(db_session, pid)                  # 같은 요청의 제목까지 아무것도 바뀌지 않는다
    assert row['title'] == 'P' and row['content'] == '<p>OLD</p>'
    assert bytes(row['yjs_state']) == OLD_YJS


async def test_editor_save_allowed_while_room_is_open(db_session, mgr):
    uid, cid, pid = await _seed(db_session, 'busyed')
    mgr.rooms[pid] = cm.Room(pid, Doc())
    res = await page_ctrl.update(cid, pid, schema.CanvasPageUpdate(content='<p>typed</p>', origin='editor'),
                                 _req(uid), db_session)
    assert res == {'status': True}
    row = await _row(db_session, pid)
    assert row['content'] == '<p>typed</p>' and bytes(row['yjs_state']) == OLD_YJS


@pytest.mark.parametrize('fields', [{'title': 'Renamed'}, {'wide_mode': True}])
async def test_title_or_width_update_unaffected_while_room_is_open(db_session, mgr, fields):
    uid, cid, pid = await _seed(db_session, 'meta' + next(iter(fields))[:3])
    mgr.rooms[pid] = cm.Room(pid, Doc())
    res = await page_ctrl.update(cid, pid, schema.CanvasPageUpdate(**fields), _req(uid), db_session)
    assert res == {'status': True}
    row = await _row(db_session, pid)
    for key, value in fields.items():
        assert row[key] == value
    assert row['content'] == '<p>OLD</p>' and bytes(row['yjs_state']) == OLD_YJS


def test_origin_accepts_only_editor():
    assert schema.CanvasPageUpdate(content='x', origin='editor').origin == 'editor'
    with pytest.raises(ValidationError):
        schema.CanvasPageUpdate(content='x', origin='mcp')


# ---------------------------------------------------------------------------
# 외부 쓰기와 방 입장이 동시에 일어날 때 (커밋된 데이터 + 실제 행 락)
# ---------------------------------------------------------------------------

class _WS:
    async def send_bytes(self, data):
        pass


@pytest_asyncio.fixture
async def committed_page(migrated_test_db, monkeypatch, request):
    """커밋된 사용자·캔버스·페이지(기본 Typst, yjs_state='OLD')와 요청 세션 팩토리. 방 저장 세션도 테스트 DB로 돌린다.
    indirect 파라미터로 페이지 종류를 바꾼다('document')."""
    engine = create_async_engine(migrated_test_db, poolclass=NullPool)
    Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    @contextlib.asynccontextmanager
    async def test_tx():
        async with Session() as s:
            yield s
            await s.commit()

    monkeypatch.setattr(cm.db, 'transactional_session', test_tx)
    manager = cm.CollabManager(cm.CanvasPageStore())
    monkeypatch.setattr(page_ctrl, 'collab_manager', manager, raising=False)
    async with Session() as s:
        uid, cid, pid = await _seed(s, uuid.uuid4().hex[:6], page_type=getattr(request, 'param', 'typst'))
        await s.commit()
    try:
        yield SimpleNamespace(Session=Session, mgr=manager, uid=uid, cid=cid, pid=pid)
    finally:
        async with Session() as s:
            await s.execute(text('DELETE FROM canvas WHERE canvas_id = :c'), {'c': cid})   # page·member·log CASCADE
            await s.execute(text('DELETE FROM "user" WHERE user_id = :u'), {'u': uid})
            await s.commit()
        await engine.dispose()


async def _request(Session, call):
    """db.session 의존성과 같은 경계 — 컨트롤러가 끝난 뒤 커밋한다."""
    async with Session() as s:
        out = await call(s)
        await s.commit()
        return out


def _open_editor(b, ws):
    """ws_canvas 라우터처럼 자기 세션으로 방에 들어가고, 들어간 뒤 커밋한다."""
    async def run():
        async with b.Session() as s:
            room = await b.mgr.join(b.pid, b.uid, ws, s)
            await s.commit()
            return room
    return asyncio.create_task(run())


async def test_room_join_waits_for_uncommitted_external_write(committed_page):
    # 외부 쓰기가 UPDATE를 보냈지만 라우트 커밋 전에 누가 편집을 연다. 입장이 커밋 전 상태(옛 yjs_state)를 읽으면 편집기가
    # 옛 문서로 열리고 그 HTML을 다시 저장해 쓰기를 덮는다 — 입장은 커밋을 기다렸다가 비워진 상태를 읽어야 한다.
    b = committed_page
    ws = _WS()
    rest = b.Session()
    joining = None
    try:
        res = await page_ctrl.update(b.cid, b.pid, schema.CanvasPageUpdate(content='NEW'), _req(b.uid), rest)
        assert res == {'status': True}
        joining = _open_editor(b, ws)
        await asyncio.sleep(0.3)
        assert not joining.done()                        # 쓰기가 커밋하기 전에는 기다린다
        await rest.commit()
        room = await asyncio.wait_for(joining, 5)
        assert _typst_text(room.doc) == ''               # 옛 'OLD'가 아니라 비워진 상태에서 시작한다
    finally:
        await rest.close()
        if joining is not None:
            await asyncio.gather(joining, return_exceptions=True)
        await b.mgr.leave(b.pid, b.uid, ws)


async def test_room_join_between_check_and_update_waits_for_the_write(committed_page, monkeypatch):
    # 외부 쓰기가 "방 없음"을 확인한 뒤 UPDATE를 보내기 전에 누가 편집을 연다. 확인보다 먼저 행을 잠그지 않으면 입장이 옛
    # yjs_state로 방을 열고, 쓰기는 방이 없다고 믿은 채 성공한다 — 입장은 이 쓰기가 커밋될 때까지 기다려야 한다.
    b = committed_page
    ws = _WS()
    reached, go = asyncio.Event(), asyncio.Event()
    real_update = page_model.update

    async def paused_update(*args, **kwargs):
        reached.set()
        await go.wait()
        return await real_update(*args, **kwargs)

    monkeypatch.setattr(page_model, 'update', paused_update)
    writing = asyncio.create_task(_request(b.Session, lambda s: page_ctrl.update(
        b.cid, b.pid, schema.CanvasPageUpdate(content='NEW'), _req(b.uid), s)))
    joining = None
    try:
        await asyncio.wait_for(reached.wait(), 5)       # 확인을 마치고 UPDATE 직전에 멈췄다
        joining = _open_editor(b, ws)
        await asyncio.sleep(0.3)
        assert not joining.done()                        # 쓰기가 잡은 행 락 때문에 기다린다
        go.set()
        assert await asyncio.wait_for(writing, 5) == {'status': True}
        room = await asyncio.wait_for(joining, 5)
        assert _typst_text(room.doc) == ''
    finally:
        go.set()
        await asyncio.gather(writing, return_exceptions=True)
        if joining is not None:
            await asyncio.gather(joining, return_exceptions=True)
        await b.mgr.leave(b.pid, b.uid, ws)


async def test_external_write_while_room_is_opening_is_rejected(committed_page):
    # 방 입장이 행을 잠그고 옛 상태를 읽었지만 아직 커밋 전이다. 그사이 온 외부 쓰기는 그 방을 보고 거절돼야 한다 —
    # 통과하면 방은 옛 문서로 열려 있고 DB만 새 content가 되어, 편집기의 다음 저장이 쓰기를 덮는다.
    b = committed_page
    ws = _WS()
    opening = b.Session()
    try:
        await b.mgr.join(b.pid, b.uid, ws, opening)      # 방 등록 완료, 입장 세션은 아직 커밋 전
        writing = asyncio.create_task(_request(b.Session, lambda s: page_ctrl.update(
            b.cid, b.pid, schema.CanvasPageUpdate(content='NEW'), _req(b.uid), s)))
        await asyncio.sleep(0.3)
        await opening.commit()
        res = await asyncio.wait_for(writing, 5)
        assert res['status'] is False and res['code'] == 'PAGE_BEING_EDITED'
        async with b.Session() as s:
            row = await _row(s, b.pid)
        assert row['content'] == 'OLD' and bytes(row['yjs_state']) == OLD_YJS
        assert _typst_text(b.mgr.rooms[b.pid].doc) == 'OLD'
    finally:
        await opening.close()
        await b.mgr.leave(b.pid, b.uid, ws)


# ---------------------------------------------------------------------------
# 편집기가 본문을 채우기 전에 끝난 편집 세션 (커밋된 데이터 + 실제 방 저장)
# ---------------------------------------------------------------------------

def _sync_msg(kind, payload):
    """y-websocket 동기화 메시지 [MSG_SYNC, kind, len, payload]."""
    return bytes([cm.MSG_SYNC, kind]) + cm._write_var_uint(len(payload)) + payload


def _paragraph():
    """CanvasCollabEditor(y-prosemirror)가 문서에 넣는 모양 — XmlFragment 'default'의 문단."""
    return XmlElement('paragraph', None, [XmlText('AI 정리본')])


def _fragment_text(state):
    doc = Doc()
    doc.apply_update(bytes(state))
    return str(doc.get('default', type=XmlFragment))


async def _join_and_sync(b, ws):
    """편집 세션을 연다: 방 입장 → y-websocket 첫 동기화. 아직 아무것도 넣지 않은 클라이언트는 빈 업데이트를 보낸다."""
    await asyncio.wait_for(_open_editor(b, ws), 5)
    await b.mgr.handle_message(b.pid, ws, _sync_msg(cm.SYNC_STEP1, Doc().get_state()))
    await b.mgr.handle_message(b.pid, ws, _sync_msg(cm.SYNC_STEP2, Doc().get_update()))


async def _external_write(b, content):
    res = await _request(b.Session, lambda s: page_ctrl.update(
        b.cid, b.pid, schema.CanvasPageUpdate(content=content), _req(b.uid), s))
    assert res == {'status': True}


@pytest.mark.parametrize('committed_page', ['document'], indirect=True)
async def test_session_closed_before_seeding_keeps_content_for_next_editor(committed_page):
    # MCP가 본문을 바꿔 yjs_state가 비워진 문서를 편집으로 열었는데, 편집기가 content로 문서를 채우기 전에 세션이 끝났다
    # (동기화 뒤 다시 읽기 실패·응답 전 닫기). 방이 받은 것은 빈 동기화뿐이다. 이 빈 문서를 저장하면 yjs_state가 생겨,
    # 다시 연 편집기(CanvasCollabEditor)가 content로 채우지 않고 빈 문서로 열린다 — 그 빈 HTML이 저장되면 본문이 사라진다.
    b = committed_page
    await _external_write(b, '<p>AI 정리본</p>')

    ws = _WS()
    await _join_and_sync(b, ws)
    await b.mgr.leave(b.pid, b.uid, ws)                  # 기준본을 받기 전에 끝난 세션

    ws = _WS()                                          # 다시 연다
    await _join_and_sync(b, ws)
    async with b.Session() as s:
        base = await page_model.find_by_id(b.pid, s)     # 동기화 뒤 다시 읽은 기준본(useCollabEditBase)
    if not base['yjs_state']:                           # 편집기 규칙: yjs_state가 없을 때만 content로 채운다
        client = Doc()
        client['default'] = frag = XmlFragment()
        frag.children.append(_paragraph())
        await b.mgr.handle_message(b.pid, ws, _sync_msg(cm.SYNC_UPDATE, client.get_update()))
    await b.mgr.leave(b.pid, b.uid, ws)

    async with b.Session() as s:
        row = await _row(s, b.pid)
    assert 'AI 정리본' in row['content']
    assert 'AI 정리본' in _fragment_text(row['yjs_state'])   # 다시 연 편집기가 본문으로 열려 그 문서가 저장됐다


@pytest.mark.parametrize('committed_page', ['document'], indirect=True)
async def test_emptied_document_is_saved_so_content_is_not_refilled(committed_page):
    # 반대쪽: 편집기에서 본문을 모두 지운 문서는 삭제 기록이 남아 빈 업데이트가 아니다. 저장돼야 다음 편집기가 옛 content로
    # 다시 채우지 않는다(지운 본문이 되살아나지 않는다).
    b = committed_page
    await _external_write(b, '<p>AI 정리본</p>')

    ws = _WS()
    await _join_and_sync(b, ws)
    client = Doc()
    client['default'] = frag = XmlFragment()
    frag.children.append(_paragraph())
    await b.mgr.handle_message(b.pid, ws, _sync_msg(cm.SYNC_UPDATE, client.get_update()))
    seeded = client.get_state()
    del frag.children[0]                                # 사용자가 전부 지웠다
    await b.mgr.handle_message(b.pid, ws, _sync_msg(cm.SYNC_UPDATE, client.get_update(seeded)))
    await b.mgr.leave(b.pid, b.uid, ws)

    async with b.Session() as s:
        row = await _row(s, b.pid)
        base = await page_model.find_by_id(b.pid, s)
    assert row['yjs_state'] is not None and _fragment_text(row['yjs_state']) == ''
    assert base['yjs_state'] is True                    # 다음 편집기는 content로 채우지 않는다
