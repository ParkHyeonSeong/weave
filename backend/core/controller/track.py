import os
import uuid

from fastapi import Request, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from core.errors import error_response, ErrorCode
from core.model import track as track_model
from core.model import track_member as member_model
from core.model import track_branch as track_branch_model
from core.model import track_item as track_item_model
from core.model import track_link as track_link_model
from core.model import track_scope as track_scope_model
from library.user_directory import strip_email
from core.model import branch_member as branch_member_model
from core.model import branch as branch_model
from core.model import task as task_model
from core.model import task_dependency as dep_model
from library.file_validator import validate_image_magic_bytes
from library.icon_storage import delete_image_icon_file
from library.time_context import personal_today
from library.svg_sanitizer import sanitize_svg

ICON_UPLOAD_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
    'uploads', 'track-icons'
)
ICON_ALLOWED_EXT = {'.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'}
ICON_MAX_SIZE = 2 * 1024 * 1024  # 2MB


# =========================================================================
# Helpers
# =========================================================================

async def _require_role(track_id: int, request: Request, required: str,
                         db: AsyncSession):
    """Track 존재 + 사용자 role 검증.
    OK이면 None, 아니면 error dict 반환 (caller는 그대로 return).
    required: 'viewer' | 'editor' | 'owner'
    """
    if not await track_model.find_by_id(track_id, db):
        return error_response(ErrorCode.TRACK_NOT_FOUND)
    user_id = request.state.payload.get('user_id')
    role = await member_model.get_role(track_id, user_id, db)
    if not member_model.has_at_least(role, required):
        return error_response(ErrorCode.PERMISSION_DENIED)
    return None


# =========================================================================
# Track CRUD
# =========================================================================

async def create(body, request: Request, db: AsyncSession):
    """Track 생성 + 생성자를 owner로 + participating branches 동시 설정"""
    user_id = request.state.payload.get('user_id')

    track_id = await track_model.create(
        track_name=body.track_name,
        description=body.description or '',
        color=body.color or '#5E6AD2',
        icon=body.icon,
        visibility=body.visibility or 'private',
        default_view=body.default_view or 'flow',
        created_by=user_id,
        db=db,
    )

    # 생성자 owner 자동 추가
    await member_model.add(track_id, user_id, 'owner', db)

    # 참여 branch 설정 — 사용자가 멤버인 branch만 허용 (배치 검증)
    requested_ids = body.participating_branch_ids or []
    if requested_ids:
        allowed_ids = await branch_member_model.filter_member_branch_ids(
            user_id, requested_ids, db)
        for branch_id in allowed_ids:
            await track_branch_model.add(track_id, branch_id, db)

    return {'status': True, 'track_id': track_id}


async def get_list(request: Request, db: AsyncSession):
    """내가 멤버인 Track 목록"""
    user_id = request.state.payload.get('user_id')
    tracks = await track_model.find_accessible(user_id, db)
    return {'status': True, 'tracks': tracks}


async def get_home_stats(request: Request, db: AsyncSession):
    """홈 KPI 집계 (접근 가능한 모든 Track 기준)

    Branch 홈과 같은 정책 — '이번 주 마감'은 개인 timezone의 오늘 기준이다.
    """
    user_id = request.state.payload.get('user_id')
    today = await personal_today(user_id, db)
    stats = await track_model.home_stats(user_id, today, db)
    return {'status': True, **stats}


async def get_detail(track_id: int, request: Request, db: AsyncSession):
    """Track 상세 + 내 role + 참여 branches"""
    track = await track_model.find_by_id(track_id, db)
    if not track:
        return error_response(ErrorCode.TRACK_NOT_FOUND)

    user_id = request.state.payload.get('user_id')
    my_role = await member_model.get_role(track_id, user_id, db)

    # private: 멤버만 / public: 누구나 조회 가능
    if track['visibility'] == 'private' and not my_role:
        return error_response(ErrorCode.ACCESS_DENIED)

    track['my_role'] = my_role
    track['participating_branches'] = await track_branch_model.find_by_track(track_id, db)
    return {'status': True, 'track': track}


async def update(track_id: int, body, request: Request, db: AsyncSession):
    """Track 정보 수정 — editor 이상"""
    err = await _require_role(track_id, request, 'editor', db)
    if err:
        return err
    fields = body.model_dump(exclude_unset=True)
    if not fields:
        return {'status': True}

    # icon이 image:에서 떠나면 디스크 정리
    if 'icon' in fields:
        current = await track_model.find_by_id(track_id, db)
        if current:
            old_icon = current.get('icon') or ''
            if old_icon != (fields.get('icon') or ''):
                delete_image_icon_file(old_icon, ICON_UPLOAD_DIR)

    await track_model.update(track_id, fields, db)
    return {'status': True}


async def upload_icon(track_id: int, file: UploadFile, request: Request, db: AsyncSession):
    """Track 아이콘 이미지 업로드 — editor 이상. icon 컬럼에 'image:...' 저장."""
    err = await _require_role(track_id, request, 'editor', db)
    if err:
        return err

    track = await track_model.find_by_id(track_id, db)
    if not track:
        return error_response(ErrorCode.TRACK_NOT_FOUND)

    if not file or not file.filename:
        return error_response(ErrorCode.NO_FILE)
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ICON_ALLOWED_EXT:
        return error_response(ErrorCode.INVALID_FILE_TYPE)
    content = await file.read()
    if len(content) > ICON_MAX_SIZE:
        return error_response(ErrorCode.FILE_TOO_LARGE)
    if not validate_image_magic_bytes(content, ext):
        return error_response(ErrorCode.INVALID_FILE_CONTENT)

    if ext == '.svg':
        sanitized = sanitize_svg(content)
        if sanitized is None:
            return error_response(ErrorCode.INVALID_FILE_CONTENT)
        content = sanitized

    os.makedirs(ICON_UPLOAD_DIR, exist_ok=True)
    delete_image_icon_file(track.get('icon'), ICON_UPLOAD_DIR)

    filename = f"{track_id}_{uuid.uuid4().hex[:8]}{ext}"
    filepath = os.path.join(ICON_UPLOAD_DIR, filename)
    with open(filepath, 'wb') as f:
        f.write(content)

    icon_value = f"image:/api/uploads/track-icons/{filename}"
    await track_model.update(track_id, {'icon': icon_value}, db)
    return {'status': True, 'icon': icon_value}


async def delete(track_id: int, request: Request, db: AsyncSession):
    """Track 아카이브 (soft delete) — owner만. 영구삭제는 permanent_delete."""
    err = await _require_role(track_id, request, 'owner', db)
    if err:
        return err
    await track_model.archive(track_id, db)
    return {'status': True}


async def list_archived(request: Request, db: AsyncSession):
    """아카이브된 Track 목록 (owner인 것만, 보관함용)."""
    user_id = request.state.payload.get('user_id')
    tracks = await track_model.find_archived(user_id, db)
    return {'status': True, 'tracks': tracks}


async def restore(track_id: int, request: Request, db: AsyncSession):
    """Track 복원 — owner만. 아카이브된 track은 find_by_id로 못 찾으므로 role 직접 확인."""
    user_id = request.state.payload.get('user_id')
    role = await member_model.get_role(track_id, user_id, db)
    if not member_model.has_at_least(role, 'owner'):
        return error_response(ErrorCode.PERMISSION_DENIED)
    await track_model.restore(track_id, db)
    return {'status': True}


async def permanent_delete(track_id: int, request: Request, db: AsyncSession):
    """Track 영구삭제 — owner만. materialized task_dependency 청소 후 삭제(track_* CASCADE)."""
    user_id = request.state.payload.get('user_id')
    role = await member_model.get_role(track_id, user_id, db)
    if not member_model.has_at_least(role, 'owner'):
        return error_response(ErrorCode.PERMISSION_DENIED)
    dep_ids = await track_model.find_materialized_dep_ids(track_id, db)
    await dep_model.delete_by_ids(dep_ids, db)
    await track_model.delete(track_id, db)
    return {'status': True}


# =========================================================================
# Members
# =========================================================================

async def get_members(track_id: int, request: Request, db: AsyncSession):
    """Track 멤버 목록 — 본인 멤버이거나 public Track. 이메일은 멤버에게만 노출(SEC-21 동류)."""
    track = await track_model.find_by_id(track_id, db)
    if not track:
        return error_response(ErrorCode.TRACK_NOT_FOUND)

    user_id = request.state.payload.get('user_id')
    is_member = await member_model.is_member(track_id, user_id, db)
    if track['visibility'] == 'private' and not is_member:
        return error_response(ErrorCode.ACCESS_DENIED)

    members = await member_model.find_by_track(track_id, db)
    if not is_member:
        members = strip_email(members)  # 비멤버(공개 track 조회자)에겐 이메일 비노출
    return {'status': True, 'members': members}


async def add_member(track_id: int, body, request: Request, db: AsyncSession):
    """멤버 초대 — owner만 (role은 pydantic schema에서 이미 validated)"""
    err = await _require_role(track_id, request, 'owner', db)
    if err:
        return err
    await member_model.add(track_id, body.user_id, body.role, db)
    return {'status': True}


async def update_member_role(track_id: int, target_user_id: int, body,
                              request: Request, db: AsyncSession):
    """멤버 role 변경 — owner만 + 마지막 owner 강등 방지"""
    err = await _require_role(track_id, request, 'owner', db)
    if err:
        return err

    target_role = await member_model.get_role(track_id, target_user_id, db)
    if not target_role:
        return error_response(ErrorCode.MEMBER_NOT_FOUND)

    new_role = body.role  # schema에서 validated
    if target_role == 'owner' and new_role != 'owner':
        owner_count = await member_model.count_owners(track_id, db)
        if owner_count <= 1:
            return error_response(ErrorCode.LAST_OWNER)

    await member_model.update_role(track_id, target_user_id, new_role, db)
    return {'status': True}


async def search_invite_candidates(track_id: int, query: str, request: Request,
                                    db: AsyncSession):
    """초대 가능한 사용자 검색 — owner만"""
    err = await _require_role(track_id, request, 'owner', db)
    if err:
        return err
    users = await member_model.search_non_members(track_id, query, db)
    return {'status': True, 'users': users}


async def leave(track_id: int, request: Request, db: AsyncSession):
    """트랙 나가기 (본인)"""
    user_id = request.state.payload.get('user_id')
    role = await member_model.get_role(track_id, user_id, db)
    if not role:
        return error_response(ErrorCode.NOT_TRACK_MEMBER)
    # 마지막 owner면 나갈 수 없음 (소유자 없는 트랙 방지)
    if role == 'owner' and await member_model.count_owners(track_id, db) <= 1:
        return error_response(ErrorCode.CANNOT_LEAVE_LAST_OWNER)
    await member_model.remove(track_id, user_id, db)
    return {'status': True}


async def remove_member(track_id: int, target_user_id: int, request: Request,
                        db: AsyncSession):
    """멤버 제거 — owner이거나 본인(leave)"""
    if not await track_model.find_by_id(track_id, db):
        return error_response(ErrorCode.TRACK_NOT_FOUND)

    user_id = request.state.payload.get('user_id')
    is_self = (target_user_id == user_id)
    if not is_self:
        role = await member_model.get_role(track_id, user_id, db)
        if role != 'owner':
            return error_response(ErrorCode.PERMISSION_DENIED)

    target_role = await member_model.get_role(track_id, target_user_id, db)
    if not target_role:
        return {'status': True}  # idempotent

    if target_role == 'owner':
        owner_count = await member_model.count_owners(track_id, db)
        if owner_count <= 1:
            return error_response(ErrorCode.LAST_OWNER)

    await member_model.remove(track_id, target_user_id, db)
    return {'status': True}


# =========================================================================
# Participating branches
# =========================================================================

async def get_branches(track_id: int, request: Request, db: AsyncSession):
    """Track의 참여 branch 목록 — 멤버만"""
    user_id = request.state.payload.get('user_id')
    if not await _can_view(track_id, user_id, db):
        return error_response(ErrorCode.ACCESS_DENIED)
    branches = await track_branch_model.find_by_track(track_id, db)
    return {'status': True, 'branches': branches}


async def add_branch(track_id: int, body, request: Request, db: AsyncSession):
    """참여 branch 추가 — editor 이상 + 본인이 그 branch 멤버여야 함"""
    err = await _require_role(track_id, request, 'editor', db)
    if err:
        return err

    user_id = request.state.payload.get('user_id')
    if not await branch_member_model.is_member(body.branch_id, user_id, db):
        return error_response(ErrorCode.NOT_BRANCH_MEMBER)
    if not await branch_model.find_by_id(body.branch_id, db):
        return error_response(ErrorCode.BRANCH_NOT_FOUND)

    await track_branch_model.add(track_id, body.branch_id, db)
    return {'status': True}


async def remove_branch(track_id: int, branch_id: int, request: Request,
                        db: AsyncSession):
    """참여 branch 제거 — editor 이상.
    이 branch에서 온 모든 track_item 및 그에 묶인 materialized task_dependency도 함께 정리.
    track_link는 track_item FK CASCADE로 자동 삭제.
    """
    err = await _require_role(track_id, request, 'editor', db)
    if err:
        return err

    # 정리할 dependency id 먼저 수집 — item 삭제 후엔 link도 사라져 조회 못함
    dep_ids = await track_item_model.find_materialized_dep_ids_for_branch(
        track_id, branch_id, db)
    await track_item_model.delete_by_track_branch(track_id, branch_id, db)
    await dep_model.delete_by_ids(dep_ids, db)
    await track_scope_model.delete_by_branch(track_id, branch_id, db)
    await track_branch_model.remove(track_id, branch_id, db)
    return {'status': True}


async def update_branch_override(track_id: int, branch_id: int, body,
                                  request: Request, db: AsyncSession):
    """Track-local branch override (display_name, color) — editor 이상"""
    err = await _require_role(track_id, request, 'editor', db)
    if err:
        return err
    fields = body.model_dump(exclude_unset=True)
    if not fields:
        return {'status': True}
    await track_branch_model.update_override(track_id, branch_id, fields, db)
    return {'status': True}


# =========================================================================
# Helpers
# =========================================================================

async def _can_view(track_id: int, user_id: int, db: AsyncSession) -> bool:
    """Track 조회 권한 — 멤버이거나 public Track"""
    track = await track_model.find_by_id(track_id, db)
    if not track:
        return False
    if track['visibility'] == 'public':
        return True
    return await member_model.is_member(track_id, user_id, db)


# =========================================================================
# Items (Track 내 task 참조)
# =========================================================================

async def get_items(track_id: int, request: Request, db: AsyncSession):
    """Track의 모든 item — viewer 이상 (private은 멤버만, public은 모두)"""
    user_id = request.state.payload.get('user_id')
    if not await _can_view(track_id, user_id, db):
        return error_response(ErrorCode.ACCESS_DENIED)
    items = await track_item_model.find_by_track(track_id, user_id, db)
    return {'status': True, 'items': items}


async def add_items_bulk(track_id: int, body, request: Request, db: AsyncSession):
    """N개의 task를 한 번에 Track에 추가 — editor 이상.
    각 task의 branch 멤버 검증 + 중복 무시 + branch participating 자동 합류.
    body.scope_mode가 'sprint'/'epic'이면 명시적 scope marker 추가,
    'filter' 또는 미지정이면 task의 sprint_id를 모아 자동 sprint scope 등록 (백로그 task는 skip)."""
    err = await _require_role(track_id, request, 'editor', db)
    if err:
        return err

    user_id = request.state.payload.get('user_id')
    results = []
    added_count = 0
    already_count = 0
    accepted_task_ids = []

    for task_id in body.source_task_ids:
        task = await task_model.find_by_id(task_id, db)
        if not task:
            results.append({'task_id': task_id, 'status': 'skipped', 'reason': 'NOT_FOUND'})
            continue
        if not await branch_member_model.is_member(task['branch_id'], user_id, db):
            results.append({'task_id': task_id, 'status': 'skipped', 'reason': 'NOT_BRANCH_MEMBER'})
            continue
        if not await track_branch_model.is_participating(track_id, task['branch_id'], db):
            await track_branch_model.add(track_id, task['branch_id'], db)
        item_id, created = await track_item_model.create_task_ref_idempotent(
            track_id, task_id, db)
        if created:
            results.append({'task_id': task_id, 'status': 'added', 'item_id': item_id})
            added_count += 1
        else:
            results.append({'task_id': task_id, 'status': 'already_exists', 'item_id': item_id})
            already_count += 1
        accepted_task_ids.append(task_id)

    # Scope marker 등록 — sprint/epic FK에서 canonical branch_id를 직접 조회
    # (accepted_task_ids[0] 사용은 cross-branch bulk add 시 잘못된 branch에 marker가 박힘)
    if body.scope_mode in ('sprint', 'epic') and body.scope_id:
        owner_branch_id = await track_scope_model.resolve_scope_branch(
            body.scope_mode, body.scope_id, db)
        if not owner_branch_id:
            return error_response(ErrorCode.SCOPE_NOT_FOUND)
        # IDOR 방어: scope의 owner branch가 track의 participating branch에 속해야 함
        if not await track_branch_model.is_participating(track_id, owner_branch_id, db):
            return error_response(ErrorCode.SCOPE_BRANCH_NOT_PARTICIPATING)
        # 사용자가 scope branch의 멤버여야 함 (task 멤버 검증과 동일 규칙)
        if not await branch_member_model.is_member(owner_branch_id, user_id, db):
            return error_response(ErrorCode.NOT_SCOPE_BRANCH_MEMBER)
        await track_scope_model.add(
            track_id, owner_branch_id, body.scope_mode, body.scope_id, db)
    else:
        # filter / 그 외 — 각 task의 sprint를 자동 scope로 (backlog는 skip)
        await track_scope_model.add_sprints_for_tasks(track_id, accepted_task_ids, db)

    return {
        'status': True,
        'added': added_count,
        'already_exists': already_count,
        'results': results,
    }


async def add_item(track_id: int, body, request: Request, db: AsyncSession):
    """Task를 Track에 참조로 추가 — editor 이상 + source task의 branch 멤버여야 함.
    Track의 participating에 없는 branch면 자동으로 추가.
    """
    err = await _require_role(track_id, request, 'editor', db)
    if err:
        return err

    user_id = request.state.payload.get('user_id')

    # source task 존재 + 사용자가 그 branch 멤버인지
    task = await task_model.find_by_id(body.source_task_id, db)
    if not task:
        return error_response(ErrorCode.TASK_NOT_FOUND)

    if not await branch_member_model.is_member(task['branch_id'], user_id, db):
        return error_response(ErrorCode.NOT_BRANCH_MEMBER)

    # task의 branch가 Track의 participating에 없으면 자동 추가
    if not await track_branch_model.is_participating(track_id, task['branch_id'], db):
        await track_branch_model.add(track_id, task['branch_id'], db)

    item_id = await track_item_model.create_task_ref(
        track_id, body.source_task_id,
        body.position_x or 0, body.position_y or 0,
        db,
    )

    # bulk add(filter 모드)와 동일 규칙 — 단일 추가도 sprint scope 자동 등록.
    # 하위태스크는 부모의 sprint 사용(부모 우선), 백로그(유효 sprint 없음)는 skip.
    # 트리에서 끌어온 경우는 이미 있는 scope라 idempotent no-op.
    await track_scope_model.add_sprints_for_tasks(
        track_id, [body.source_task_id], db)

    return {'status': True, 'item_id': item_id}


async def update_item_positions(track_id: int, body, request: Request,
                                 db: AsyncSession):
    """Item 위치 bulk 업데이트 (debounced) — editor 이상"""
    err = await _require_role(track_id, request, 'editor', db)
    if err:
        return err
    positions = [p.model_dump() for p in body.positions]
    await track_item_model.update_positions(track_id, positions, db)
    return {'status': True}


async def delete_item(track_id: int, item_id: int, request: Request,
                      db: AsyncSession):
    """Item 삭제 — editor 이상"""
    err = await _require_role(track_id, request, 'editor', db)
    if err:
        return err
    await track_item_model.delete(item_id, track_id, db)
    return {'status': True}


# =========================================================================
# Sources (SourcePicker용 검색)
# =========================================================================

async def search_sources(track_id: int, request: Request, db: AsyncSession):
    """Track의 participating branches에서 task 검색 — viewer 이상.
    응답에는 사용자가 멤버인 branch의 task만 포함.
    """
    user_id = request.state.payload.get('user_id')
    if not await _can_view(track_id, user_id, db):
        return error_response(ErrorCode.ACCESS_DENIED)

    qp = request.query_params
    q = qp.get('q', '')

    def _int_or_none(key):
        raw = qp.get(key)
        return int(raw) if raw and raw.lstrip('-').isdigit() else None

    def _bool(key):
        return qp.get(key) == 'true'

    branch_id = _int_or_none('branch_id')
    epic_id = _int_or_none('epic_id')
    sprint_id = _int_or_none('sprint_id')
    assignee_user_id = _int_or_none('assignee_user_id')
    label_id = _int_or_none('label_id')
    status = qp.get('status') or None
    status_category = qp.get('status_category') or None
    priority = qp.get('priority') or None
    include_non_participating = _bool('include_non_participating')
    parent_only = _bool('parent_only')
    exclude_done = _bool('exclude_done')

    raw_limit = qp.get('limit', '50')
    limit = int(raw_limit) if raw_limit.isdigit() else 50
    limit = max(1, min(limit, 200))

    tasks = await track_item_model.search_sources(
        track_id, user_id, q, branch_id, limit, db,
        status=status,
        status_category=status_category,
        priority=priority,
        assignee_user_id=assignee_user_id,
        label_id=label_id,
        include_non_participating=include_non_participating,
        epic_id=epic_id,
        sprint_id=sprint_id,
        parent_only=parent_only,
        exclude_done=exclude_done,
    )
    return {'status': True, 'tasks': tasks}


async def sidebar_tree(track_id: int, request: Request, db: AsyncSession):
    """Sidebar tree — branch → sprint/epic scope → tasks. viewer 이상."""
    user_id = request.state.payload.get('user_id')
    if not await _can_view(track_id, user_id, db):
        return error_response(ErrorCode.ACCESS_DENIED)
    tree = await track_scope_model.find_tree(track_id, user_id, db)
    return {'status': True, 'tree': tree}


# =========================================================================
# Links (Track 내 edge — flow_to / relates_to, 선택적으로 materialize)
# =========================================================================

async def get_links(track_id: int, request: Request, db: AsyncSession):
    """Track의 모든 link — viewer 이상"""
    user_id = request.state.payload.get('user_id')
    if not await _can_view(track_id, user_id, db):
        return error_response(ErrorCode.ACCESS_DENIED)
    links = await track_link_model.find_by_track(track_id, db)
    return {'status': True, 'links': links}


async def _try_materialize_flow_dep(items_info: dict, user_id: int, db: AsyncSession):
    """flow_to link에 대해 task_dependency를 만들 수 있으면 만들고 (dep_id, None) 반환.
    조건 미달이면 (None, skip_reason) 반환. caller는 skip_reason을 사용자 안내에 사용.
    """
    s_task = items_info.get('s_task')
    t_task = items_info.get('t_task')
    if not (s_task and t_task):
        return None, 'NOT_TASK_REF'

    s_branch = items_info.get('s_branch')
    t_branch = items_info.get('t_branch')
    accessible = await branch_member_model.filter_member_branch_ids(
        user_id, {s_branch, t_branch}, db)
    if s_branch not in accessible or t_branch not in accessible:
        return None, 'BRANCH_PERMISSION'

    # cross-branch면 branch_id=NULL, 동일 branch면 해당 branch_id로 scope.
    dep_branch_id = s_branch if s_branch == t_branch else None
    if await dep_model.check_circular(s_task, t_task, dep_branch_id, db):
        return None, 'CIRCULAR'

    dep_id = await dep_model.create(
        dep_branch_id, s_task, t_task, 'finish_to_start', user_id, db)
    return dep_id, None


async def add_link(track_id: int, body, request: Request, db: AsyncSession):
    """edge 생성 — editor 이상.
    body.materialize=True 이고 link_type='flow_to' 면 원본 task_dependency도 함께 생성.
    cross-branch dep 허용(045 migration). 순환 발생 시 link 자체는 만들되 dep는 skip."""
    err = await _require_role(track_id, request, 'editor', db)
    if err:
        return err

    if body.source_item_id == body.target_item_id:
        return error_response(ErrorCode.SELF_LINK)

    user_id = request.state.payload.get('user_id')
    items_info = await track_link_model.find_source_target_tasks(
        body.source_item_id, body.target_item_id, track_id, db)
    if not items_info:
        return error_response(ErrorCode.ITEM_NOT_FOUND)

    # link 먼저 만들기 — 충돌이면 materialize 시도 자체를 skip해서 wasted INSERT 방지
    link_id, created = await track_link_model.create(
        track_id, body.source_item_id, body.target_item_id,
        body.link_type, user_id, db,
    )

    materialized_dep_id = None
    skip_reason = None
    if created and body.materialize and body.link_type == 'flow_to':
        materialized_dep_id, skip_reason = await _try_materialize_flow_dep(
            items_info, user_id, db)
        if materialized_dep_id is not None:
            await track_link_model.set_materialized_dep(link_id, materialized_dep_id, db)

    return {
        'status': True,
        'link_id': link_id,
        'created': created,
        'materialized': materialized_dep_id is not None,
        'skip_reason': skip_reason,
    }


async def delete_link(track_id: int, link_id: int, request: Request,
                      db: AsyncSession):
    """edge 삭제 — editor 이상. materialize된 dep도 함께 정리."""
    err = await _require_role(track_id, request, 'editor', db)
    if err:
        return err

    link = await track_link_model.find_by_id(link_id, db)
    if not link or link['track_id'] != track_id:
        return {'status': True}  # idempotent
    dep_id = link.get('materialized_dependency_id')
    await track_link_model.delete(link_id, track_id, db)
    if dep_id:
        await dep_model.delete_by_id(dep_id, db)
    return {'status': True}
