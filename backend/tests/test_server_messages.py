"""서버가 만드는 문구(알림·이메일)의 언어 계약.

핵심 두 가지:
  1) 알림은 **수신자 언어**로 렌더되고 payload에 구조화 데이터가 남는다 —
     한 워크스페이스에 여러 언어 사용자가 있어도 각자 읽을 수 있어야 하고,
     나중에 언어를 바꾸면 프런트가 payload로 다시 렌더할 수 있어야 한다.
  2) messages.py의 notifications.* 키는 프런트 카탈로그와 1:1이어야 한다.
     어긋나면 언어를 바꾼 사용자가 키 문자열을 보게 된다.
"""
import json
import re

from sqlalchemy import text

from core.model import notification as noti_model
from library import messages
from library import notification_service


def _placeholders_py(value: str) -> set:
    return set(re.findall(r'\{(\w+)\}', value))


# ---------------------------------------------------------------------------
# 카탈로그 계약
# ---------------------------------------------------------------------------

def test_server_message_locales_have_the_same_keys():
    assert set(messages.MESSAGES['en']) == set(messages.MESSAGES['ko'])


def test_locales_share_the_same_placeholders():
    """en/ko가 같은 보간 이름을 쓴다. (서버-프런트 카탈로그 대조는 두 트리를 모두 볼 수 있는
    frontend/library/serverMessages.test.js가 맡는다 — 백엔드 컨테이너에는 frontend가 없다.)"""
    for key, en_value in messages.MESSAGES['en'].items():
        assert _placeholders_py(en_value) == _placeholders_py(messages.MESSAGES['ko'][key]), key


def test_render_falls_back_to_english_and_never_raises():
    assert messages.render('ko', 'notifications.taskAssigned', actor='민수', ref='WV-1 제목') \
        == '민수님이 WV-1 제목에 회원님을 담당자로 지정했습니다'
    assert messages.render('en', 'notifications.taskAssigned', actor='Ann', ref='WV-1 Title') \
        == 'Ann assigned you to WV-1 Title'
    # 지원하지 않는 locale → en
    assert messages.render('fr', 'notifications.chatMention', actor='Ann') \
        == messages.render('en', 'notifications.chatMention', actor='Ann')
    # 파라미터가 빠져도 예외 없이 문구를 낸다(알림 자체는 나가야 한다)
    assert messages.render('en', 'notifications.taskAssigned') != ''
    # 없는 키는 키 문자열을 돌려준다(조용히 빈 문자열이 되지 않는다)
    assert messages.render('en', 'notifications.doesNotExist') == 'notifications.doesNotExist'


# ---------------------------------------------------------------------------
# 수신자 언어로 저장 + payload
# ---------------------------------------------------------------------------

async def _make_user(db, email, username, prefs=None):
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status, ui_prefs)
        VALUES (:e, :p, :u, 'active', CAST(:prefs AS jsonb)) RETURNING user_id
    """), {"e": email, "p": b"x", "u": username, "prefs": prefs})
    return row.scalar_one()


async def test_notification_is_stored_in_each_recipients_language(db_session, monkeypatch):
    """같은 이벤트라도 영어 사용자와 한국어 사용자는 각자의 언어로 저장된 문구를 받는다."""
    async def no_ws(*args, **kwargs):
        return None
    monkeypatch.setattr(notification_service.manager, 'send_to_user', no_ws)

    actor = await _make_user(db_session, 'noti-actor@test.local', 'Ann')
    en_user = await _make_user(
        db_session, 'noti-en@test.local', 'en-user',
        '{"language_region": {"locale": "en", "time_zone": "America/New_York"}}')
    ko_user = await _make_user(
        db_session, 'noti-ko@test.local', 'ko-user',
        '{"language_region": {"locale": "ko", "time_zone": "Asia/Seoul"}}')

    await notification_service.notify_bulk(
        [en_user, ko_user], 'task_assigned', actor, 'taskAssigned',
        '/branch/1/task/2', 'task', 2, db_session, actor='Ann', ref='WV-1 Ship it')

    rows = {}
    for uid in (en_user, ko_user):
        items = await noti_model.find_by_user(uid, 10, 0, db_session)
        assert len(items) == 1
        rows[uid] = items[0]

    assert rows[en_user]['title'] == 'Ann assigned you to WV-1 Ship it'
    assert rows[ko_user]['title'] == 'Ann님이 WV-1 Ship it에 회원님을 담당자로 지정했습니다'

    # payload는 언어와 무관한 구조화 데이터 — 프런트가 읽는 시점의 언어로 다시 렌더한다.
    for row in rows.values():
        payload = row['payload']
        if isinstance(payload, str):
            payload = json.loads(payload)
        assert payload['key'] == 'taskAssigned'
        assert payload['params'] == {'actor': 'Ann', 'ref': 'WV-1 Ship it'}


async def test_notification_for_user_without_preference_is_english(db_session, monkeypatch):
    async def no_ws(*args, **kwargs):
        return None
    monkeypatch.setattr(notification_service.manager, 'send_to_user', no_ws)

    actor = await _make_user(db_session, 'noti-actor2@test.local', 'Ann')
    plain = await _make_user(db_session, 'noti-plain@test.local', 'plain')

    await notification_service.notify(
        plain, 'chat_mention', actor, 'chatMention', None, 'chat_room', 1, db_session, actor='Ann')

    items = await noti_model.find_by_user(plain, 10, 0, db_session)
    assert items[0]['title'] == 'Ann mentioned you in chat'


async def test_actor_never_notifies_themselves(db_session, monkeypatch):
    async def no_ws(*args, **kwargs):
        return None
    monkeypatch.setattr(notification_service.manager, 'send_to_user', no_ws)

    actor = await _make_user(db_session, 'noti-self@test.local', 'self')
    await notification_service.notify(
        actor, 'mention', actor, 'chatMention', None, 'chat_room', 1, db_session, actor='self')
    assert await noti_model.find_by_user(actor, 10, 0, db_session) == []


# ---------------------------------------------------------------------------
# 오프라인 채팅 Web Push — 본문이 없는 메시지의 폴백도 수신자 언어로
# ---------------------------------------------------------------------------

def test_chat_fallback_key_distinguishes_what_was_shared():
    """텍스트가 없어도 무엇이 왔는지 구분한다(ws_chat이 허용하는 네 가지 + 일반)."""
    k = notification_service.chat_fallback_key
    assert k(task_ref={'task_id': 1}) == 'chat.sharedTask'
    assert k(doc_ref={'page_id': 1}) == 'chat.sharedDocument'
    assert k(issue_ref={'issue_id': 1}) == 'chat.sharedIssue'
    assert k(attachments=[{'file_name': 'a.png'}]) == 'chat.sharedAttachment'
    assert k() == 'chat.newMessage'


async def _chat_room(db, suffix):
    """보낸 사람 + en/ko 수신자가 있는 방 하나."""
    sender = await _make_user(db, f'chat-sender-{suffix}@test.local', f'Ann{suffix}')
    en_user = await _make_user(
        db, f'chat-en-{suffix}@test.local', f'chat-en-{suffix}',
        '{"language_region": {"locale": "en", "time_zone": "America/New_York"}}')
    ko_user = await _make_user(
        db, f'chat-ko-{suffix}@test.local', f'chat-ko-{suffix}',
        '{"language_region": {"locale": "ko", "time_zone": "Asia/Seoul"}}')
    room_id = (await db.execute(text("""
        INSERT INTO chat_room (room_type, created_by) VALUES ('group', :u) RETURNING room_id
    """), {"u": sender})).scalar_one()
    for uid in (sender, en_user, ko_user):
        await db.execute(text("""
            INSERT INTO chat_room_member (room_id, user_id) VALUES (:r, :u)
        """), {"r": room_id, "u": uid})
    return room_id, sender, en_user, ko_user


def _capture_push(monkeypatch):
    sent = []

    async def fake_push(user_id, title, link, db_):
        sent.append((user_id, title))

    monkeypatch.setattr(notification_service, '_send_web_push', fake_push)
    # 모든 멤버를 '오프라인'으로 둔다 — active_connections에 없으면 push 대상이다.
    monkeypatch.setattr(notification_service.manager, 'active_connections', {})
    return sent


async def test_offline_chat_push_without_text_uses_each_recipients_language(db_session, monkeypatch):
    """첨부·참조만 있는 메시지도 영어 한 문장으로 굳지 않는다."""
    cases = [
        ({'task_ref': {'task_id': 1}}, 'Shared a task', '태스크를 공유했습니다'),
        ({'doc_ref': {'page_id': 1}}, 'Shared a document', '문서를 공유했습니다'),
        ({'issue_ref': {'issue_id': 1}}, 'Shared an issue', '이슈를 공유했습니다'),
        ({'attachments': [{'file_name': 'a.png'}]}, 'Sent an attachment', '첨부를 보냈습니다'),
        ({}, 'New message', '새 메시지'),
    ]
    for i, (structure, en_text, ko_text) in enumerate(cases):
        sent = _capture_push(monkeypatch)
        room_id, sender, en_user, ko_user = await _chat_room(db_session, f'{i}')
        await notification_service.push_chat_to_offline(
            room_id, sender, 'Ann', '', db_session, **structure)
        bodies = dict(sent)
        assert bodies[en_user] == f'Ann: {en_text}', structure
        assert bodies[ko_user] == f'Ann: {ko_text}', structure
        assert sender not in bodies, '보낸 사람에게는 push하지 않는다'


async def test_offline_chat_push_never_translates_user_content(db_session, monkeypatch):
    """사용자가 입력한 내용은 언어와 무관하게 그대로 나간다(번역·변형 금지)."""
    sent = _capture_push(monkeypatch)
    room_id, sender, en_user, ko_user = await _chat_room(db_session, 'content')
    await notification_service.push_chat_to_offline(
        room_id, sender, 'Ann', '안녕하세요 deploy 갑니다', db_session,
        attachments=[{'file_name': 'a.png'}])
    bodies = dict(sent)
    assert bodies[en_user] == 'Ann: 안녕하세요 deploy 갑니다'
    assert bodies[ko_user] == 'Ann: 안녕하세요 deploy 갑니다'
