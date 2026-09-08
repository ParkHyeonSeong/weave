from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from core.errors import error_response, ErrorCode
from core.model import task_issue as issue_model
from core.model import branch_member as member_model
from core.model import task as task_model
from library import notification_service
from library.html_markdown import ensure_html, html_to_markdown
from library.mention_parser import extract_mention_user_ids


async def _check_member(branch_id: int, request: Request, db: AsyncSession):
    """Branch 멤버 확인"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return None, error_response(ErrorCode.NOT_BRANCH_MEMBER)
    return user_id, None


async def _check_task(task_id: int, branch_id: int, db: AsyncSession):
    """Task 존재 및 소속 확인"""
    task = await task_model.find_by_id(task_id, db)
    if not task or task['branch_id'] != branch_id:
        return error_response(ErrorCode.TASK_NOT_FOUND)
    return None


async def _notify_issue_mentions(content, branch_id, task_id, issue_id, actor_id,
                                 message_key, db, **params):
    """이슈 본문/댓글 @멘션 알림 — 브랜치 멤버만 (비멤버 딥링크 누수 차단).

    문구는 수신자 언어로 notification_service가 만든다 — message_key + params만 넘긴다.
    """
    if not content:
        return
    mentioned = extract_mention_user_ids(content)
    if not mentioned:
        return
    members = await member_model.filter_users_in_branch(branch_id, mentioned, db)
    if not members:
        return
    link = f'/branch/{branch_id}/task/{task_id}/issue/{issue_id}'
    await notification_service.notify_bulk(
        members, 'mention', actor_id, message_key, link, 'issue', issue_id, db, **params,
    )


# -- 이슈 CRUD --

async def create_issue(body, branch_id: int, task_id: int, request: Request, db: AsyncSession):
    """이슈 생성"""
    user_id, err = await _check_member(branch_id, request, db)
    if err:
        return err

    task_err = await _check_task(task_id, branch_id, db)
    if task_err:
        return task_err

    if body.body:
        body.body = ensure_html(body.body)

    issue_id = await issue_model.create_issue(task_id, body.title, body.body, user_id, db)

    # 태스크 담당자에게 이슈 생성 알림
    task = await task_model.find_by_id(task_id, db)
    if task:
        assignee_ids = [a['user_id'] for a in (task.get('assignees') or [])]
        if assignee_ids:
            display_id = task.get('display_id', '')
            username = request.state.payload.get('username', '')
            link = f'/branch/{branch_id}/task/{task_id}/issue/{issue_id}'
            await notification_service.notify_bulk(
                assignee_ids, 'issue_created', user_id,
                'issueCreated', link, 'issue', issue_id, db,
                actor=username, displayId=display_id, issue=body.title,
            )

    # 이슈 body 멘션 알림 — 멤버만
    username = request.state.payload.get('username', '')
    await _notify_issue_mentions(
        body.body, branch_id, task_id, issue_id, user_id,
        'issueMention', db, actor=username, issue=body.title,
    )

    return {'status': True, 'issue_id': issue_id}


async def list_issues(branch_id: int, task_id: int, request: Request, db: AsyncSession):
    """이슈 목록"""
    _, err = await _check_member(branch_id, request, db)
    if err:
        return err

    task_err = await _check_task(task_id, branch_id, db)
    if task_err:
        return task_err

    issues = await issue_model.find_by_task(task_id, db)
    return {'status': True, 'issues': issues}


def _build_timeline(comments, events):
    """댓글+이벤트를 결정적으로 병합 정렬. created_at 동률 시 comment(0) < event(1), 그다음 id."""
    items = []
    for c in comments:
        items.append((c['created_at'], 0, c['comment_id'], {'kind': 'comment', **c}))
    for e in events:
        items.append((e['created_at'], 1, e['event_id'], {'kind': 'event', **e}))
    items.sort(key=lambda x: (x[0], x[1], x[2]))
    return [it[3] for it in items]


async def get_issue(branch_id: int, task_id: int, issue_id: int, request: Request, db: AsyncSession,
                    fmt: str = 'html'):
    """이슈 상세 + 댓글"""
    _, err = await _check_member(branch_id, request, db)
    if err:
        return err

    task_err = await _check_task(task_id, branch_id, db)
    if task_err:
        return task_err

    issue = await issue_model.find_by_id(issue_id, db)
    if not issue or issue['task_id'] != task_id:
        return error_response(ErrorCode.ISSUE_NOT_FOUND)

    comments = await issue_model.find_comments(issue_id, db)

    if fmt == 'markdown':
        if issue.get('body'):
            issue['body'] = html_to_markdown(issue['body'])
        for c in comments:
            if c.get('content'):
                c['content'] = html_to_markdown(c['content'])

    events = await issue_model.find_events(issue_id, db)
    timeline = _build_timeline(comments, events)
    return {'status': True, 'issue': issue, 'comments': comments, 'timeline': timeline}


async def update_issue(body, branch_id: int, task_id: int, issue_id: int, request: Request, db: AsyncSession):
    """이슈 수정 (title/body는 작성자만, status는 모든 멤버)"""
    user_id, err = await _check_member(branch_id, request, db)
    if err:
        return err

    task_err = await _check_task(task_id, branch_id, db)
    if task_err:
        return task_err

    issue = await issue_model.find_by_id(issue_id, db)
    if not issue or issue['task_id'] != task_id:
        return error_response(ErrorCode.ISSUE_NOT_FOUND)

    fields = body.model_dump(exclude_unset=True)
    target_status = fields.pop('status', None)          # status는 분리 — 모델 update로 절대 안 씀

    if fields.get('body'):
        fields['body'] = ensure_html(fields['body'])

    username = request.state.payload.get('username', '')
    effective_title = fields.get('title', issue['title'])   # title도 같이 바뀌면 새 제목(멘션·전환 알림 공용)

    # title/body 변경은 작성자만
    if fields:
        if issue['created_by'] != user_id:
            return error_response(ErrorCode.NOT_ISSUE_AUTHOR)
        await issue_model.update_issue(issue_id, fields, db)

    # body 멘션 알림 (새로 추가된 멘션만, 멤버 필터) — 제목은 effective_title(새 제목)
    if 'body' in fields and fields['body']:
        old_mentions = set(extract_mention_user_ids(issue.get('body') or ''))
        new_mentions = set(extract_mention_user_ids(fields['body']))
        added = list(new_mentions - old_mentions)
        if added:
            added_members = await member_model.filter_users_in_branch(branch_id, added, db)
            if added_members:
                link = f'/branch/{branch_id}/task/{task_id}/issue/{issue_id}'
                await notification_service.notify_bulk(
                    added_members, 'mention', user_id,
                    'issueMention', link, 'issue', issue_id, db,
                    actor=username, issue=effective_title,
                )

    # status는 전환 헬퍼 단일 경로 (이벤트·folded 알림 발생)
    if target_status is not None:
        await _apply_status_transition(
            issue, target_status, None, effective_title,
            branch_id, task_id, issue_id, user_id, username, db,
        )

    return {'status': True}


async def _notify_transition(issue, target_status, status_changed, comment, branch_id,
                             task_id, issue_id, user_id, username, db, effective_title=None):
    """전환 알림: folded(닫힘/재오픈 1개) + 멘션(멤버만). 5절 표 규칙."""
    title = effective_title if effective_title is not None else issue.get('title', '')
    link = f'/branch/{branch_id}/task/{task_id}/issue/{issue_id}'

    recipients = {issue['created_by']}
    recipients.update(await issue_model.find_commenter_ids(issue_id, db))
    recipients.discard(user_id)

    if status_changed:
        if target_status == 'closed':
            ntype = 'issue_closed'
            key = 'issueClosedWithComment' if comment is not None else 'issueClosed'
        else:
            ntype = 'issue_reopened'
            key = 'issueReopenedWithComment' if comment is not None else 'issueReopened'
        if recipients:
            await notification_service.notify_bulk(
                list(recipients), ntype, user_id, key, link, 'issue', issue_id, db,
                actor=username, issue=title,
            )
    elif comment is not None and recipients:
        # 상태 변화 없음 + 댓글 → 일반 댓글 알림
        await notification_service.notify_bulk(
            list(recipients), 'issue_comment', user_id, 'issueComment',
            link, 'issue', issue_id, db, actor=username, issue=title,
        )

    # 멘션은 status와 무관하게 항상 (멤버 필터)
    if comment is not None:
        await _notify_issue_mentions(
            comment, branch_id, task_id, issue_id, user_id,
            'issueCommentMention', db, actor=username, issue=title,
        )


async def _apply_status_transition(issue, target_status, comment, effective_title,
                                   branch_id, task_id, issue_id, user_id, username, db):
    """(검증 끝난) 이슈에 대해: (댓글) → 조건부 status → 이벤트 → 알림. close/reopen·update_issue 공용."""
    if comment is not None:
        comment = ensure_html(comment)

    comment_id = None
    if comment is not None:
        comment_id = await issue_model.create_comment(issue_id, user_id, comment, db)

    status_changed = await issue_model.transition_status(issue_id, target_status, db)
    if status_changed:
        event_type = 'closed' if target_status == 'closed' else 'reopened'
        await issue_model.create_event(issue_id, user_id, event_type, db)

    await _notify_transition(issue, target_status, status_changed, comment, branch_id,
                             task_id, issue_id, user_id, username, db, effective_title)
    return {'status': True, 'comment_id': comment_id, 'status_changed': status_changed}


async def _transition_issue(target_status, comment, branch_id, task_id, issue_id, request, db):
    """close/reopen 라우트 진입점: 검증 → _apply_status_transition."""
    user_id, err = await _check_member(branch_id, request, db)
    if err:
        return err
    task_err = await _check_task(task_id, branch_id, db)
    if task_err:
        return task_err
    issue = await issue_model.find_by_id(issue_id, db)
    if not issue or issue['task_id'] != task_id:
        return error_response(ErrorCode.ISSUE_NOT_FOUND)
    username = request.state.payload.get('username', '')
    return await _apply_status_transition(
        issue, target_status, comment, None,
        branch_id, task_id, issue_id, user_id, username, db,
    )


async def close_issue(body, branch_id: int, task_id: int, issue_id: int, request: Request, db: AsyncSession):
    """이슈 닫기 (+선택 댓글)"""
    return await _transition_issue('closed', body.comment, branch_id, task_id, issue_id, request, db)


async def reopen_issue(body, branch_id: int, task_id: int, issue_id: int, request: Request, db: AsyncSession):
    """이슈 다시 열기 (+선택 댓글)"""
    return await _transition_issue('open', body.comment, branch_id, task_id, issue_id, request, db)


async def delete_issue(branch_id: int, task_id: int, issue_id: int, request: Request, db: AsyncSession):
    """이슈 삭제 (작성자만)"""
    user_id, err = await _check_member(branch_id, request, db)
    if err:
        return err

    task_err = await _check_task(task_id, branch_id, db)
    if task_err:
        return task_err

    issue = await issue_model.find_by_id(issue_id, db)
    if not issue or issue['task_id'] != task_id:
        return error_response(ErrorCode.ISSUE_NOT_FOUND)

    if issue['created_by'] != user_id:
        return error_response(ErrorCode.NOT_ISSUE_AUTHOR)

    await issue_model.delete_issue(issue_id, db)
    return {'status': True}


# -- 댓글 CRUD --

async def create_comment(body, branch_id: int, task_id: int, issue_id: int, request: Request, db: AsyncSession):
    """댓글 추가"""
    user_id, err = await _check_member(branch_id, request, db)
    if err:
        return err

    task_err = await _check_task(task_id, branch_id, db)
    if task_err:
        return task_err

    issue = await issue_model.find_by_id(issue_id, db)
    if not issue or issue['task_id'] != task_id:
        return error_response(ErrorCode.ISSUE_NOT_FOUND)

    body.content = ensure_html(body.content)

    comment_id = await issue_model.create_comment(issue_id, user_id, body.content, db)

    # 이슈 작성자 + 기존 코멘터에게 알림 (중복 제거, 본인 제외)
    recipients = set()
    recipients.add(issue['created_by'])
    commenter_ids = await issue_model.find_commenter_ids(issue_id, db)
    recipients.update(commenter_ids)
    recipients.discard(user_id)

    if recipients:
        username = request.state.payload.get('username', '')
        issue_title = issue.get('title', '')
        link = f'/branch/{branch_id}/task/{task_id}/issue/{issue_id}'
        await notification_service.notify_bulk(
            list(recipients), 'issue_comment', user_id,
            'issueComment', link, 'issue', issue_id, db,
            actor=username, issue=issue_title,
        )

    # 댓글 content 멘션 알림 (issue_comment 알림과 별도로) — 멤버만
    username = request.state.payload.get('username', '')
    issue_title = issue.get('title', '')
    await _notify_issue_mentions(
        body.content, branch_id, task_id, issue_id, user_id,
        'issueCommentMention', db, actor=username, issue=issue_title,
    )

    return {'status': True, 'comment_id': comment_id}


async def update_comment(body, branch_id: int, task_id: int, issue_id: int, comment_id: int,
                         request: Request, db: AsyncSession):
    """댓글 수정 (작성자만)"""
    user_id, err = await _check_member(branch_id, request, db)
    if err:
        return err

    task_err = await _check_task(task_id, branch_id, db)
    if task_err:
        return task_err

    comment = await issue_model.find_comment_by_id(comment_id, db)
    if not comment or comment['issue_id'] != issue_id:
        return error_response(ErrorCode.COMMENT_NOT_FOUND)

    if comment['author_id'] != user_id:
        return error_response(ErrorCode.NOT_COMMENT_AUTHOR)

    body.content = ensure_html(body.content)

    await issue_model.update_comment(comment_id, body.content, db)
    return {'status': True}


async def delete_comment(branch_id: int, task_id: int, issue_id: int, comment_id: int,
                         request: Request, db: AsyncSession):
    """댓글 삭제 (작성자만)"""
    user_id, err = await _check_member(branch_id, request, db)
    if err:
        return err

    task_err = await _check_task(task_id, branch_id, db)
    if task_err:
        return task_err

    comment = await issue_model.find_comment_by_id(comment_id, db)
    if not comment or comment['issue_id'] != issue_id:
        return error_response(ErrorCode.COMMENT_NOT_FOUND)

    if comment['author_id'] != user_id:
        return error_response(ErrorCode.NOT_COMMENT_AUTHOR)

    await issue_model.delete_comment(comment_id, db)
    return {'status': True}
