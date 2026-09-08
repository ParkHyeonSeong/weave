import asyncio
import json
import logging
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from core.model import notification as noti_model
from core.model import user as user_model
from core.model import push_subscription as push_sub_model
from library import messages
from library.locale_prefs import normalize_language_region
from library.ws_manager import manager
from config import VAPID_PRIVATE_KEY, VAPID_SUBJECT

logger = logging.getLogger(__name__)


async def _send_web_push(user_id: int, title: str, link: str, db: AsyncSession):
    """WebSocket 연결이 없는 사용자에게 Web Push 전송"""
    if not VAPID_PRIVATE_KEY:
        return

    subscriptions = await push_sub_model.find_by_user(user_id, db)
    if not subscriptions:
        return

    from pywebpush import webpush, WebPushException

    payload = json.dumps({
        'title': 'Weave',
        'body': title,
        'url': link or '/',
        'icon': '/icons/weave-192.png',
    })

    for sub in subscriptions:
        try:
            await asyncio.to_thread(
                webpush,
                subscription_info={
                    'endpoint': sub['endpoint'],
                    'keys': {'p256dh': sub['p256dh'], 'auth': sub['auth']},
                },
                data=payload,
                vapid_private_key=VAPID_PRIVATE_KEY,
                vapid_claims={'sub': VAPID_SUBJECT},
            )
        except WebPushException as e:
            if e.response and e.response.status_code in (404, 410):
                # 구독 만료 -> 삭제
                await push_sub_model.delete_by_endpoint(sub['endpoint'], db)
            else:
                logger.warning(f"Web Push failed: {e}")
        except Exception as e:
            logger.warning(f"Web Push error: {e}")


async def recipient_locale(user_id: int, db: AsyncSession) -> str:
    """수신자의 표시 언어. 설정이 없거나 손상됐으면 en."""
    region = normalize_language_region(await user_model.get_language_region(user_id, db))
    return messages.normalize_locale(region['locale'] if region else None)


async def notify(user_id: int, ntype: str, actor_id: int, message_key: str,
                 link: str, entity_type: str, entity_id: int, db: AsyncSession,
                 **params):
    """DB 저장 + WebSocket 실시간 푸시 (본인에게는 알림하지 않음).

    문구는 **수신자 언어**로 렌더한다(title). 동시에 payload에 {key, params}를 남겨,
    사용자가 나중에 언어를 바꾸면 프런트가 같은 키로 다시 렌더할 수 있게 한다 —
    공유 활동을 생성 시점의 한 언어로 굳히지 않기 위해서다.
    """
    if user_id == actor_id:
        return

    locale = await recipient_locale(user_id, db)
    title = messages.render(locale, f'notifications.{message_key}', **params)
    payload = {'key': message_key, 'params': params}

    noti_id = await noti_model.create(user_id, ntype, actor_id, title, link,
                                      entity_type, entity_id, db, payload=payload)
    unread = await noti_model.count_unread(user_id, db)

    # actor 조회 (이름 + 아바타) — 라이브 payload를 reload 후(find_by_user)와 동일하게
    actor_name = None
    actor_avatar_url = None
    actor_avatar_color = None
    if actor_id:
        actor = await user_model.find_by_id(actor_id, db)
        if actor:
            actor_name = actor['username']
            actor_avatar_url = actor.get('avatar_url')
            actor_avatar_color = actor.get('avatar_color')

    await manager.send_to_user(user_id, {
        'type': 'notification',
        'notification': {
            'notification_id': noti_id,
            'type': ntype,
            'actor_id': actor_id,
            'actor_name': actor_name,
            'actor_avatar_url': actor_avatar_url,
            'actor_avatar_color': actor_avatar_color,
            'title': title,
            'payload': payload,
            'link': link,
            'entity_type': entity_type,
            'entity_id': entity_id,
            'is_read': False,
            'created_at': str(datetime.now(timezone.utc)),
        },
        'unread_count': unread,
    })

    # WebSocket 연결 없음 -> Web Push 전송
    if user_id not in manager.active_connections:
        try:
            await _send_web_push(user_id, title, link, db)
        except Exception as e:
            logger.warning(f"Web Push fallback failed: {e}")


async def notify_bulk(user_ids: list[int], ntype: str, actor_id: int, message_key: str,
                      link: str, entity_type: str, entity_id: int, db: AsyncSession,
                      **params):
    """여러 수신자에게 일괄 알림 (actor 제외, 중복 제거).

    수신자마다 언어가 다를 수 있으므로 문구는 notify()가 각자의 언어로 만든다.
    """
    for uid in set(user_ids):
        await notify(uid, ntype, actor_id, message_key, link, entity_type, entity_id, db, **params)


def chat_fallback_key(*, task_ref=None, doc_ref=None, issue_ref=None, attachments=None) -> str:
    """본문이 빈 메시지의 폴백 문구 키. 무엇을 공유했는지만 구분한다.

    ws_chat은 텍스트가 없어도 ref나 첨부가 있으면 정상 메시지로 받으므로, 그 경우
    '새 메시지'보다 무엇이 왔는지 알려주는 편이 낫다.
    """
    if task_ref:
        return 'chat.sharedTask'
    if doc_ref:
        return 'chat.sharedDocument'
    if issue_ref:
        return 'chat.sharedIssue'
    if attachments:
        return 'chat.sharedAttachment'
    return 'chat.newMessage'


async def push_chat_to_offline(room_id: int, sender_id: int, sender_name: str,
                               content: str, db: AsyncSession,
                               task_ref=None, doc_ref=None, issue_ref=None, attachments=None):
    """오프라인 채팅방 멤버에게 Web Push 전송 (DB 알림 저장 없이 push만).

    본문이 있으면 **사용자가 입력한 내용 그대로** 보낸다(번역·변형 금지).
    본문이 없을 때만 수신자 언어의 폴백 문구를 쓴다 — 예전엔 영어 한 문장으로 굳어 있어
    한국어 사용자가 첨부·참조만 받으면 영어 push를 봤다.
    """
    from sqlalchemy import text

    result = await db.execute(text("""
        SELECT user_id FROM chat_room_member WHERE room_id = :room_id
    """), {'room_id': room_id})
    member_ids = [row[0] for row in result.fetchall()]

    fallback_key = None if content else chat_fallback_key(
        task_ref=task_ref, doc_ref=doc_ref, issue_ref=issue_ref, attachments=attachments)

    for uid in member_ids:
        if uid == sender_id:
            continue
        # WebSocket 연결이 없는 멤버에게만 push
        if uid not in manager.active_connections:
            try:
                if fallback_key is None:
                    body = f'{sender_name}: {content}'
                else:
                    locale = await recipient_locale(uid, db)
                    body = f'{sender_name}: {messages.render(locale, fallback_key)}'
                await _send_web_push(uid, body, None, db)
            except Exception as e:
                logger.warning(f"Chat push failed for user {uid}: {e}")
