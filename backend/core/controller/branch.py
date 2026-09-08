import os
import uuid

from fastapi import Request, UploadFile
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from core.errors import error_response, ErrorCode
from core.model import branch as branch_model
from core.model import branch_member as member_model
from core.model import task_type_config as type_model
from core.model import workflow_status as ws_model
from library.file_validator import validate_image_magic_bytes
from library.user_directory import strip_email
from library.icon_storage import delete_image_icon_file
from library.svg_sanitizer import sanitize_svg
from library.time_context import personal_today

ICON_UPLOAD_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
    'uploads', 'branch-icons'
)
ICON_ALLOWED_EXT = {'.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'}
ICON_MAX_SIZE = 2 * 1024 * 1024  # 2MB


async def create(body, request: Request, db: AsyncSession):
    """Branch 생성"""
    user_id = request.state.payload.get('user_id')

    # key 중복 체크
    if await branch_model.find_by_key(body.key, db):
        return error_response(ErrorCode.KEY_ALREADY_EXISTS)

    branch_id = await branch_model.create(
        branch_name=body.branch_name,
        key=body.key,
        description=body.description or '',
        visibility=body.visibility,
        created_by=user_id,
        db=db,
    )

    # 생성자를 admin으로 자동 추가
    await member_model.add(branch_id, user_id, 'admin', db)

    # task_sequence 초기화
    await db.execute(text("""
        INSERT INTO task_sequence (branch_id, last_number) VALUES (:branch_id, 0)
    """), {'branch_id': branch_id})

    # 기본 task type 시딩
    await type_model.seed_defaults(branch_id, db)

    # 기본 workflow status 시딩
    await ws_model.seed_defaults(branch_id, db)

    return {
        'status': True,
        'branch_id': branch_id,
        'key': body.key,
    }


async def get_list(request: Request, db: AsyncSession):
    """내가 접근 가능한 Branch 목록"""
    user_id = request.state.payload.get('user_id')
    branches = await branch_model.find_accessible(user_id, db)
    return {'status': True, 'branches': branches}


async def get_home_stats(request: Request, db: AsyncSession):
    """홈 KPI 집계 (접근 가능한 모든 Branch 기준)

    '이번 주 마감'은 보는 사람마다 달라지는 개인 파생 상태 → 개인 timezone의 오늘을 쓴다.
    """
    user_id = request.state.payload.get('user_id')
    today = await personal_today(user_id, db)
    stats = await branch_model.home_stats(user_id, today, db)
    return {'status': True, **stats}


# Task 1 시점엔 task 3종만 유효. active_sprint 는 Task 2(모델 분기 추가)에서 set 에 추가한다.
# (먼저 넣으면 모델에 분기가 없어 active_sprint 호출이 KeyError/500 → Task 1 커밋 상태가 깨짐.)
_VALID_BUCKETS = {'open', 'in_progress', 'due_this_week', 'active_sprint'}


async def get_home_stats_items(request: Request, bucket: str, limit: int, db: AsyncSession):
    """홈 KPI 카드 드릴인 — bucket 별 실제 행 목록."""
    if bucket not in _VALID_BUCKETS:
        return error_response(ErrorCode.INVALID_BUCKET)
    user_id = request.state.payload.get('user_id')
    # 카드 숫자와 같은 오늘을 써야 목록과 카운트가 어긋나지 않는다.
    today = await personal_today(user_id, db)
    data = await branch_model.home_stat_items(user_id, bucket, limit, today, db)
    return {'status': True, 'bucket': bucket, **data}


async def get_detail(branch_id: int, request: Request, db: AsyncSession):
    """Branch 상세 (현재 사용자의 role 포함)"""
    branch = await branch_model.find_by_id(branch_id, db)
    if not branch:
        return error_response(ErrorCode.BRANCH_NOT_FOUND)

    user_id = request.state.payload.get('user_id')
    my_role = await member_model.get_role(branch_id, user_id, db)

    # private branch는 멤버만 조회 가능
    if branch['visibility'] == 'private' and not my_role:
        return error_response(ErrorCode.ACCESS_DENIED)

    branch['my_role'] = my_role

    return {'status': True, 'branch': branch}


async def get_members(branch_id: int, request: Request, db: AsyncSession):
    """Branch 멤버 목록 (private branch는 멤버만 조회 가능).

    이메일은 멤버에게만 노출한다(SEC-21). 공개 branch는 비멤버도 목록을 볼 수 있지만,
    그 경우 멤버 이메일은 응답에서 제거한다.
    """
    branch = await branch_model.find_by_id(branch_id, db)
    if not branch:
        return error_response(ErrorCode.BRANCH_NOT_FOUND)

    user_id = request.state.payload.get('user_id')
    is_member = await member_model.is_member(branch_id, user_id, db)
    if branch['visibility'] == 'private' and not is_member:
        return error_response(ErrorCode.ACCESS_DENIED)

    members = await member_model.find_by_branch(branch_id, db)
    if not is_member:
        members = strip_email(members)  # 비멤버(공개 branch 조회자)에겐 이메일 비노출
    return {'status': True, 'members': members}


async def upload_icon(branch_id: int, file: UploadFile, request: Request, db: AsyncSession):
    """Branch 아이콘 이미지 업로드 (admin만). icon 컬럼에 'image:...' 형태로 저장."""
    user_id = request.state.payload.get('user_id')

    branch = await branch_model.find_by_id(branch_id, db)
    if not branch:
        return error_response(ErrorCode.BRANCH_NOT_FOUND)

    role = await member_model.get_role(branch_id, user_id, db)
    if role != 'admin':
        return error_response(ErrorCode.ADMIN_ONLY)

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

    # SVG는 별도 sanitize로 스크립트/이벤트핸들러/외부 참조 제거
    if ext == '.svg':
        sanitized = sanitize_svg(content)
        if sanitized is None:
            return error_response(ErrorCode.INVALID_FILE_CONTENT)
        content = sanitized

    os.makedirs(ICON_UPLOAD_DIR, exist_ok=True)

    # 기존 image: 아이콘이 있으면 디스크에서 삭제
    delete_image_icon_file(branch.get('icon'), ICON_UPLOAD_DIR)

    filename = f"{branch_id}_{uuid.uuid4().hex[:8]}{ext}"
    filepath = os.path.join(ICON_UPLOAD_DIR, filename)
    with open(filepath, 'wb') as f:
        f.write(content)

    icon_value = f"image:/api/uploads/branch-icons/{filename}"
    await branch_model.update(branch_id, {'icon': icon_value}, db)
    return {'status': True, 'icon': icon_value}


async def update(branch_id: int, body, request: Request, db: AsyncSession):
    """Branch 정보 수정 (admin만)"""
    user_id = request.state.payload.get('user_id')
    role = await member_model.get_role(branch_id, user_id, db)
    if role != 'admin':
        return error_response(ErrorCode.ADMIN_ONLY)

    fields = body.model_dump(exclude_unset=True)
    if not fields:
        return {'status': True}

    # key 변경 시 중복 체크 + icon이 image:에서 떠나면 디스크 정리
    needs_current = 'key' in fields or 'icon' in fields
    current = await branch_model.find_by_id(branch_id, db) if needs_current else None

    if 'key' in fields and current and current['key'] != fields['key']:
        if await branch_model.find_by_key(fields['key'], db):
            return error_response(ErrorCode.KEY_ALREADY_EXISTS)

    if 'icon' in fields and current:
        old_icon = current.get('icon') or ''
        if old_icon != (fields.get('icon') or ''):
            delete_image_icon_file(old_icon, ICON_UPLOAD_DIR)

    await branch_model.update(branch_id, fields, db)
    return {'status': True}


async def get_public_list(request: Request, db: AsyncSession):
    """Public branch 목록 (내가 미가입)"""
    user_id = request.state.payload.get('user_id')
    query = request.query_params.get('q', '')
    branches = await branch_model.find_public(user_id, query, db)
    return {'status': True, 'branches': branches}


async def join(branch_id: int, request: Request, db: AsyncSession):
    """Public branch 가입"""
    user_id = request.state.payload.get('user_id')

    branch = await branch_model.find_by_id(branch_id, db)
    if not branch:
        return error_response(ErrorCode.BRANCH_NOT_FOUND)
    if branch['visibility'] != 'public':
        return error_response(ErrorCode.BRANCH_NOT_PUBLIC)

    # 이미 멤버인지 확인
    if await member_model.is_member(branch_id, user_id, db):
        return error_response(ErrorCode.ALREADY_MEMBER)

    await member_model.add(branch_id, user_id, 'member', db)
    return {'status': True}


async def add_member(branch_id: int, body, request: Request, db: AsyncSession):
    """멤버 초대 (admin만)"""
    user_id = request.state.payload.get('user_id')
    role = await member_model.get_role(branch_id, user_id, db)
    if role != 'admin':
        return error_response(ErrorCode.ADMIN_ONLY)

    # 이미 멤버인지 확인
    if await member_model.is_member(branch_id, body.user_id, db):
        return error_response(ErrorCode.ALREADY_MEMBER)

    await member_model.add(branch_id, body.user_id, body.role, db)
    return {'status': True}


async def update_member_role(branch_id: int, target_user_id: int, body, request: Request, db: AsyncSession):
    """멤버 역할 변경 (admin만)"""
    user_id = request.state.payload.get('user_id')
    role = await member_model.get_role(branch_id, user_id, db)
    if role != 'admin':
        return error_response(ErrorCode.ADMIN_ONLY)

    # 대상이 멤버인지 확인
    if not await member_model.is_member(branch_id, target_user_id, db):
        return error_response(ErrorCode.NOT_BRANCH_MEMBER)

    # admin → member 변경 시 마지막 admin인지 확인
    current_role = await member_model.get_role(branch_id, target_user_id, db)
    if current_role == 'admin' and body.role != 'admin':
        admin_count = await member_model.count_admins(branch_id, db)
        if admin_count <= 1:
            return error_response(ErrorCode.CANNOT_REMOVE_LAST_ADMIN)

    await member_model.update_role(branch_id, target_user_id, body.role, db)
    return {'status': True}


async def remove_member(branch_id: int, target_user_id: int, request: Request, db: AsyncSession):
    """멤버 제거 (admin만)"""
    user_id = request.state.payload.get('user_id')
    role = await member_model.get_role(branch_id, user_id, db)
    if role != 'admin':
        return error_response(ErrorCode.ADMIN_ONLY)

    # 마지막 admin 제거 방지
    target_role = await member_model.get_role(branch_id, target_user_id, db)
    if not target_role:
        return error_response(ErrorCode.NOT_BRANCH_MEMBER)

    if target_role == 'admin':
        admin_count = await member_model.count_admins(branch_id, db)
        if admin_count <= 1:
            return error_response(ErrorCode.CANNOT_REMOVE_LAST_ADMIN)

    await member_model.remove(branch_id, target_user_id, db)
    return {'status': True}


async def leave(branch_id: int, request: Request, db: AsyncSession):
    """브랜치 나가기 (본인)"""
    user_id = request.state.payload.get('user_id')
    role = await member_model.get_role(branch_id, user_id, db)
    if not role:
        return error_response(ErrorCode.NOT_BRANCH_MEMBER)

    # 마지막 admin이면 나갈 수 없음
    if role == 'admin':
        admin_count = await member_model.count_admins(branch_id, db)
        if admin_count <= 1:
            return error_response(ErrorCode.CANNOT_LEAVE_LAST_ADMIN)

    await member_model.remove(branch_id, user_id, db)
    return {'status': True}


async def delete(branch_id: int, request: Request, db: AsyncSession):
    """Branch 삭제/아카이브 (admin만)"""
    user_id = request.state.payload.get('user_id')
    role = await member_model.get_role(branch_id, user_id, db)
    if role != 'admin':
        return error_response(ErrorCode.ADMIN_ONLY)

    branch = await branch_model.find_by_id(branch_id, db)
    if not branch:
        return error_response(ErrorCode.BRANCH_NOT_FOUND)

    await branch_model.archive(branch_id, db)
    return {'status': True}


async def list_archived(request: Request, db: AsyncSession):
    """아카이브된 Branch 목록 (admin인 것만, 보관함용)."""
    user_id = request.state.payload.get('user_id')
    branches = await branch_model.find_archived(user_id, db)
    return {'status': True, 'branches': branches}


async def restore(branch_id: int, request: Request, db: AsyncSession):
    """Branch 복원 (admin만). 아카이브된 branch도 멤버십은 살아있어 role로 확인."""
    user_id = request.state.payload.get('user_id')
    role = await member_model.get_role(branch_id, user_id, db)
    if role != 'admin':
        return error_response(ErrorCode.ADMIN_ONLY)
    await branch_model.restore(branch_id, db)
    return {'status': True}


async def permanent_delete(branch_id: int, request: Request, db: AsyncSession):
    """Branch 영구삭제 (admin만). canvas detach + poly 정리 + CASCADE."""
    user_id = request.state.payload.get('user_id')
    role = await member_model.get_role(branch_id, user_id, db)
    if role != 'admin':
        return error_response(ErrorCode.ADMIN_ONLY)
    await branch_model.hard_delete(branch_id, db)
    return {'status': True}


async def search_non_members(branch_id: int, query: str, request: Request, db: AsyncSession):
    """초대 가능한 사용자 검색"""
    user_id = request.state.payload.get('user_id')
    role = await member_model.get_role(branch_id, user_id, db)
    if role != 'admin':
        return error_response(ErrorCode.ADMIN_ONLY)

    users = await member_model.search_non_members(branch_id, query, db)
    return {'status': True, 'users': users}
