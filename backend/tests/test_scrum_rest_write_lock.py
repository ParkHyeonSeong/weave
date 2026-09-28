"""스크럼 셀 REST 쓰기와 협업 방 입장의 순서를 실제 Postgres 행 락으로 확인한다.

test_collab_manager.py의 TxStore는 행 락을 흉내 내지 않는다. 여기서는 실제 컨트롤러·모델·세션으로 서로
다른 연결이 각자 커밋하는 상황을 만든다. 그래서 rollback 격리 fixture(db_session) 대신 테스트 DB에 커밋하고
끝나면 지운다.
"""
import asyncio
import contextlib
import uuid
from types import SimpleNamespace

import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from core.controller import scrum_board as board_ctrl
from core.controller import scrum_week as week_ctrl
from library import ws_collab_manager as cm
from library.scrum_cells import read_cells
from routers.schema import scrum_board as board_schema
from routers.schema.scrum_cell import WeekCellWrite


def _req(user_id):
    return SimpleNamespace(state=SimpleNamespace(payload={'user_id': user_id}))


class _WS:
    async def send_bytes(self, data):
        pass


@pytest_asyncio.fixture
async def committed_board(migrated_test_db, monkeypatch):
    """커밋된 사용자·보드와 요청 세션 팩토리. 컨트롤러가 쓰는 협업 매니저와 방 저장 세션을 테스트 DB 쪽으로 바꾼다."""
    engine = create_async_engine(migrated_test_db, poolclass=NullPool)
    Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    @contextlib.asynccontextmanager
    async def test_tx():
        async with Session() as s:
            yield s
            await s.commit()

    monkeypatch.setattr(cm.db, "transactional_session", test_tx)
    mgr = cm.CollabManager(cm.ScrumWeekStore())
    monkeypatch.setattr(week_ctrl, "scrum_week_collab_manager", mgr)
    tag = uuid.uuid4().hex[:8]
    async with Session() as s:
        uid = (await s.execute(text("""
            INSERT INTO "user" (email, password, username, status)
            VALUES (:e, :p, :u, 'active') RETURNING user_id
        """), {"e": f"lock-{tag}@test.local", "p": b"x", "u": f"lock{tag}"})).scalar_one()
        bid = (await board_ctrl.create(board_schema.ScrumBoardCreate(name="lock"), _req(uid), s))["board_id"]
        await s.commit()
    try:
        yield SimpleNamespace(Session=Session, mgr=mgr, uid=uid, bid=bid)
    finally:
        async with Session() as s:
            await s.execute(text("DELETE FROM scrum_board WHERE board_id = :b"), {"b": bid})  # member·week CASCADE
            await s.execute(text('DELETE FROM "user" WHERE user_id = :u'), {"u": uid})
            await s.commit()
        await engine.dispose()


async def _request(Session, call):
    """db.session 의존성과 같은 경계 — 컨트롤러가 끝난 뒤 커밋한다."""
    async with Session() as s:
        out = await call(s)
        await s.commit()
        return out


async def test_concurrent_roomless_cell_writes_keep_both(committed_board):
    # 아무도 보드를 열지 않은 주에 같은 사람의 월·화 셀 쓰기가 동시에 온다(에이전트 병렬 호출). 두 요청이 같은 옛
    # 상태를 읽으면 나중 커밋이 전체 문서로 앞 쓰기를 덮는다. 락이 없으면 거의 매번 한쪽이 사라져 5주를 확인한다.
    b = committed_board
    for week in range(1, 6):
        await _request(b.Session, lambda s: week_ctrl.get_week(b.bid, 2031, week, _req(b.uid), s))

        def write(day, value):
            return _request(b.Session, lambda s: week_ctrl.write_week_cell(
                b.bid, 2031, week, WeekCellWrite(day=day, row="plan", text=value, mode="replace"),
                _req(b.uid), s))

        await asyncio.gather(write(0, "MON"), write(1, "TUE"))
        cells = (await _request(b.Session, lambda s: week_ctrl.get_week_cells(
            b.bid, 2031, week, _req(b.uid), s)))["cells"]
        assert "MON" in cells[f"{b.uid}:0:plan"] and "TUE" in cells[f"{b.uid}:1:plan"], (week, cells)


async def test_room_join_waits_for_uncommitted_rest_write(committed_board):
    # 방이 없을 때의 REST 쓰기가 UPDATE를 보냈지만 라우트 커밋 전에 누가 보드를 연다. 입장이 커밋 전 상태를 읽으면
    # 그 방에 REST 쓰기가 없고, 그 방이 저장될 때 DB의 쓰기를 덮는다 — 입장은 커밋을 기다렸다 읽어야 한다.
    b = committed_board
    week = await _request(b.Session, lambda s: week_ctrl.get_week(b.bid, 2031, 10, _req(b.uid), s))
    week_id = week["week"]["week_id"]
    key = f"{b.uid}:2:plan"
    ws = _WS()
    rest = b.Session()
    joining = None
    try:
        await week_ctrl.write_week_cell(
            b.bid, 2031, 10, WeekCellWrite(day=2, row="plan", text="REST", mode="replace"), _req(b.uid), rest)

        async def open_board():
            async with b.Session() as s:
                room = await b.mgr.join(week_id, b.uid, ws, s)
                await s.commit()
                return room

        joining = asyncio.create_task(open_board())
        await asyncio.sleep(0.3)
        assert not joining.done()                        # REST 요청이 커밋하기 전에는 기다린다
        await rest.commit()
        room = await asyncio.wait_for(joining, 5)
        assert "REST" in read_cells(room.doc.get_update(), [key])[key]
    finally:
        await rest.close()
        if joining is not None:
            await asyncio.gather(joining, return_exceptions=True)
        await b.mgr.leave(week_id, b.uid, ws)
