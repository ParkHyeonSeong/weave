import json
import re
from datetime import datetime, timezone

import jwt
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from config import JWT_SECRET_KEY, JWT_ALGORITHM, COOKIE_NAME, WS_MAX_MESSAGE_BYTES
from library.origins import reject_ws_if_forbidden_origin
from library.ws_manager import manager, schedule_token_expiry_close
from core.model import chat_message as message_model
from core.model import chat_member as member_model
from core.model import chat_attachment as attachment_model
from core.model import task as task_model
from core.model import canvas_page as canvas_page_model
from core.model import task_issue as issue_model
from core.model import user as user_model
from library import notification_service
import db_engine as db

router = APIRouter()

# 채팅 첨부는 /chat/upload가 생성한 chat 서브디렉터리 파일만 허용한다(SEC-41).
# startswith('/api/uploads/')는 '//host/...'·'/../..' 같은 경로를 통과시켜 약하므로,
# 정확한 chat 업로드 URL 형식만 매칭한다(실 서빙 경계는 uploads 라우트가 한 번 더 검증).
_ATTACHMENT_URL_RE = re.compile(r'^/api/uploads/chat/[A-Za-z0-9._-]+$')


def _verify_token(token: str) -> dict | None:
    """JWT 토큰 검증"""
    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        if payload.get('user_id'):
            return payload
    except Exception:
        pass
    return None


@router.websocket("/ws/chat")
async def websocket_chat(ws: WebSocket):
    """채팅 WebSocket 엔드포인트"""
    if await reject_ws_if_forbidden_origin(ws):  # SEC-39: cross-site WebSocket hijacking 차단
        return
    # 쿠키에서 JWT 인증
    token = ws.cookies.get(COOKIE_NAME, '')
    payload = _verify_token(token)
    if not payload:
        await ws.close(code=4001, reason="Unauthorized")
        return

    user_id = payload['user_id']
    username = payload.get('username', '')

    # 첫 연결인지 확인 (멀티탭 대응: 기존 연결 0개일 때만 online broadcast)
    was_offline = not manager.is_online(user_id)
    await manager.connect(user_id, ws)

    if was_offline:
        await manager.broadcast_to_all({
            'type': 'presence',
            'user_id': user_id,
            'status': 'online',
        })

    # 토큰 만료 직전 서버가 선제 종료 → 클라(Layout)가 새 쿠키로 재연결(SEC-29)
    expiry_task = schedule_token_expiry_close(ws, payload)

    # 보낸 사람 아바타 — 연결당 1회만 조회해 모든 메시지 broadcast에 재사용
    # (라이브 메시지가 reload 후 find_by_room 결과와 같은 아바타를 갖도록)
    sender_avatar_url = None
    sender_avatar_color = None
    sender_avatar_loaded = False

    try:
        while True:
            raw = await ws.receive_text()
            if len(raw) > WS_MAX_MESSAGE_BYTES:  # SEC-20: 대형 메시지 차단
                await ws.close(code=1009, reason="Message too large")
                break
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                continue

            action = data.get('action')

            if action == 'send_message':
                room_id = data.get('room_id')
                content = data.get('content', '').strip()
                task_id = data.get('task_id')
                canvas_page_id = data.get('canvas_page_id')
                issue_id = data.get('issue_id')
                attachments = data.get('attachments', [])  # [{ url, file_name, file_type, file_size }]
                # content, 참조, 또는 첨부 중 하나는 있어야 함
                if not room_id or (not content and not task_id and not canvas_page_id and not issue_id and not attachments):
                    continue

                # DB 세션 생성 (WebSocket은 Depends 사용 불가)
                async with db.transactional_session() as session:
                    # 멤버 확인
                    if not await member_model.is_member(room_id, user_id, session):
                        continue

                    # 보낸 사람 아바타 1회 조회 (이후 메시지는 캐시 재사용)
                    if not sender_avatar_loaded:
                        sender = await user_model.find_by_id(user_id, session)
                        if sender:
                            sender_avatar_url = sender.get('avatar_url')
                            sender_avatar_color = sender.get('avatar_color')
                        sender_avatar_loaded = True

                    # 메시지 저장
                    msg = await message_model.create(
                        room_id, user_id, content, session,
                        task_id=task_id, canvas_page_id=canvas_page_id,
                        issue_id=issue_id
                    )

                    # task_ref 정보 조회
                    task_ref = None
                    if task_id:
                        task = await task_model.find_by_id(task_id, session)
                        if task:
                            task_ref = {
                                'task_id': task['task_id'],
                                'branch_id': task['branch_id'],
                                'display_id': task['display_id'],
                                'title': task['title'],
                                'status': task['status'],
                                'priority': task['priority'],
                                'assignees': task.get('assignees', []),
                            }

                    # doc_ref 정보 조회
                    doc_ref = None
                    if canvas_page_id:
                        doc = await canvas_page_model.find_by_id_simple(canvas_page_id, session)
                        if doc:
                            doc_ref = {
                                'page_id': doc['page_id'],
                                'canvas_id': doc['canvas_id'],
                                'title': doc['title'],
                                'canvas_name': doc['canvas_name'],
                            }

                    # issue_ref 정보 조회
                    issue_ref = None
                    if issue_id:
                        issue = await issue_model.find_by_id_simple(issue_id, session)
                        if issue:
                            issue_ref = {
                                'issue_id': issue['issue_id'],
                                'task_id': issue['task_id'],
                                'branch_id': issue['branch_id'],
                                'display_id': issue['display_id'],
                                'title': issue['title'],
                                'status': issue['status'],
                            }

                    # 첨부파일 저장 (서버 업로드 경로만 허용)
                    saved_attachments = []
                    if attachments:
                        valid = [a for a in attachments[:10]
                                 if a.get('url') and a.get('file_name')
                                 and _ATTACHMENT_URL_RE.match(a['url'])]
                        if valid:
                            att_list = [{
                                'file_url': a['url'],
                                'file_name': a['file_name'],
                                'file_type': a.get('file_type', 'application/octet-stream'),
                                'file_size': a.get('file_size', 0),
                            } for a in valid]
                            await attachment_model.bulk_create(msg['message_id'], att_list, session)
                            saved_attachments = att_list

                    # @멘션 알림 처리
                    mentioned_user_ids = data.get('mentioned_user_ids', [])
                    if mentioned_user_ids:
                        await notification_service.notify_bulk(
                            mentioned_user_ids,
                            'chat_mention',
                            user_id,
                            'chatMention',
                            None,
                            'chat_room',
                            room_id,
                            session,
                            actor=username,
                        )

                    # room 멤버에게 broadcast
                    await manager.broadcast_to_room(room_id, {
                        'type': 'new_message',
                        'room_id': room_id,
                        'message': {
                            'message_id': msg['message_id'],
                            'room_id': msg['room_id'],
                            'sender_id': msg['sender_id'],
                            'sender_name': username,
                            'sender_avatar_url': sender_avatar_url,
                            'sender_avatar_color': sender_avatar_color,
                            'content': msg['content'],
                            'created_at': msg['created_at'],
                            'task_ref': task_ref,
                            'doc_ref': doc_ref,
                            'issue_ref': issue_ref,
                            'attachments': saved_attachments,
                        },
                    }, session)

                    # 오프라인 멤버에게 Web Push
                    await notification_service.push_chat_to_offline(
                        room_id, user_id, username, content, session
                    )

            elif action == 'mark_read':
                room_id = data.get('room_id')
                if not room_id:
                    continue

                async with db.transactional_session() as session:
                    await member_model.update_last_read(room_id, user_id, session)

                    # 상대방에게 읽음 알림 전송
                    await manager.broadcast_to_room(room_id, {
                        'type': 'mark_read',
                        'room_id': room_id,
                        'user_id': user_id,
                        'last_read_at': str(datetime.now(timezone.utc)),
                    }, session)

    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        if expiry_task:
            expiry_task.cancel()
        # 정상 종료·끊김·예외·크기초과(break) 모든 경로에서 연결 정리(중복 제거)
        manager.disconnect(user_id, ws)
        if not manager.is_online(user_id):
            await manager.broadcast_to_all({
                'type': 'presence',
                'user_id': user_id,
                'status': 'offline',
            })
