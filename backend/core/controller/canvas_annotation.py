from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from core.errors import error_response, ErrorCode
from core.model import canvas_annotation as annotation_model
from core.model import canvas_member as member_model
from core.model import canvas_page as page_model
from library import notification_service
from library.mention_parser import extract_mention_user_ids
from library.ws_manager import manager


async def _broadcast_annotation_event(canvas_id: int, page_id: int, action: str,
                                      user_id: int, db: AsyncSession):
    """캔버스 멤버에게 annotation 이벤트 브로드캐스트"""
    members = await member_model.find_by_canvas(canvas_id, db)
    for m in members:
        uid = m['user_id']
        if uid != user_id:
            await manager.send_to_user(uid, {
                'type': 'canvas_annotation',
                'action': action,
                'canvas_id': canvas_id,
                'page_id': page_id,
            })


async def _check_member(canvas_id: int, request: Request, db: AsyncSession):
    """Canvas 멤버 확인"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(canvas_id, user_id, db):
        return None, error_response(ErrorCode.NOT_CANVAS_MEMBER)
    return user_id, None


async def _check_page(page_id: int, canvas_id: int, db: AsyncSession):
    """페이지 존재 및 소속 확인"""
    page = await page_model.find_by_id(page_id, db)
    if not page or page['canvas_id'] != canvas_id:
        return None, error_response(ErrorCode.PAGE_NOT_FOUND)
    return page, None


# -- 앵커 CRUD --

async def create_annotation(body, canvas_id: int, page_id: int, request: Request, db: AsyncSession):
    """앵커 + 첫 댓글 생성"""
    user_id, err = await _check_member(canvas_id, request, db)
    if err:
        return err

    page, page_err = await _check_page(page_id, canvas_id, db)
    if page_err:
        return page_err

    annotation_id = await annotation_model.create_annotation(
        page_id=page_id,
        created_by=user_id,
        quoted_text=body.quoted_text,
        prefix_context=body.prefix_context,
        suffix_context=body.suffix_context,
        anchor_node_path=body.anchor_node_path,
        anchor_offset=body.anchor_offset,
        anchor_length=body.anchor_length,
        db=db,
    )

    # 첫 댓글 저장
    await annotation_model.create_reply(annotation_id, user_id, body.content, db)

    # 페이지 작성자에게 알림
    if page.get('created_by') and page['created_by'] != user_id:
        username = request.state.payload.get('username', '')
        link = f'/canvas/{canvas_id}/{page_id}'
        await notification_service.notify_bulk(
            [page['created_by']], 'annotation_created', user_id,
            'canvasCommentCreated', link, 'canvas_page', page_id, db, actor=username,
        )

    # 멘션 알림
    mentioned = extract_mention_user_ids(body.content)
    if mentioned:
        username = request.state.payload.get('username', '')
        link = f'/canvas/{canvas_id}/{page_id}'
        await notification_service.notify_bulk(
            mentioned, 'mention', user_id,
            'canvasCommentMention', link, 'canvas_page', page_id, db, actor=username,
        )

    # 실시간 브로드캐스트
    await _broadcast_annotation_event(canvas_id, page_id, 'created', user_id, db)

    return {'status': True, 'annotation_id': annotation_id}


async def list_annotations(canvas_id: int, page_id: int, status: str | None,
                           request: Request, db: AsyncSession):
    """페이지 앵커 목록"""
    _, err = await _check_member(canvas_id, request, db)
    if err:
        return err

    _, page_err = await _check_page(page_id, canvas_id, db)
    if page_err:
        return page_err

    annotations = await annotation_model.find_by_page(page_id, status, db)

    # 각 앵커의 답글도 함께 반환
    for ann in annotations:
        ann['replies'] = await annotation_model.find_replies(ann['annotation_id'], db)

    return {'status': True, 'annotations': annotations}


async def update_annotation(body, canvas_id: int, page_id: int, annotation_id: int,
                            request: Request, db: AsyncSession):
    """앵커 상태 변경"""
    user_id, err = await _check_member(canvas_id, request, db)
    if err:
        return err

    annotation = await annotation_model.find_by_id(annotation_id, db)
    if not annotation or annotation['page_id'] != page_id:
        return error_response(ErrorCode.ANNOTATION_NOT_FOUND)

    resolved_by = user_id if body.status == 'resolved' else None
    await annotation_model.update_status(annotation_id, body.status, resolved_by, db)

    # resolve 시 앵커 작성자에게 알림
    if body.status == 'resolved' and annotation['created_by'] != user_id:
        username = request.state.payload.get('username', '')
        link = f'/canvas/{canvas_id}/{page_id}'
        await notification_service.notify_bulk(
            [annotation['created_by']], 'annotation_resolved', user_id,
            'canvasCommentResolved', link, 'canvas_page', page_id, db, actor=username,
        )

    await _broadcast_annotation_event(canvas_id, page_id, 'updated', user_id, db)
    return {'status': True}


async def delete_annotation(canvas_id: int, page_id: int, annotation_id: int,
                            request: Request, db: AsyncSession):
    """앵커 삭제 (작성자만)"""
    user_id, err = await _check_member(canvas_id, request, db)
    if err:
        return err

    annotation = await annotation_model.find_by_id(annotation_id, db)
    if not annotation or annotation['page_id'] != page_id:
        return error_response(ErrorCode.ANNOTATION_NOT_FOUND)

    if annotation['created_by'] != user_id:
        return error_response(ErrorCode.NOT_ANNOTATION_AUTHOR)

    await annotation_model.delete_annotation(annotation_id, db)
    await _broadcast_annotation_event(canvas_id, page_id, 'deleted', user_id, db)
    return {'status': True}


# -- 답글 CRUD --

async def create_reply(body, canvas_id: int, page_id: int, annotation_id: int,
                       request: Request, db: AsyncSession):
    """답글 추가"""
    user_id, err = await _check_member(canvas_id, request, db)
    if err:
        return err

    annotation = await annotation_model.find_by_id(annotation_id, db)
    if not annotation or annotation['page_id'] != page_id:
        return error_response(ErrorCode.ANNOTATION_NOT_FOUND)

    reply_id = await annotation_model.create_reply(annotation_id, user_id, body.content, db)

    # 앵커 작성자 + 기존 답글 작성자에게 알림
    recipients = set()
    recipients.add(annotation['created_by'])
    replier_ids = await annotation_model.find_replier_ids(annotation_id, db)
    recipients.update(replier_ids)
    recipients.discard(user_id)

    if recipients:
        username = request.state.payload.get('username', '')
        link = f'/canvas/{canvas_id}/{page_id}'
        await notification_service.notify_bulk(
            list(recipients), 'annotation_reply', user_id,
            'canvasReplyCreated', link, 'canvas_page', page_id, db, actor=username,
        )

    # 멘션 알림
    mentioned = extract_mention_user_ids(body.content)
    if mentioned:
        username = request.state.payload.get('username', '')
        link = f'/canvas/{canvas_id}/{page_id}'
        await notification_service.notify_bulk(
            mentioned, 'mention', user_id,
            'canvasReplyMention', link, 'canvas_page', page_id, db, actor=username,
        )

    await _broadcast_annotation_event(canvas_id, page_id, 'replied', user_id, db)
    return {'status': True, 'reply_id': reply_id}


async def update_reply(body, canvas_id: int, page_id: int, annotation_id: int,
                       reply_id: int, request: Request, db: AsyncSession):
    """답글 수정 (작성자만)"""
    user_id, err = await _check_member(canvas_id, request, db)
    if err:
        return err

    reply = await annotation_model.find_reply_by_id(reply_id, db)
    if not reply or reply['annotation_id'] != annotation_id:
        return error_response(ErrorCode.REPLY_NOT_FOUND)

    if reply['author_id'] != user_id:
        return error_response(ErrorCode.NOT_REPLY_AUTHOR)

    await annotation_model.update_reply(reply_id, body.content, db)
    return {'status': True}


async def delete_reply(canvas_id: int, page_id: int, annotation_id: int,
                       reply_id: int, request: Request, db: AsyncSession):
    """답글 삭제 (작성자만)"""
    user_id, err = await _check_member(canvas_id, request, db)
    if err:
        return err

    reply = await annotation_model.find_reply_by_id(reply_id, db)
    if not reply or reply['annotation_id'] != annotation_id:
        return error_response(ErrorCode.REPLY_NOT_FOUND)

    if reply['author_id'] != user_id:
        return error_response(ErrorCode.NOT_REPLY_AUTHOR)

    await annotation_model.delete_reply(reply_id, db)
    return {'status': True}
