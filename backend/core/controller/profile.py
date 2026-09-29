import os
import uuid

from fastapi import Request, Response, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from core.errors import error_response, ErrorCode
from core.model import user as user_model
from core.controller.auth import _create_token, _set_auth_cookie
from library import crypto
from library.file_validator import validate_image_magic_bytes

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'uploads', 'avatars')
ALLOWED_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.gif', '.webp'}
MAX_FILE_SIZE = 2 * 1024 * 1024  # 2MB


def _remove_avatar_file(avatar_url: str):
    """업로드된 아바타 파일을 디스크에서 제거 (uploads 디렉토리 밖 경로는 무시)"""
    # URL 경로(/api/uploads/...)에서 실제 파일 경로(uploads/...)로 변환.
    # realpath로 심볼릭 링크까지 해석해 uploads 밖을 가리키는 경로를 차단.
    rel = avatar_url.replace('/api/uploads/', 'uploads/').lstrip('/')
    path = os.path.realpath(os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
        rel
    ))
    uploads_base = os.path.realpath(UPLOAD_DIR)
    if path.startswith(uploads_base + os.sep) and os.path.exists(path):
        os.remove(path)


async def get_profile(request: Request, db: AsyncSession):
    """내 프로필 조회"""
    user_id = request.state.payload.get('user_id')
    user = await user_model.find_by_id(user_id, db)
    if not user:
        return error_response(ErrorCode.USER_NOT_FOUND)
    return {'status': True, 'user': user}


async def update_username(body, request: Request, response: Response, db: AsyncSession):
    """사용자 이름 변경 + 쿠키 재발급"""
    user_id = request.state.payload.get('user_id')
    user = await user_model.find_by_id(user_id, db)
    if not user:
        return error_response(ErrorCode.USER_NOT_FOUND)

    await user_model.update_username(user_id, body.username, db)
    # 쿠키 재발급 (username이 payload에 포함되므로)
    token = _create_token(user_id, user['email'], body.username, user['role'])
    _set_auth_cookie(response, token)
    return {
        'status': True,
        'profile': {
            'user_id': user_id,
            'email': user['email'],
            'username': body.username,
            'role': user['role'],
            'avatar_url': user.get('avatar_url'),
            'avatar_color': user.get('avatar_color'),
        },
    }


async def update_password(body, request: Request, db: AsyncSession):
    """비밀번호 변경"""
    user_id = request.state.payload.get('user_id')
    user = await user_model.find_by_id_with_password(user_id, db)
    if not user:
        return error_response(ErrorCode.USER_NOT_FOUND)

    # 현재 비밀번호 검증
    stored_password = user['password']
    if isinstance(stored_password, memoryview):
        stored_password = bytes(stored_password)
    if not await crypto.check_password(body.current_password, stored_password):
        return error_response(ErrorCode.INVALID_CURRENT_PASSWORD)

    # 새 비밀번호 확인 일치 검증
    if body.new_password != body.confirm_password:
        return error_response(ErrorCode.PASSWORD_MISMATCH)

    new_hash = await crypto.hash_password_async(body.new_password)
    await user_model.update_password(user_id, new_hash, db)
    return {'status': True}


async def force_change_password(body, request: Request, db: AsyncSession):
    """임시 비밀번호 사용자의 비밀번호 강제 변경"""
    user_id = request.state.payload.get('user_id')
    user = await user_model.find_by_id_with_password(user_id, db)
    if not user:
        return error_response(ErrorCode.USER_NOT_FOUND)

    # must_change_password 플래그가 설정된 경우에만 허용
    # find_by_id_with_password에는 must_change_password가 없으므로 별도 조회
    check = await user_model.find_by_email(user['email'], db)
    if not check or not check.get('must_change_password'):
        return error_response(ErrorCode.NOT_ALLOWED)

    if body.new_password != body.confirm_password:
        return error_response(ErrorCode.PASSWORD_MISMATCH)

    new_hash = await crypto.hash_password_async(body.new_password)
    await user_model.update_password(user_id, new_hash, db)
    return {'status': True}


async def upload_avatar(file: UploadFile, request: Request, db: AsyncSession):
    """아바타 이미지 업로드"""
    user_id = request.state.payload.get('user_id')
    user = await user_model.find_by_id(user_id, db)
    if not user:
        return error_response(ErrorCode.USER_NOT_FOUND)

    # 파일 검증
    if not file or not file.filename:
        return error_response(ErrorCode.NO_FILE)

    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        return error_response(ErrorCode.INVALID_FILE_TYPE)

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        return error_response(ErrorCode.FILE_TOO_LARGE)

    # 매직 바이트 검증
    if not validate_image_magic_bytes(content, ext):
        return error_response(ErrorCode.INVALID_FILE_CONTENT)

    # 업로드 디렉토리 생성
    os.makedirs(UPLOAD_DIR, exist_ok=True)

    # 기존 아바타 삭제
    if user.get('avatar_url'):
        _remove_avatar_file(user['avatar_url'])

    # 고유 파일명 생성 및 저장
    filename = f"{user_id}_{uuid.uuid4().hex[:8]}{ext}"
    filepath = os.path.join(UPLOAD_DIR, filename)
    with open(filepath, 'wb') as f:
        f.write(content)

    avatar_url = f"/api/uploads/avatars/{filename}"
    await user_model.update_avatar(user_id, avatar_url, db)

    return {'status': True, 'avatar_url': avatar_url}


async def delete_avatar(request: Request, db: AsyncSession):
    """아바타 사진 제거 (색상 설정은 유지)"""
    user_id = request.state.payload.get('user_id')
    user = await user_model.find_by_id(user_id, db)
    if not user:
        return error_response(ErrorCode.USER_NOT_FOUND)

    if user.get('avatar_url'):
        _remove_avatar_file(user['avatar_url'])

    await user_model.update_avatar(user_id, None, db)
    return {'status': True}


async def update_avatar_color(body, request: Request, db: AsyncSession):
    """아바타 색상 변경 (None = 자동 해시 색)"""
    user_id = request.state.payload.get('user_id')
    user = await user_model.find_by_id(user_id, db)
    if not user:
        return error_response(ErrorCode.USER_NOT_FOUND)

    await user_model.update_avatar_color(user_id, body.color, db)
    return {'status': True, 'avatar_color': body.color}
