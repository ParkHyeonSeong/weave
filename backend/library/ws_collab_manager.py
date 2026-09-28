import asyncio
import logging

from fastapi import WebSocket
from pycrdt import Doc

from core.model import canvas_page as canvas_page_model
from core.model import scrum_week as scrum_week_model
from core.model import scrum_retro as scrum_retro_model
import db_engine as db

logger = logging.getLogger("weave.collab")

MSG_SYNC = 0
MSG_AWARENESS = 1

SYNC_STEP1 = 0
SYNC_STEP2 = 1
SYNC_UPDATE = 2

PERSIST_DEBOUNCE_SECS = 30


def _read_var_uint(data: bytes, offset: int) -> tuple[int, int]:
    """Read a variable-length unsigned integer (LEB128)."""
    result = 0
    shift = 0
    while offset < len(data):
        byte = data[offset]
        offset += 1
        result |= (byte & 0x7F) << shift
        if (byte & 0x80) == 0:
            break
        shift += 7
    return result, offset


def _write_var_uint(value: int) -> bytes:
    """Write a variable-length unsigned integer (LEB128)."""
    result = bytearray()
    while value > 0x7F:
        result.append((value & 0x7F) | 0x80)
        value >>= 7
    result.append(value & 0x7F)
    return bytes(result)


def _encode_state_vector(doc: Doc) -> bytes:
    """Encode sync step 1 message: [MSG_SYNC, SYNC_STEP1, var_uint(len), sv]"""
    sv = doc.get_state()
    return bytes([MSG_SYNC, SYNC_STEP1]) + _write_var_uint(len(sv)) + sv


def _encode_update(doc: Doc, sv: bytes = None) -> bytes:
    """Encode sync step 2 message: [MSG_SYNC, SYNC_STEP2, var_uint(len), update]"""
    if sv is not None:
        update = doc.get_update(sv)
    else:
        update = doc.get_update()
    return bytes([MSG_SYNC, SYNC_STEP2]) + _write_var_uint(len(update)) + update


class Room:
    __slots__ = ('room_id', 'doc', 'connections', 'awareness_states',
                 'persist_task', 'dirty', 'version', 'save_lock', 'saves_pending')

    def __init__(self, room_id: int, doc: Doc):
        self.room_id = room_id
        self.doc = doc
        self.connections: list[tuple[int, WebSocket]] = []
        self.awareness_states: dict[int, bytes] = {}
        self.persist_task: asyncio.Task | None = None
        self.dirty = False
        self.version = 0  # 편집마다 1씩 오른다 — 저장 도중 편집이 있었는지 _save가 판별한다
        self.save_lock = asyncio.Lock()  # 같은 방 저장을 한 번에 하나씩 돌린다(스냅샷 순서 = 커밋 순서)
        self.saves_pending = 0  # 락을 기다리거나 저장 중인 _save 수 — 0이 아니면 leave가 방을 지우지 않는다


class CollabManager:
    """Yjs 협업 룸 매니저. store는 async get_yjs_state(room_id, db) /
    save_yjs_state(room_id, state, db)를 제공한다. 매니저마다 rooms가 격리됨."""

    def __init__(self, store):
        self.store = store
        self.rooms: dict[int, Room] = {}

    async def join(self, room_id: int, user_id: int, ws: WebSocket,
                   db_session) -> Room:
        """방 입장: YDoc 로드, 클라이언트 등록"""
        if room_id not in self.rooms:
            yjs_state = await self.store.get_yjs_state(room_id, db_session)
            # 로드를 기다리는 사이 같은 방에 먼저 들어온 연결이 방을 만들었을 수 있다 — 덮어쓰면 그
            # 연결이 dict에서 빠진 방에 남아 상대 편집을 못 받는다(apply_external_mutation과 같은 재확인).
            if room_id not in self.rooms:
                doc = Doc()
                if yjs_state:
                    doc.apply_update(yjs_state)
                self.rooms[room_id] = Room(room_id, doc)

        room = self.rooms[room_id]
        room.connections.append((user_id, ws))

        for client_id, state_bytes in room.awareness_states.items():
            await self._send_raw(ws, state_bytes)

        logger.info("User %d joined room %d (%d connections)",
                     user_id, room_id, len(room.connections))
        return room

    async def leave(self, room_id: int, user_id: int, ws: WebSocket):
        """방 퇴장"""
        room = self.rooms.get(room_id)
        if not room:
            return

        room.connections = [
            (uid, w) for uid, w in room.connections if w != ws
        ]

        logger.info("User %d left room %d (%d remaining)",
                     user_id, room_id, len(room.connections))

        if not room.connections:
            if room.persist_task and not room.persist_task.done():
                room.persist_task.cancel()

            # 취소한 debounce 저장이 저장·커밋 도중이었어도 _save는 커밋이 끝난 뒤에만 dirty를
            # 내리므로 dirty가 남아 있다 — 여기서 마지막으로 저장한다.
            if room.dirty:
                await self._save(room)

            # 저장을 기다리는 사이 새 연결이 들어왔거나 뒤이은 저장(다른 leave 등)이 아직 남아 있으면
            # 방을 살려 둔다 — 지우면 그 연결의 편집이 버려지거나, 그 저장이 커밋되기 전에 들어온 연결이
            # DB의 옛 상태로 새 방을 열어 덮어쓴다. 같은 방의 다른 leave가 이미 지웠을 수도 있다.
            if room.connections or room.saves_pending or self.rooms.get(room_id) is not room:
                return
            del self.rooms[room_id]
            logger.info("Room %d closed", room_id)

    async def handle_message(self, room_id: int, sender_ws: WebSocket,
                             data: bytes):
        """수신된 binary 메시지 처리"""
        if len(data) < 1:
            return

        room = self.rooms.get(room_id)
        if not room:
            return

        msg_type = data[0]

        if msg_type == MSG_SYNC:
            await self._handle_sync(room, sender_ws, data)
        elif msg_type == MSG_AWARENESS:
            await self._handle_awareness(room, sender_ws, data)

    async def _handle_sync(self, room: Room, sender_ws: WebSocket,
                           data: bytes):
        """Yjs sync protocol 처리"""
        if len(data) < 2:
            return

        sync_type = data[1]

        if sync_type == SYNC_STEP1:
            try:
                sv_len, offset = _read_var_uint(data, 2)
                client_sv = data[offset:offset + sv_len]
                response = _encode_update(room.doc, client_sv)
                await self._send_raw(sender_ws, response)
                sv_msg = _encode_state_vector(room.doc)
                await self._send_raw(sender_ws, sv_msg)
            except Exception as e:
                logger.warning("Sync step 1 error for room %d: %s",
                               room.room_id, e)
                response = _encode_update(room.doc)
                await self._send_raw(sender_ws, response)

        elif sync_type == SYNC_STEP2 or sync_type == SYNC_UPDATE:
            try:
                update_len, offset = _read_var_uint(data, 2)
                update = data[offset:offset + update_len]
                room.doc.apply_update(update)
                room.dirty = True
                room.version += 1
                self._schedule_persist(room)
            except Exception as e:
                logger.warning("Failed to apply update to room %d: %s",
                               room.room_id, e)
                return

            await self._broadcast(room, sender_ws, data)

    async def _handle_awareness(self, room: Room, sender_ws: WebSocket,
                                data: bytes):
        """Awareness update relay + storage.

        보낸 연결에게도 돌려준다(y-websocket 표준 서버와 같은 동작). y-websocket 클라이언트는
        30초간 아무 메시지도 못 받으면 끊고 재연결하는데, 방에 혼자면 받을 것이 15초마다 갱신되는
        자기 awareness뿐이다. room.connections 기준으로 보내므로 방에서 빠진 연결은 계속 조용해
        스스로 재연결해 복구된다.
        """
        try:
            if len(data) > 2:
                _, offset = _read_var_uint(data, 1)
                _, offset2 = _read_var_uint(data, offset)
                if offset2 < len(data):
                    client_id, _ = _read_var_uint(data, offset2)
                    room.awareness_states[client_id] = data
        except Exception:
            pass

        await self._broadcast(room, None, data)

    async def _send_raw(self, ws: WebSocket, data: bytes):
        try:
            await ws.send_bytes(data)
        except Exception:
            pass

    async def _broadcast(self, room: Room, sender_ws: WebSocket,
                         data: bytes):
        """sender_ws를 제외하고 broadcast(None이면 방 전원)"""
        dead = []
        for uid, ws in room.connections:
            if ws == sender_ws:
                continue
            try:
                await ws.send_bytes(data)
            except Exception:
                dead.append((uid, ws))

        for item in dead:
            room.connections = [c for c in room.connections if c != item]

    def _schedule_persist(self, room: Room):
        if room.persist_task and not room.persist_task.done():
            room.persist_task.cancel()

        room.persist_task = asyncio.create_task(
            self._debounced_persist(room)
        )

    async def _debounced_persist(self, room: Room):
        try:
            await asyncio.sleep(PERSIST_DEBOUNCE_SECS)
            await self._save(room)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error("Failed to persist room %d: %s", room.room_id, e)

    async def _save(self, room: Room):
        """room을 자기 트랜잭션으로 저장한다. 같은 방 저장은 save_lock으로 한 번에 하나씩 돌고
        스냅샷을 락 안에서 뜨므로, 나중에 시작한 저장이 더 최신 스냅샷을 나중에 커밋한다.
        dirty는 커밋까지 끝났고 그 사이 새 편집이 없었을 때만 내린다. 저장·커밋 도중 취소(leave,
        새 편집의 debounce 재예약)되거나 _persist가 실패하면 dirty를 그대로 둔다."""
        room.saves_pending += 1
        try:
            async with room.save_lock:
                async with db.transactional_session() as session:
                    version = room.version
                    saved = await self._persist(room, session)
                if saved and room.version == version:
                    room.dirty = False
        finally:
            room.saves_pending -= 1

    async def _persist(self, room: Room, db_session) -> bool:
        """현재 doc 전체를 저장한다. dirty는 건드리지 않는다(_save가 커밋 뒤에 판단)."""
        try:
            state = room.doc.get_update()
            await self.store.save_yjs_state(room.room_id, state, db_session)
            logger.info("Persisted room %d (%d bytes)", room.room_id, len(state))
            return True
        except Exception as e:
            logger.error("Persist failed for room %d: %s", room.room_id, e)
            return False

    async def persist_all(self):
        """서버 종료 시 모든 활성 room 영속화"""
        for room_id, room in list(self.rooms.items()):
            if room.dirty:
                try:
                    await self._save(room)
                except Exception as e:
                    logger.error("Shutdown persist failed for room %d: %s",
                                 room_id, e)

    async def apply_external_mutation(self, room_id: int, mutate, db_session) -> None:
        """REST 등 외부 경로에서 room 문서를 변경한다.

        활성 룸이 있으면 라이브 doc에 적용하고 변경분을 연결된 클라이언트에 브로드캐스트
        (열린 브라우저 즉시 반영, 다음 persist에 영속화). 없으면 DB state를 로드해
        변경 후 저장하되 rooms에는 등록하지 않는다(메모리 누수 방지). mutate(doc)는 동기.
        """
        room = self.rooms.get(room_id)
        if room is None:
            # 활성 룸 없음: DB state 로드 → 변경 → 저장. get_yjs_state await 동안 WS
            # 클라이언트가 join해 룸이 생길 수 있으므로, 저장 직전 다시 확인해 그 경우
            # 라이브 경로로 합류시킨다(전체 doc 덮어쓰기로 인한 WS 편집 유실 방지).
            state = await self.store.get_yjs_state(room_id, db_session)
            room = self.rooms.get(room_id)
            if room is None:
                doc = Doc()
                if state:
                    doc.apply_update(state)
                mutate(doc)
                await self.store.save_yjs_state(room_id, doc.get_update(), db_session)
                return
        before = room.doc.get_state()
        mutate(room.doc)
        msg = _encode_update(room.doc, before)
        await self._broadcast(room, None, msg)
        room.dirty = True
        room.version += 1
        self._schedule_persist(room)

    async def snapshot_state(self, room_id: int, db_session) -> bytes | None:
        """현재 yjs_state: 활성 룸이면 인메모리 doc(최신), 아니면 DB."""
        room = self.rooms.get(room_id)
        if room is not None:
            return room.doc.get_update()
        return await self.store.get_yjs_state(room_id, db_session)


class CanvasPageStore:
    """캔버스 페이지 yjs_state store (기존 동작 보존)."""
    async def get_yjs_state(self, room_id, db_session):
        return await canvas_page_model.get_yjs_state(room_id, db_session)

    async def save_yjs_state(self, room_id, state, db_session):
        await canvas_page_model.save_yjs_state(room_id, state, None, db_session)


class ScrumWeekStore:
    """스크럼 주(週) yjs_state store."""
    async def get_yjs_state(self, room_id, db_session):
        return await scrum_week_model.get_yjs_state(room_id, db_session)

    async def save_yjs_state(self, room_id, state, db_session):
        await scrum_week_model.save_yjs_state(room_id, state, db_session)


class ScrumRetroStore:
    """스크럼 회고 yjs_state store."""
    async def get_yjs_state(self, room_id, db_session):
        return await scrum_retro_model.get_yjs_state(room_id, db_session)

    async def save_yjs_state(self, room_id, state, db_session):
        await scrum_retro_model.save_yjs_state(room_id, state, db_session)


collab_manager = CollabManager(CanvasPageStore())
scrum_week_collab_manager = CollabManager(ScrumWeekStore())
scrum_retro_collab_manager = CollabManager(ScrumRetroStore())
