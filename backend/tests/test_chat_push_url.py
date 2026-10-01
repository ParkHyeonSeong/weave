"""채팅 Web Push를 누르면 그 대화방이 열린다(/?chat=<방 번호>).

- 오프라인 멤버에게 가는 채팅 메시지 push와 채팅 멘션 알림 push는 모두 방 주소를 싣는다.
  앱(frontend Layout)은 ?chat= 을 읽어 그 방을 열고 주소에서 지운다. 예전엔 link가 없어
  url이 '/'였고, 누르면 홈만 열렸다.
- 채팅 멘션 알림 **행**의 link는 계속 비워 둔다. link가 있으면 종 알림 클릭이 그 주소로
  페이지를 옮겨(Header) 보던 화면을 떠나게 된다 — 종에서 방을 여는 일은 entity(chat_room)가 한다.
"""
from sqlalchemy import text

from core.model import notification as noti_model
from library import notification_service


async def _make_user(db, email, username):
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status)
        VALUES (:e, :p, :u, 'active') RETURNING user_id
    """), {"e": email, "p": b"x", "u": username})
    return row.scalar_one()


async def _room_with(db, creator, *members):
    room_id = (await db.execute(text("""
        INSERT INTO chat_room (room_type, created_by) VALUES ('group', :u) RETURNING room_id
    """), {"u": creator})).scalar_one()
    for uid in (creator, *members):
        await db.execute(text("""
            INSERT INTO chat_room_member (room_id, user_id) VALUES (:r, :u)
        """), {"r": room_id, "u": uid})
    return room_id


def _everyone_offline(monkeypatch):
    """모든 사용자를 오프라인으로 두고 Web Push와 WS 전송을 가로챈다."""
    pushes, ws_sent = [], []

    async def fake_push(user_id, title, link, db_):
        pushes.append((user_id, link))

    async def fake_send(user_id, message):
        ws_sent.append((user_id, message))

    monkeypatch.setattr(notification_service, '_send_web_push', fake_push)
    monkeypatch.setattr(notification_service.manager, 'send_to_user', fake_send)
    monkeypatch.setattr(notification_service.manager, 'active_connections', {})
    return pushes, ws_sent


async def test_offline_chat_message_push_opens_the_room(db_session, monkeypatch):
    pushes, _ = _everyone_offline(monkeypatch)
    sender = await _make_user(db_session, 'chat-push-sender@test.local', 'chat-push-sender')
    a = await _make_user(db_session, 'chat-push-a@test.local', 'chat-push-a')
    b = await _make_user(db_session, 'chat-push-b@test.local', 'chat-push-b')
    room_id = await _room_with(db_session, sender, a, b)

    await notification_service.push_chat_to_offline(room_id, sender, 'Ann', 'hi', db_session)

    assert sorted(pushes) == sorted([(a, f'/?chat={room_id}'), (b, f'/?chat={room_id}')])


async def test_chat_mention_push_opens_the_room_but_the_row_link_stays_empty(db_session, monkeypatch):
    pushes, ws_sent = _everyone_offline(monkeypatch)
    actor = await _make_user(db_session, 'chat-push-actor@test.local', 'chat-push-actor')
    target = await _make_user(db_session, 'chat-push-target@test.local', 'chat-push-target')
    room_id = await _room_with(db_session, actor, target)

    # routers/ws_chat.py가 채팅 @멘션을 보내는 호출 그대로(link=None, entity=chat_room)
    await notification_service.notify_bulk(
        [target], 'chat_mention', actor, 'chatMention', None, 'chat_room', room_id,
        db_session, actor='chat-push-actor')

    assert pushes == [(target, f'/?chat={room_id}')]
    rows = await noti_model.find_by_user(target, 10, 0, db_session)
    assert len(rows) == 1 and rows[0]['link'] is None
    assert ws_sent[0][1]['notification']['link'] is None


async def test_other_notifications_keep_their_own_push_link(db_session, monkeypatch):
    """방 주소는 채팅방 알림에만 붙는다 — link가 있는 알림은 그 link로 간다."""
    pushes, _ = _everyone_offline(monkeypatch)
    actor = await _make_user(db_session, 'task-push-actor@test.local', 'task-push-actor')
    target = await _make_user(db_session, 'task-push-target@test.local', 'task-push-target')

    await notification_service.notify(
        target, 'task_assigned', actor, 'taskAssigned', '/branch/1/task/2', 'task', 2,
        db_session, actor='task-push-actor', ref='WV-1 Ship it')

    assert pushes == [(target, '/branch/1/task/2')]
