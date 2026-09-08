from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from core.errors import error_response, ErrorCode
from core.model import task_comment as comment_model
from core.model import branch_member as member_model
from core.model import task as task_model
from library import notification_service
from library.html_markdown import ensure_html, html_to_markdown
from library.mention_parser import extract_mention_user_ids


# ---- Permission helpers ----

async def _check_member(branch_id: int, request: Request, db: AsyncSession):
    """Branch 멤버 확인"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return None, error_response(ErrorCode.NOT_BRANCH_MEMBER)
    return user_id, None


async def _check_task(task_id: int, branch_id: int, db: AsyncSession):
    """Task 존재 + branch 소속 확인. (task dict, None) 또는 (None, err)"""
    task = await task_model.find_by_id(task_id, db)
    if not task or task['branch_id'] != branch_id:
        return None, error_response(ErrorCode.TASK_NOT_FOUND)
    return task, None


async def _check_author(comment_id: int, task_id: int, user_id: int, db: AsyncSession):
    """댓글 존재 + task 소속 + 작성자 본인 확인."""
    comment = await comment_model.find_by_id(comment_id, db)
    if not comment or comment['task_id'] != task_id:
        return None, error_response(ErrorCode.COMMENT_NOT_FOUND)
    if comment['author_id'] != user_id:
        return None, error_response(ErrorCode.NOT_AUTHOR)
    return comment, None


# ---- Response hydration ----

def _hydrate(row: dict) -> dict:
    """DB row → API response shape. soft-deleted면 content 빈 문자열, is_deleted=True."""
    deleted = row.get('deleted_at') is not None
    return {
        'comment_id': row['comment_id'],
        'task_id': row['task_id'],
        'parent_comment_id': row['parent_comment_id'],
        'content': '' if deleted else row['content'],
        'is_edited': row['is_edited'],
        'is_deleted': deleted,
        'created_at': row['created_at'],
        'updated_at': row['updated_at'],
        'author': {
            'user_id': row['author_id'],
            'username': row['username'],
            'avatar_url': row.get('avatar_url'),
            'avatar_color': row.get('avatar_color'),
        },
    }


def _task_ref(task: dict) -> str:
    """알림 문구에 넣을 태스크 참조 — 'WV-12 제목'. 문장은 수신자 언어로 조립된다."""
    return f'{task.get("display_id", "")} {task.get("title", "")}'.strip()


def _comment_link(branch_id: int, task_id: int, comment_id: int) -> str:
    return f'/branch/{branch_id}/task/{task_id}?comment_id={comment_id}'


# ---- Notification helper ----

async def _notify_mentions(recipients: list[int], actor_id: int, username: str,
                            task: dict, branch_id: int, task_id: int,
                            comment_id: int, db: AsyncSession):
    """멘션된 사용자에게 알림 발송 (actor 본인 제외는 notify_bulk 내부에서 처리)."""
    await notification_service.notify_bulk(
        recipients, 'mention', actor_id,
        'taskCommentMention',
        _comment_link(branch_id, task_id, comment_id),
        'task_comment', comment_id, db,
        actor=username, ref=_task_ref(task),
    )


# ---- CRUD ----

async def list_comments(branch_id: int, task_id: int, request: Request,
                         db: AsyncSession, order: str = 'asc', fmt: str = 'html'):
    """Task의 댓글 목록 (평면 배열, created_at asc|desc + comment_id tiebreak). 멘션 user_ids 포함."""
    _, err = await _check_member(branch_id, request, db)
    if err:
        return err
    _, err = await _check_task(task_id, branch_id, db)
    if err:
        return err

    rows = await comment_model.find_by_task(task_id, db, order=order)
    comments = [_hydrate(r) for r in rows]

    if comments:
        bucket = await comment_model.get_mentions_bulk(
            [c['comment_id'] for c in comments], db,
        )
        for c in comments:
            c['mentioned_user_ids'] = bucket.get(c['comment_id'], [])

    if fmt == 'markdown':
        for c in comments:
            if c['content']:
                c['content'] = html_to_markdown(c['content'])

    return {'status': True, 'comments': comments}


async def create_comment(body, branch_id: int, task_id: int, request: Request,
                          db: AsyncSession):
    """댓글 작성. parent_comment_id가 답글이면 root로 silent normalize."""
    user_id, err = await _check_member(branch_id, request, db)
    if err:
        return err
    task, err = await _check_task(task_id, branch_id, db)
    if err:
        return err

    body.content = ensure_html(body.content)

    # Reply normalize — silent
    parent_id = body.parent_comment_id
    parent_author_id = None
    if parent_id is not None:
        parent = await comment_model.find_by_id(parent_id, db)
        if not parent or parent['task_id'] != task_id:
            return error_response(ErrorCode.INVALID_PARENT)
        if parent.get('deleted_at') is not None:
            return error_response(ErrorCode.PARENT_DELETED)
        parent_author_id = parent['author_id']
        if parent['parent_comment_id'] is not None:
            # normalize to root, then re-verify root is alive
            parent_id = parent['parent_comment_id']
            root = await comment_model.find_by_id(parent_id, db)
            if not root or root.get('deleted_at') is not None:
                return error_response(ErrorCode.PARENT_DELETED)
            parent_author_id = root['author_id']

    comment_id = await comment_model.create(task_id, user_id, body.content, parent_id, db)

    raw_mentions = extract_mention_user_ids(body.content)
    mentions = await member_model.filter_users_in_branch(branch_id, raw_mentions, db)
    username = request.state.payload.get('username', '')
    if mentions:
        await comment_model.add_mentions(comment_id, mentions, db)
        await _notify_mentions(
            sorted(mentions), user_id, username, task,
            branch_id, task_id, comment_id, db,
        )

    # 답글이면 root 댓글 작성자에게 알림 — 본인·멘션 중복·비멤버 제외
    if (parent_author_id is not None and parent_author_id != user_id
            and parent_author_id not in mentions
            and await member_model.is_member(branch_id, parent_author_id, db)):
        await notification_service.notify_bulk(
            [parent_author_id], 'comment_reply', user_id,
            'taskCommentReply',
            _comment_link(branch_id, task_id, comment_id),
            'task_comment', comment_id, db,
            actor=username, ref=_task_ref(task),
        )

    row = await comment_model.find_by_id(comment_id, db)
    hydrated = _hydrate(row)
    hydrated['mentioned_user_ids'] = sorted(mentions)
    return {'status': True, 'comment': hydrated}


async def update_comment(body, branch_id: int, task_id: int, comment_id: int,
                          request: Request, db: AsyncSession):
    """댓글 수정 (본인만). 멘션 diff로 새로 추가된 사용자에게만 알림."""
    user_id, err = await _check_member(branch_id, request, db)
    if err:
        return err
    task, err = await _check_task(task_id, branch_id, db)
    if err:
        return err
    comment, err = await _check_author(comment_id, task_id, user_id, db)
    if err:
        return err
    if comment.get('deleted_at') is not None:
        return error_response(ErrorCode.COMMENT_DELETED)

    body.content = ensure_html(body.content)

    raw_new = extract_mention_user_ids(body.content)
    old_list = await comment_model.get_mentions(comment_id, db)
    new_list = await member_model.filter_users_in_branch(branch_id, raw_new, db)
    old_mentions = set(old_list)
    new_mentions = set(new_list)
    added = new_mentions - old_mentions
    removed = old_mentions - new_mentions

    await comment_model.update_content(comment_id, body.content, db)

    if removed:
        await comment_model.remove_mentions(comment_id, list(removed), db)
    if added:
        await comment_model.add_mentions(comment_id, list(added), db)
        username = request.state.payload.get('username', '')
        await _notify_mentions(
            sorted(added), user_id, username, task,
            branch_id, task_id, comment_id, db,
        )

    row = await comment_model.find_by_id(comment_id, db)
    hydrated = _hydrate(row)
    hydrated['mentioned_user_ids'] = sorted(new_mentions)
    return {'status': True, 'comment': hydrated}


async def delete_comment(branch_id: int, task_id: int, comment_id: int,
                          request: Request, db: AsyncSession):
    """댓글 soft delete (본인만). 멱등."""
    user_id, err = await _check_member(branch_id, request, db)
    if err:
        return err
    _, err = await _check_task(task_id, branch_id, db)
    if err:
        return err
    comment, err = await _check_author(comment_id, task_id, user_id, db)
    if err:
        return err
    if comment.get('deleted_at') is not None:
        return {'status': True}  # 이미 삭제된 상태 — 멱등 응답

    await comment_model.soft_delete(comment_id, db)
    return {'status': True}
