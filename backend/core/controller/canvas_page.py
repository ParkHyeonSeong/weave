from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from core.errors import error_response, ErrorCode
from core.model import canvas_page as page_model
from core.model import canvas_member as member_model
from core.model import recent_view
from library import notification_service
from library import activity_service
from library.html_markdown import ensure_html, html_to_markdown
from library.html_sanitize import sanitize_html
from library.mention_parser import extract_mention_user_ids


async def _verify_parent_in_canvas(parent_page_id, canvas_id: int, db: AsyncSession):
    """parent_page_id가 같은 canvas 소속인지 검증 (cross-canvas 트리 손상 차단).

    문제 없으면 None, 위반이면 에러 dict를 반환한다.
    """
    if parent_page_id is None:
        return None
    parent_page = await page_model.find_by_id(parent_page_id, db)
    if not parent_page or parent_page['canvas_id'] != canvas_id:
        return error_response(ErrorCode.PARENT_PAGE_NOT_FOUND)
    return None


async def create(canvas_id: int, body, request: Request, db: AsyncSession):
    """Canvas 페이지/폴더 생성"""
    user_id = request.state.payload.get('user_id')

    if not await member_model.is_member(canvas_id, user_id, db):
        return error_response(ErrorCode.NOT_CANVAS_MEMBER)

    # parent_page_id가 같은 canvas 소속인지 검증 (cross-canvas 트리 손상 차단)
    err = await _verify_parent_in_canvas(body.parent_page_id, canvas_id, db)
    if err:
        return err

    position = await page_model.get_next_position(canvas_id, body.parent_page_id, db)

    if body.type == 'typst':
        # Typst raw 소스 — HTML로 렌더되지 않으므로(typst.ts SVG 컴파일 전용) md 변환·정화 모두 우회.
        # nh3는 <intro> 같은 Typst 라벨을 미지 태그로 제거해 소스를 훼손한다.
        stored_content = body.content or ''
    elif body.type == 'document':
        stored_content = sanitize_html(ensure_html(body.content)) or ''  # SEC-17 + md ingress
    else:  # folder — content 비어있는 관례, 기존대로 정화만
        stored_content = sanitize_html(body.content) or ''

    page_id = await page_model.create(
        canvas_id=canvas_id,
        title=body.title,
        content=stored_content,
        parent_page_id=body.parent_page_id,
        position=position,
        created_by=user_id,
        page_type=body.type,
        db=db,
    )

    # 활동 로그
    await activity_service.log_canvas_page_created(page_id, canvas_id, user_id, body.title, db)

    return {'status': True, 'page_id': page_id}


async def get_tree(canvas_id: int, request: Request, db: AsyncSession):
    """Canvas 내 페이지 트리"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(canvas_id, user_id, db):
        return error_response(ErrorCode.NOT_CANVAS_MEMBER)

    pages = await page_model.find_tree(canvas_id, db)
    return {'status': True, 'pages': pages}


async def get_detail(canvas_id: int, page_id: int, request: Request, db: AsyncSession,
                     fmt: str = 'html'):
    """페이지 상세 (content 포함)"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(canvas_id, user_id, db):
        return error_response(ErrorCode.NOT_CANVAS_MEMBER)

    page = await page_model.find_by_id(page_id, db)
    if not page or page['canvas_id'] != canvas_id:
        return error_response(ErrorCode.PAGE_NOT_FOUND)

    # typst 페이지 content는 Typst 소스 — HTML 아님, 변환 제외
    if fmt == 'markdown' and page.get('content') and page.get('type') != 'typst':
        page['content'] = html_to_markdown(page['content'])

    # 조회 기록
    await recent_view.upsert(user_id, 'doc', page_id, db)

    return {'status': True, 'page': page}


async def update(canvas_id: int, page_id: int, body, request: Request, db: AsyncSession):
    """페이지 수정"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(canvas_id, user_id, db):
        return error_response(ErrorCode.NOT_CANVAS_MEMBER)

    page = await page_model.find_by_id(page_id, db)
    if not page or page['canvas_id'] != canvas_id:
        return error_response(ErrorCode.PAGE_NOT_FOUND)

    fields = body.model_dump(exclude_unset=True)
    if not fields:
        return {'status': True}

    # SEC-17: 저장 전 서버측 HTML 정화(프론트 DOMPurify 우회 경로 방어)
    # type 가드: content 컬럼은 typst 페이지의 raw 소스도 담는다 — 그 경우 md 변환도
    # 정화도 우회한다(생성 시와 동일 근거, page['type']은 CanvasPageUpdate에 없어 우회 불가).
    if 'content' in fields:
        if page['type'] == 'typst':
            pass  # Typst raw 소스 보존 — 변환·정화 모두 금지 (위 create 주석 참고)
        elif page['type'] in ('document', 'overview'):
            fields['content'] = sanitize_html(ensure_html(fields['content']))
        else:  # folder
            fields['content'] = sanitize_html(fields['content'])

    await page_model.update(page_id, fields, user_id, db)

    # 활동 로그
    await activity_service.log_canvas_page_change(page_id, canvas_id, user_id, page, fields, db)

    # content 멘션 알림 (새로 추가된 멘션만)
    if 'content' in fields and fields['content']:
        old_mentions = set(extract_mention_user_ids(page.get('content') or ''))
        new_mentions = set(extract_mention_user_ids(fields['content']))
        added_mentions = new_mentions - old_mentions
        if added_mentions:
            username = request.state.payload.get('username', '')
            page_title = page.get('title', '')
            link = f'/canvas/{canvas_id}/page/{page_id}'
            await notification_service.notify_bulk(
                list(added_mentions), 'mention', user_id,
                'canvasPageMention', link, 'doc', page_id, db,
                actor=username, page=page_title,
            )

    return {'status': True}


async def move(canvas_id: int, page_id: int, body, request: Request, db: AsyncSession):
    """페이지/폴더 이동 (DnD용)"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(canvas_id, user_id, db):
        return error_response(ErrorCode.NOT_CANVAS_MEMBER)

    page = await page_model.find_by_id(page_id, db)
    if not page or page['canvas_id'] != canvas_id:
        return error_response(ErrorCode.PAGE_NOT_FOUND)

    # overview 페이지는 이동 불가
    if page['type'] == 'overview':
        return error_response(ErrorCode.CANNOT_MOVE_OVERVIEW)

    # parent_page_id가 같은 canvas 소속인지 검증 (cross-canvas 이동 차단)
    err = await _verify_parent_in_canvas(body.parent_page_id, canvas_id, db)
    if err:
        return err

    # 트리 사이클 차단 (self-parent / descendant-parent) — CP-001
    if body.parent_page_id is not None and \
            await page_model.is_circular_parent(page_id, body.parent_page_id, db):
        return error_response(ErrorCode.PARENT_CYCLE)

    await page_model.move_page(
        page_id, canvas_id, body.parent_page_id, body.position, user_id, db
    )

    # 활동 로그
    await activity_service.log_canvas_page_moved(page_id, canvas_id, user_id, db)

    return {'status': True}


async def copy(canvas_id: int, page_id: int, body, request: Request, db: AsyncSession):
    """페이지 복제 (단일 문서만, 폴더 불가)"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(canvas_id, user_id, db):
        return error_response(ErrorCode.NOT_CANVAS_MEMBER)

    page = await page_model.find_by_id(page_id, db)
    if not page or page['canvas_id'] != canvas_id:
        return error_response(ErrorCode.PAGE_NOT_FOUND)

    if page['type'] in ('overview', 'folder'):
        return error_response(ErrorCode.CANNOT_COPY_THIS_TYPE)

    # parent_page_id가 같은 canvas 소속인지 검증 (cross-canvas 복제 차단)
    err = await _verify_parent_in_canvas(body.parent_page_id, canvas_id, db)
    if err:
        return err

    new_page_id = await page_model.copy_page(
        page_id, body.parent_page_id, user_id, db
    )
    return {'status': True, 'page_id': new_page_id}


async def delete(canvas_id: int, page_id: int, request: Request, db: AsyncSession):
    """페이지 아카이브 (하위 페이지 포함)"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(canvas_id, user_id, db):
        return error_response(ErrorCode.NOT_CANVAS_MEMBER)

    page = await page_model.find_by_id(page_id, db)
    if not page or page['canvas_id'] != canvas_id:
        return error_response(ErrorCode.PAGE_NOT_FOUND)

    # overview 페이지는 삭제 불가
    if page['type'] == 'overview':
        return error_response(ErrorCode.CANNOT_DELETE_OVERVIEW)

    # 활동 로그 (삭제 전 기록)
    await activity_service.log_canvas_page_deleted(page_id, canvas_id, user_id, page.get('title', ''), db)

    await page_model.hard_delete(page_id, db)
    return {'status': True}
