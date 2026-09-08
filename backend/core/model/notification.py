import json

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


def _payload_json(payload):
    """payload(dict) → JSONB 문자열. None이면 그대로 NULL로 저장한다(구버전 행과 같은 모양)."""
    return json.dumps(payload) if payload else None


async def create(user_id: int, ntype: str, actor_id: int, title: str,
                 link: str, entity_type: str, entity_id: int, db: AsyncSession,
                 payload: dict | None = None) -> int:
    """알림 생성, notification_id 반환.

    payload는 {'key': 메시지 키, 'params': {...}} — 읽는 사람의 언어로 다시 렌더하기 위한
    구조화 데이터다. title은 수신자 언어로 완성된 문장(구버전 행·Web Push 폴백).
    """
    result = await db.execute(text("""
        INSERT INTO notification
            (user_id, type, actor_id, title, link, entity_type, entity_id, payload)
        VALUES
            (:user_id, :type, :actor_id, :title, :link, :entity_type, :entity_id,
             CAST(:payload AS jsonb))
        RETURNING notification_id
    """), {
        'user_id': user_id, 'type': ntype, 'actor_id': actor_id,
        'title': title, 'link': link,
        'entity_type': entity_type, 'entity_id': entity_id,
        'payload': _payload_json(payload),
    })
    return result.scalar_one()


async def create_bulk(notifications: list[dict], db: AsyncSession):
    """여러 알림 일괄 생성"""
    if not notifications:
        return
    for n in notifications:
        await db.execute(text("""
            INSERT INTO notification
                (user_id, type, actor_id, title, link, entity_type, entity_id, payload)
            VALUES
                (:user_id, :type, :actor_id, :title, :link, :entity_type, :entity_id,
                 CAST(:payload AS jsonb))
        """), {**n, 'payload': _payload_json(n.get('payload'))})


async def find_by_user(user_id: int, limit: int = 30, offset: int = 0, db: AsyncSession = None):
    """사용자 알림 목록 (최신순)"""
    result = await db.execute(text("""
        SELECT n.notification_id, n.type, n.actor_id, n.title, n.link,
               n.entity_type, n.entity_id, n.is_read, n.created_at, n.payload,
               u.username AS actor_name,
               u.avatar_url AS actor_avatar_url, u.avatar_color AS actor_avatar_color
        FROM notification n
        LEFT JOIN "user" u ON n.actor_id = u.user_id
        WHERE n.user_id = :user_id
        ORDER BY n.created_at DESC
        LIMIT :limit OFFSET :offset
    """), {'user_id': user_id, 'limit': limit, 'offset': offset})
    return [dict(r._mapping) for r in result.fetchall()]


async def count_unread(user_id: int, db: AsyncSession) -> int:
    """읽지 않은 알림 수"""
    result = await db.execute(text("""
        SELECT COUNT(*) FROM notification
        WHERE user_id = :user_id AND is_read = false
    """), {'user_id': user_id})
    return result.scalar_one()


async def mark_read(notification_id: int, user_id: int, db: AsyncSession):
    """단일 알림 읽음 처리"""
    await db.execute(text("""
        UPDATE notification SET is_read = true
        WHERE notification_id = :nid AND user_id = :uid
    """), {'nid': notification_id, 'uid': user_id})


async def mark_all_read(user_id: int, db: AsyncSession):
    """전체 읽음 처리"""
    await db.execute(text("""
        UPDATE notification SET is_read = true
        WHERE user_id = :user_id AND is_read = false
    """), {'user_id': user_id})


async def delete_all(user_id: int, db: AsyncSession):
    """전체 삭제"""
    await db.execute(text("""
        DELETE FROM notification WHERE user_id = :user_id
    """), {'user_id': user_id})
