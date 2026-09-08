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
