import asyncio
import contextlib
import types

from pycrdt import Doc, Text, XmlElement, XmlFragment, XmlText

from library import ws_collab_manager as cm


class FakeStore:
    def __init__(self, initial=None):
        self._state = initial
        self.saved = None
    async def get_yjs_state(self, room_id, db, for_update=False):
        return self._state
    async def save_yjs_state(self, room_id, state, db):
        self.saved = state


class FakeWS:
    def __init__(self):
        self.sent = []
    async def send_bytes(self, data):
        self.sent.append(data)


async def test_join_creates_room_keyed_by_room_id():
    mgr = cm.CollabManager(FakeStore())
    ws = FakeWS()
    room = await mgr.join(7, 42, ws, db_session=None)
    assert 7 in mgr.rooms
    assert room.room_id == 7
    assert (42, ws) in room.connections


async def test_join_loads_initial_state_from_store():
    seed = Doc()
    seed["t"] = Text("hello")
    state = seed.get_update()
    empty_len = len(Doc().get_update())
    mgr = cm.CollabManager(FakeStore(initial=state))
    room = await mgr.join(1, 1, FakeWS(), db_session=None)
    # 빈 doc보다 큰 상태 = store의 초기 state가 실제로 로드됨
    assert len(room.doc.get_update()) > empty_len


async def test_persist_writes_through_store():
    store = FakeStore()
    mgr = cm.CollabManager(store)
    room = await mgr.join(3, 1, FakeWS(), db_session=None)
    room.dirty = True
    await mgr._persist(room, db_session=None)
    assert store.saved is not None


async def test_separate_managers_have_isolated_rooms():
    a = cm.CollabManager(FakeStore())
    b = cm.CollabManager(FakeStore())
    await a.join(1, 1, FakeWS(), db_session=None)
    assert 1 in a.rooms and 1 not in b.rooms


def test_default_managers_exist():
    assert isinstance(cm.collab_manager, cm.CollabManager)
    assert isinstance(cm.scrum_week_collab_manager, cm.CollabManager)
    assert isinstance(cm.scrum_retro_collab_manager, cm.CollabManager)
    # 싱글턴이 올바른 store 타입을 주입받았는지 (복붙 실수 방지)
    assert isinstance(cm.collab_manager.store, cm.CanvasPageStore)
    assert isinstance(cm.scrum_week_collab_manager.store, cm.ScrumWeekStore)
    assert isinstance(cm.scrum_retro_collab_manager.store, cm.ScrumRetroStore)


def _write_hi(doc):
    frag = doc.get("c", type=XmlFragment)
    para = XmlElement("paragraph")
    frag.children.append(para)
    para.children.append(XmlText("hi"))


async def test_external_mutation_no_room_writes_to_store():
    store = FakeStore()
    mgr = cm.CollabManager(store)
    await mgr.apply_external_mutation(5, _write_hi, db_session=None)
    assert store.saved is not None
    # 저장된 state를 다시 읽으면 내용이 보존됨
    doc = Doc(); doc.apply_update(store.saved)
    assert "hi" in str(doc.get("c", type=XmlFragment))


async def test_external_mutation_active_room_broadcasts_and_marks_dirty():
    store = FakeStore()
    mgr = cm.CollabManager(store)
    ws = FakeWS()
    await mgr.join(6, 1, ws, db_session=None)
    await mgr.apply_external_mutation(6, _write_hi, db_session=None)
    room = mgr.rooms[6]
    assert room.dirty is True
    assert "hi" in str(room.doc.get("c", type=XmlFragment))
    assert ws.sent, "연결된 클라이언트에 브로드캐스트되어야 함"


async def test_snapshot_state_prefers_live_room():
    store = FakeStore(initial=None)
    mgr = cm.CollabManager(store)
    await mgr.join(8, 1, FakeWS(), db_session=None)
    await mgr.apply_external_mutation(8, _write_hi, db_session=None)
    snap = await mgr.snapshot_state(8, db_session=None)
    doc = Doc(); doc.apply_update(snap)
    assert "hi" in str(doc.get("c", type=XmlFragment))


async def test_snapshot_state_falls_back_to_store():
    seed = Doc(); seed["t"] = Text("x")
    mgr = cm.CollabManager(FakeStore(initial=seed.get_update()))
    snap = await mgr.snapshot_state(9, db_session=None)
    assert snap is not None


# -- 입장·퇴장·저장 경합과 awareness 에코 (스크럼 "혼자 세션"·저장 유실 회귀) ----------------

class TxStore:
    """store + transactional_session 대역. 쓰기는 커밋 때만 반영되고, 저장·커밋을 기다리는 중에
    취소되면 반영되지 않는다(롤백). load/save/commit 각각에서 멈추고, hold_each_save() 뒤에는 save
    호출마다 전용 gate에서 멈춰 await 끼어들기를 결정적으로 재현한다."""

    def __init__(self):
        self.state = None
        self.load_gate = asyncio.Event()
        self.save_gate = asyncio.Event()
        self.commit_gate = asyncio.Event()
        self.held = None  # hold_each_save() 뒤에는 save 호출마다 전용 gate가 호출 순서대로 쌓인다
        self._held_changed = asyncio.Condition()
        self.open_all()
        self.saving = asyncio.Event()
        self.committing = asyncio.Event()
        self.commits = 0  # 실제로 반영된 커밋 수

    def open_all(self):
        for gate in (self.load_gate, self.save_gate, self.commit_gate, *(self.held or [])):
            gate.set()

    def hold_each_save(self):
        self.held = []

    async def wait_held(self, n):
        async with self._held_changed:
            await self._held_changed.wait_for(lambda: len(self.held) >= n)

    async def get_yjs_state(self, room_id, db, for_update=False):
        await self.load_gate.wait()
        return self.state

    async def save_yjs_state(self, room_id, state, db):
        self.saving.set()
        await self.save_gate.wait()
        if self.held is not None:
            gate = asyncio.Event()
            async with self._held_changed:
                self.held.append(gate)
                self._held_changed.notify_all()
            await gate.wait()
        db.staged = state

    @contextlib.asynccontextmanager
    async def session(self):
        tx = types.SimpleNamespace(staged=None)
        yield tx
        self.committing.set()
        await self.commit_gate.wait()
        if tx.staged is not None:
            self.state = tx.staged
            self.commits += 1


async def _settle(mgr, store, *tasks):
    """gate를 모두 열고 테스트가 만든 task와 방들의 debounce task를 끝까지 정리한다(실패해도 매달리지 않게)."""
    store.open_all()
    pending = [t for t in tasks if t is not None]
    pending += [room.persist_task for room in mgr.rooms.values() if room.persist_task is not None]
    for task in pending:
        task.cancel()
    await asyncio.gather(*pending, return_exceptions=True)


async def _finish_newest_first(store, *tasks):
    """멈춘 save를 가장 나중 것부터 푼다 — 같은 방 저장 순서가 보장되지 않으면 옛 저장이 나중에 커밋된다."""
    while not all(t.done() for t in tasks):
        waiting = [gate for gate in store.held if not gate.is_set()]
        if waiting:
            waiting[-1].set()
        await asyncio.sleep(0)


def _update_frame(text):
    """클라이언트가 보내는 SYNC_UPDATE 프레임 — 셀 'c'에 문단 하나를 더한다."""
    d = Doc()
    frag = d.get("c", type=XmlFragment)
    para = XmlElement("paragraph")
    frag.children.append(para)
    para.children.append(XmlText(text))
    update = d.get_update()
    return bytes([cm.MSG_SYNC, cm.SYNC_UPDATE]) + cm._write_var_uint(len(update)) + update


def _text(state):
    d = Doc()
    if state:
        d.apply_update(state)
    return str(d.get("c", type=XmlFragment))


def _awareness_frame(client_id):
    """[MSG_AWARENESS, len, count=1, clientID, clock=1, state] — 서버 파서가 clientID까지 읽는 형식."""
    state = b'{"user":{"name":"a"}}'
    body = (cm._write_var_uint(1) + cm._write_var_uint(client_id) + cm._write_var_uint(1)
            + cm._write_var_uint(len(state)) + state)
    return bytes([cm.MSG_AWARENESS]) + cm._write_var_uint(len(body)) + body


async def test_concurrent_join_shares_one_room():
    # 빈 방에 두 연결이 동시에 들어와 DB 로드를 함께 기다려도 같은 방에 있어야 서로의 편집을 받는다.
    store = TxStore()
    mgr = cm.CollabManager(store)
    a, b = FakeWS(), FakeWS()
    store.load_gate.clear()
    joining = [asyncio.create_task(mgr.join(1, 1, a, None)),
               asyncio.create_task(mgr.join(1, 2, b, None))]
    try:
        await asyncio.sleep(0)
        store.load_gate.set()
        room_a, room_b = await asyncio.wait_for(asyncio.gather(*joining), 1)
        assert room_a is room_b is mgr.rooms[1]
        await mgr.handle_message(1, b, _update_frame("b의 글"))
        assert a.sent, "먼저 들어온 연결도 상대 편집을 받아야 함"
    finally:
        await _settle(mgr, store, *joining)


async def test_join_and_edit_during_leave_save_are_kept(monkeypatch):
    # 마지막 연결이 나가며 저장하는 사이 새 연결이 들어와 편집하면, 방도 그 편집도 남아야 한다.
    store = TxStore()
    monkeypatch.setattr(cm.db, "transactional_session", store.session)
    mgr = cm.CollabManager(store)
    a, c = FakeWS(), FakeWS()
    await mgr.join(2, 1, a, None)
    await mgr.handle_message(2, a, _update_frame("a의 글"))
    store.save_gate.clear()
    leaving = asyncio.create_task(mgr.leave(2, 1, a))
    try:
        await asyncio.wait_for(store.saving.wait(), 1)
        await mgr.join(2, 3, c, None)
        await mgr.handle_message(2, c, _update_frame("c가 저장 중에 쓴 글"))
        store.save_gate.set()
        await asyncio.wait_for(leaving, 1)
        room = mgr.rooms.get(2)
        assert room is not None and any(w is c for _, w in room.connections)
        assert room.dirty is True  # 저장 스냅샷에 없는 편집이 남아 있다
        await asyncio.wait_for(mgr.leave(2, 3, c), 1)
        assert "c가 저장 중에 쓴 글" in _text(store.state)
    finally:
        await _settle(mgr, store, leaving)


async def test_debounced_save_persists_and_marks_clean(monkeypatch):
    # 정상 저장: debounce 저장이 끝나면 내용이 저장되고 dirty가 내려간다.
    store = TxStore()
    monkeypatch.setattr(cm.db, "transactional_session", store.session)
    monkeypatch.setattr(cm, "PERSIST_DEBOUNCE_SECS", 0)
    mgr = cm.CollabManager(store)
    a = FakeWS()
    room = await mgr.join(3, 1, a, None)
    try:
        await mgr.handle_message(3, a, _update_frame("평소 편집"))
        await asyncio.wait_for(room.persist_task, 1)
        assert room.dirty is False
        assert "평소 편집" in _text(store.state)
    finally:
        await _settle(mgr, store)


async def test_leave_during_debounced_save_keeps_edit(monkeypatch):
    # 편집 → debounce 저장 시작 → save 대기 → 마지막 연결 퇴장(저장 작업 취소) → 방을 다시 열면 편집이 있어야 한다.
    store = TxStore()
    monkeypatch.setattr(cm.db, "transactional_session", store.session)
    monkeypatch.setattr(cm, "PERSIST_DEBOUNCE_SECS", 0)
    mgr = cm.CollabManager(store)
    a = FakeWS()
    await mgr.join(4, 1, a, None)
    store.save_gate.clear()
    await mgr.handle_message(4, a, _update_frame("퇴장 직전 편집"))
    debounce = mgr.rooms[4].persist_task
    leaving = None
    try:
        await asyncio.wait_for(store.saving.wait(), 1)   # debounce 저장이 save 대기에 들어감
        leaving = asyncio.create_task(mgr.leave(4, 1, a))
        await asyncio.sleep(0)                           # leave가 debounce 저장을 취소한다
        store.save_gate.set()
        await asyncio.wait_for(leaving, 1)
        await asyncio.gather(debounce, return_exceptions=True)
        assert store.commits == 1  # 중단된 debounce 저장은 반영되지 않고 leave의 마지막 저장만 커밋됐다
        reopened = await mgr.join(4, 2, FakeWS(), None)
        assert "퇴장 직전 편집" in str(reopened.doc.get("c", type=XmlFragment))
    finally:
        await _settle(mgr, store, leaving, debounce)


async def test_leave_during_debounced_commit_keeps_edit(monkeypatch):
    # 같은 순서에서 debounce 저장이 커밋을 기다리는 중에 마지막 연결이 나가도 편집이 남아야 한다
    # (커밋 전에 dirty를 내리면 취소된 커밋과 함께 마지막 편집이 사라진다).
    store = TxStore()
    monkeypatch.setattr(cm.db, "transactional_session", store.session)
    monkeypatch.setattr(cm, "PERSIST_DEBOUNCE_SECS", 0)
    mgr = cm.CollabManager(store)
    a = FakeWS()
    await mgr.join(5, 1, a, None)
    store.commit_gate.clear()
    await mgr.handle_message(5, a, _update_frame("커밋 직전 편집"))
    debounce = mgr.rooms[5].persist_task
    leaving = None
    try:
        await asyncio.wait_for(store.committing.wait(), 1)   # debounce 저장이 커밋 대기에 들어감
        leaving = asyncio.create_task(mgr.leave(5, 1, a))
        await asyncio.sleep(0)
        store.commit_gate.set()
        await asyncio.wait_for(leaving, 1)
        await asyncio.gather(debounce, return_exceptions=True)
        assert store.commits == 1  # 중단된 debounce 저장은 반영되지 않고 leave의 마지막 저장만 커밋됐다
        reopened = await mgr.join(5, 2, FakeWS(), None)
        assert "커밋 직전 편집" in str(reopened.doc.get("c", type=XmlFragment))
    finally:
        await _settle(mgr, store, leaving, debounce)


async def test_overlapping_leave_saves_keep_latest(monkeypatch):
    # A의 마지막 퇴장 저장이 스냅샷을 뜬 뒤 UPDATE 전에 멈춘 사이 B가 들어와 편집하고 나간다. B의 A+B 저장이
    # 먼저, 옛 A 저장이 나중에 커밋되면 DB가 A로 되돌아간다 — 방을 다시 열면 A·B 편집이 모두 있어야 한다.
    store = TxStore()
    monkeypatch.setattr(cm.db, "transactional_session", store.session)
    mgr = cm.CollabManager(store)
    a, b = FakeWS(), FakeWS()
    await mgr.join(7, 1, a, None)
    await mgr.handle_message(7, a, _update_frame("A의 글"))
    store.hold_each_save()
    leave_a = asyncio.create_task(mgr.leave(7, 1, a))
    leave_b = None
    try:
        await asyncio.wait_for(store.wait_held(1), 1)   # A 저장이 스냅샷을 뜨고 UPDATE 전에 멈춤
        await mgr.join(7, 2, b, None)
        await mgr.handle_message(7, b, _update_frame("B의 글"))
        leave_b = asyncio.create_task(mgr.leave(7, 2, b))
        for _ in range(3):
            await asyncio.sleep(0)                      # B 저장이 갈 수 있는 데까지 가게 한다
        await asyncio.wait_for(_finish_newest_first(store, leave_a, leave_b), 1)
        reopened = await mgr.join(7, 3, FakeWS(), None)
        text = str(reopened.doc.get("c", type=XmlFragment))
        assert "A의 글" in text and "B의 글" in text
    finally:
        await _settle(mgr, store, leave_a, leave_b)


async def test_room_kept_while_later_save_pending(monkeypatch):
    # 같은 순서에서 A 저장이 먼저 끝나도 B 저장이 남아 있으면 방을 지우면 안 된다. 그 사이 들어온 C는
    # DB의 옛 상태(A)로 새 방을 열지 않고 B 편집이 든 같은 방에 합류해야 한다.
    store = TxStore()
    monkeypatch.setattr(cm.db, "transactional_session", store.session)
    mgr = cm.CollabManager(store)
    a, b, c = FakeWS(), FakeWS(), FakeWS()
    await mgr.join(8, 1, a, None)
    await mgr.handle_message(8, a, _update_frame("A의 글"))
    store.hold_each_save()
    leave_a = asyncio.create_task(mgr.leave(8, 1, a))
    leave_b = None
    try:
        await asyncio.wait_for(store.wait_held(1), 1)
        await mgr.join(8, 2, b, None)
        await mgr.handle_message(8, b, _update_frame("B의 글"))
        leave_b = asyncio.create_task(mgr.leave(8, 2, b))
        for _ in range(3):
            await asyncio.sleep(0)
        store.held[0].set()                              # A 저장만 먼저 끝낸다
        await asyncio.wait_for(leave_a, 1)
        await asyncio.wait_for(store.wait_held(2), 1)    # B 저장이 UPDATE 전에 멈춰 있다
        room_c = await mgr.join(8, 3, c, None)           # B 커밋 전에 C가 들어온다
        assert "B의 글" in str(room_c.doc.get("c", type=XmlFragment))
        store.held[1].set()
        await asyncio.wait_for(leave_b, 1)
        assert "A의 글" in _text(store.state) and "B의 글" in _text(store.state)
    finally:
        await _settle(mgr, store, leave_a, leave_b)


async def test_rest_write_during_last_leave_save_is_kept(monkeypatch):
    # 마지막 퇴장 저장이 스냅샷을 뜨고 save를 기다리는 사이, 새 연결 C가 들어와 있고 REST 쓰기
    # (apply_external_mutation)가 라이브 방에 적용된다. 이 쓰기가 버전을 올리지 않으면 저장이 끝날 때 dirty가
    # 내려가고, C가 30초 안에 나가면 REST가 걸어 둔 debounce도 취소돼 마지막 저장을 건너뛰어 사라진다.
    store = TxStore()
    monkeypatch.setattr(cm.db, "transactional_session", store.session)
    mgr = cm.CollabManager(store)
    a, c = FakeWS(), FakeWS()
    await mgr.join(9, 1, a, None)
    await mgr.handle_message(9, a, _update_frame("a의 글"))
    store.save_gate.clear()
    leaving = asyncio.create_task(mgr.leave(9, 1, a))
    try:
        await asyncio.wait_for(store.saving.wait(), 1)   # 퇴장 저장이 스냅샷을 뜨고 save 대기
        room = await mgr.join(9, 3, c, None)
        await mgr.apply_external_mutation(9, _write_hi, db_session=None)
        store.save_gate.set()
        await asyncio.wait_for(leaving, 1)
        assert room.dirty is True  # 저장 스냅샷에 없는 REST 쓰기가 남아 있다
        await asyncio.wait_for(mgr.leave(9, 3, c), 1)
        assert "hi" in _text(store.state)
    finally:
        await _settle(mgr, store, leaving)


async def test_persist_all_waits_for_inflight_save_and_keeps_latest(monkeypatch):
    # 서버 종료 저장(persist_all)이 진행 중인 퇴장 저장과 겹친다. 마지막 퇴장 저장이 옛 스냅샷으로 UPDATE를
    # 기다리는 사이 새 연결 C가 편집했고, 그때 서버가 종료된다. persist_all이 방 락(_save)을 거치지 않으면 C 편집이
    # 든 새 스냅샷이 먼저, 옛 퇴장 저장이 나중에 커밋돼 C 편집이 사라진다.
    store = TxStore()
    monkeypatch.setattr(cm.db, "transactional_session", store.session)
    mgr = cm.CollabManager(store)
    a, c = FakeWS(), FakeWS()
    await mgr.join(10, 1, a, None)
    await mgr.handle_message(10, a, _update_frame("a의 글"))
    store.hold_each_save()
    leaving = asyncio.create_task(mgr.leave(10, 1, a))
    persisting = None
    try:
        await asyncio.wait_for(store.wait_held(1), 1)   # 퇴장 저장이 옛 스냅샷으로 UPDATE 전에 멈춤
        room = await mgr.join(10, 3, c, None)
        await mgr.handle_message(10, c, _update_frame("c의 글"))
        persisting = asyncio.create_task(mgr.persist_all())
        for _ in range(3):
            await asyncio.sleep(0)                      # persist_all 저장이 갈 수 있는 데까지 가게 한다
        await asyncio.wait_for(_finish_newest_first(store, leaving, persisting), 1)
        assert "a의 글" in _text(store.state) and "c의 글" in _text(store.state)
        assert room.dirty is False  # persist_all도 _save를 거쳐 커밋 뒤 dirty를 내린다
    finally:
        await _settle(mgr, store, leaving, persisting)


async def test_awareness_is_echoed_to_sender():
    # y-websocket은 30초간 아무것도 못 받으면 스스로 끊는다 — 혼자여도 자기 awareness는 돌려받아야 한다.
    mgr = cm.CollabManager(FakeStore())
    a = FakeWS()
    await mgr.join(6, 1, a, None)
    frame = _awareness_frame(111)
    await mgr.handle_message(6, a, frame)
    assert a.sent == [frame]


async def test_awareness_not_echoed_outside_room():
    # 방에서 빠진 연결에는 돌려주지 않는다 — 계속 조용해야 30초 뒤 스스로 재연결해 복구된다.
    mgr = cm.CollabManager(FakeStore())
    a, ghost = FakeWS(), FakeWS()
    await mgr.join(6, 1, a, None)
    frame = _awareness_frame(222)
    await mgr.handle_message(6, ghost, frame)
    assert ghost.sent == []
    assert a.sent == [frame]


# -- REST 쓰기·방 입장의 행 잠금 계약 (실제 락 동작은 test_scrum_rest_write_lock.py) ----------------

class LockRecordingStore(FakeStore):
    def __init__(self):
        super().__init__()
        self.loads = []

    async def get_yjs_state(self, room_id, db, for_update=False):
        self.loads.append(for_update)
        return self._state


async def test_room_open_and_roomless_rest_write_lock_the_row():
    # 방이 없을 때의 REST 쓰기는 커밋 전까지 행을 잠그고, 방 입장은 그 커밋을 기다렸다 읽어야 한다(실제 락 동작은
    # test_scrum_rest_write_lock.py가 Postgres로 확인한다). 읽기 전용 스냅샷은 잠그지 않는다.
    store = LockRecordingStore()
    mgr = cm.CollabManager(store)
    await mgr.apply_external_mutation(20, _write_hi, db_session=None)   # 방 없음
    await mgr.snapshot_state(20, db_session=None)
    await mgr.join(20, 1, FakeWS(), None)
    assert store.loads == [True, False, True]


# -- 마지막 퇴장 저장 중 REST 쓰기 (닫힌 방에 debounce가 남지 않게) ---------------------------------

async def test_rest_write_during_last_leave_save_is_saved_before_room_closes(monkeypatch):
    # 마지막 퇴장 저장이 save를 기다리는 사이 REST 쓰기가 아직 dict에 있는 방(라이브 경로)에 들어온다. 아무도 다시
    # 들어오지 않으면 방은 닫혀야 하지만, 그 쓰기는 닫히기 전에 저장돼야 한다 — 닫힌 방의 debounce에만 남으면
    # 30초 안에 서버가 내려갈 때(배포) 사라진다.
    store = TxStore()
    monkeypatch.setattr(cm.db, "transactional_session", store.session)
    mgr = cm.CollabManager(store)
    a = FakeWS()
    await mgr.join(11, 1, a, None)
    await mgr.handle_message(11, a, _update_frame("a의 글"))
    store.save_gate.clear()
    leaving = asyncio.create_task(mgr.leave(11, 1, a))
    closed = None
    try:
        await asyncio.wait_for(store.saving.wait(), 1)   # 퇴장 저장이 스냅샷을 뜨고 save 대기
        closed = mgr.rooms[11]
        await mgr.apply_external_mutation(11, _write_hi, db_session=None)
        store.save_gate.set()
        await asyncio.wait_for(leaving, 1)
        assert 11 not in mgr.rooms
        assert "a의 글" in _text(store.state) and "hi" in _text(store.state)
    finally:
        await _settle(mgr, store, leaving, closed.persist_task if closed else None)


async def test_closed_room_debounce_does_not_overwrite_next_room(monkeypatch):
    # 같은 순서에서 방이 닫힌 뒤 B가 새 방을 열어 편집하고 나간다. 닫힌 방에 REST 쓰기의 debounce가 남아 있으면
    # 그것이 나중에 옛 문서(a+REST)로 저장해 B 편집을 덮는다.
    store = TxStore()
    monkeypatch.setattr(cm.db, "transactional_session", store.session)
    mgr = cm.CollabManager(store)
    a, b = FakeWS(), FakeWS()
    await mgr.join(12, 1, a, None)
    await mgr.handle_message(12, a, _update_frame("a의 글"))
    store.save_gate.clear()
    leaving = asyncio.create_task(mgr.leave(12, 1, a))
    closed = None
    try:
        await asyncio.wait_for(store.saving.wait(), 1)
        closed = mgr.rooms[12]
        monkeypatch.setattr(cm, "PERSIST_DEBOUNCE_SECS", 0.05)   # REST 쓰기가 거는 debounce만 짧게
        await mgr.apply_external_mutation(12, _write_hi, db_session=None)
        store.save_gate.set()
        await asyncio.wait_for(leaving, 1)
        room_b = await mgr.join(12, 2, b, None)
        assert "hi" in str(room_b.doc.get("c", type=XmlFragment))   # 닫히기 전에 저장된 REST 쓰기가 보인다
        await mgr.handle_message(12, b, _update_frame("b의 글"))
        await asyncio.wait_for(mgr.leave(12, 2, b), 1)
        await asyncio.sleep(0.1)                                     # 닫힌 방의 debounce가 남았다면 이때 저장한다
        text = _text(store.state)
        assert "a의 글" in text and "hi" in text and "b의 글" in text
    finally:
        await _settle(mgr, store, leaving, closed.persist_task if closed else None)


class FailingSaveStore(TxStore):
    async def save_yjs_state(self, room_id, state, db):
        await asyncio.sleep(0)   # 실제 DB처럼 한 번 양보한다(재시도가 무한 반복이면 wait_for가 끊을 수 있게)
        raise RuntimeError("db down")


async def test_leave_does_not_retry_forever_when_save_fails(monkeypatch):
    # DB 장애로 저장이 실패하면 leave는 지금처럼 한 번 시도하고 끝나야 한다(재저장 되풀이가 무한 반복이면 안 된다).
    store = FailingSaveStore()
    monkeypatch.setattr(cm.db, "transactional_session", store.session)
    mgr = cm.CollabManager(store)
    a = FakeWS()
    await mgr.join(13, 1, a, None)
    await mgr.handle_message(13, a, _update_frame("a의 글"))
    try:
        await asyncio.wait_for(mgr.leave(13, 1, a), 1)
        assert 13 not in mgr.rooms
    finally:
        await _settle(mgr, store)


# -- 방이 있을 때 REST 쓰기의 전송 대기 중 퇴장 (dirty·버전·예약은 첫 await 전에) --------------------------

class GatedWS(FakeWS):
    """send_bytes가 gate가 열릴 때까지 멈추는 연결(느린 소켓) — 전송 대기 중 끼어들기를 고정한다."""
    def __init__(self):
        super().__init__()
        self.gate = asyncio.Event()
        self.waiting = asyncio.Event()

    async def send_bytes(self, data):
        self.waiting.set()
        await self.gate.wait()
        self.sent.append(data)


async def test_rest_write_during_broadcast_is_saved_when_last_user_leaves(monkeypatch):
    # 깨끗한 방에 A만 있다. REST 쓰기가 문서를 바꾸고 A에게 보내는 전송이 느린 사이 A가 나간다. dirty가 전송 뒤에야
    # 서면 leave는 저장할 것이 없다고 보고 방을 지워, 다시 연 방에 REST 쓰기가 없다.
    store = TxStore()
    monkeypatch.setattr(cm.db, "transactional_session", store.session)
    mgr = cm.CollabManager(store)
    a = GatedWS()
    await mgr.join(14, 1, a, None)
    rest = asyncio.create_task(mgr.apply_external_mutation(14, _write_hi, db_session=None))
    closed = None
    try:
        await asyncio.wait_for(a.waiting.wait(), 1)          # REST 전송이 A에게 멈춰 있다
        closed = mgr.rooms[14]
        await asyncio.wait_for(mgr.leave(14, 1, a), 1)
        assert 14 not in mgr.rooms
        reopened = await mgr.join(14, 2, FakeWS(), None)
        assert "hi" in str(reopened.doc.get("c", type=XmlFragment))
    finally:
        a.gate.set()
        await _settle(mgr, store, rest, closed.persist_task if closed else None)


async def test_closed_room_gets_no_late_save_after_rest_broadcast(monkeypatch):
    # 같은 순서에서 B가 새 방을 열어 B_NEW를 쓰고 나간 뒤 REST 전송이 끝난다. 전송 뒤에 저장 예약을 만들면 닫힌 방에
    # 예약이 생기고, 그것이 옛 문서로 저장해 B_NEW를 덮는다.
    store = TxStore()
    monkeypatch.setattr(cm.db, "transactional_session", store.session)
    mgr = cm.CollabManager(store)
    a, b = GatedWS(), FakeWS()
    await mgr.join(15, 1, a, None)
    rest = asyncio.create_task(mgr.apply_external_mutation(15, _write_hi, db_session=None))
    closed = None
    try:
        await asyncio.wait_for(a.waiting.wait(), 1)
        closed = mgr.rooms[15]
        await asyncio.wait_for(mgr.leave(15, 1, a), 1)
        await mgr.join(15, 2, b, None)
        await mgr.handle_message(15, b, _update_frame("B_NEW"))
        await asyncio.wait_for(mgr.leave(15, 2, b), 1)
        monkeypatch.setattr(cm, "PERSIST_DEBOUNCE_SECS", 0.05)   # 닫힌 방에 늦은 예약이 생기면 곧 실행되게
        a.gate.set()
        await asyncio.wait_for(rest, 1)
        await asyncio.sleep(0.1)
        text = _text(store.state)
        assert "B_NEW" in text and "hi" in text
    finally:
        a.gate.set()
        await _settle(mgr, store, rest, closed.persist_task if closed else None)


async def test_rest_write_during_broadcast_keeps_room_dirty_past_older_save(monkeypatch):
    # A의 마지막 퇴장 저장이 옛 스냅샷으로 진행되는 사이 C가 들어오고, REST 쓰기가 C에게 보내는 전송에서 멈춘다.
    # 버전이 전송 뒤에야 오르면 그 저장이 끝날 때 dirty가 내려가, C가 나갈 때 REST 쓰기를 저장하지 않는다.
    store = TxStore()
    monkeypatch.setattr(cm.db, "transactional_session", store.session)
    mgr = cm.CollabManager(store)
    a, c = FakeWS(), GatedWS()
    await mgr.join(16, 1, a, None)
    await mgr.handle_message(16, a, _update_frame("a의 글"))
    store.save_gate.clear()
    leaving = asyncio.create_task(mgr.leave(16, 1, a))
    rest = None
    try:
        await asyncio.wait_for(store.saving.wait(), 1)       # 퇴장 저장이 옛 스냅샷으로 save 대기
        room = await mgr.join(16, 3, c, None)
        rest = asyncio.create_task(mgr.apply_external_mutation(16, _write_hi, db_session=None))
        await asyncio.wait_for(c.waiting.wait(), 1)          # REST 전송이 C에게 멈춰 있다
        store.save_gate.set()
        await asyncio.wait_for(leaving, 1)                   # 옛 스냅샷 저장이 커밋됐다(C가 있어 방은 유지)
        assert room.dirty is True                            # 저장본에 없는 REST 쓰기가 남아 있다
        await asyncio.wait_for(mgr.leave(16, 3, c), 1)       # 전송이 끝나기 전에 C가 나간다
        assert "hi" in _text(store.state)
    finally:
        c.gate.set()
        await _settle(mgr, store, leaving, rest)
