from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def create(email: str, password_hash: bytes, username: str, db: AsyncSession, status: str = 'active') -> int:
    """사용자 생성"""
    result = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status)
        VALUES (:email, :password, :username, :status)
        RETURNING user_id
    """), {'email': email, 'password': password_hash, 'username': username, 'status': status})
    return result.scalar_one()


async def find_by_email(email: str, db: AsyncSession):
    """이메일로 사용자 조회"""
    result = await db.execute(text("""
        SELECT user_id, email, password, username, role, status, created_at, must_change_password,
               avatar_url, avatar_color
        FROM "user"
        WHERE email = :email AND deleted_at IS NULL
    """), {'email': email})
    row = result.fetchone()
    return dict(row._mapping) if row else None


async def update_role(user_id: int, role: str, db: AsyncSession):
    """사용자 역할 변경"""
    await db.execute(text("""
        UPDATE "user"
        SET role = :role
        WHERE user_id = :user_id AND deleted_at IS NULL
    """), {'user_id': user_id, 'role': role})


async def update_login(user_id: int, ip: str, db: AsyncSession):
    """로그인 시간/IP 갱신"""
    await db.execute(text("""
        UPDATE "user"
        SET last_login_at = NOW(), last_login_ip = :ip
        WHERE user_id = :user_id AND deleted_at IS NULL
    """), {'user_id': user_id, 'ip': ip})


async def find_all(db: AsyncSession):
    """전체 사용자 목록 (비밀번호 제외, 삭제된 사용자 제외)"""
    result = await db.execute(text("""
        SELECT user_id, email, username, role, status, avatar_url, avatar_color, created_at, last_login_at
        FROM "user"
        WHERE deleted_at IS NULL
        ORDER BY created_at DESC
    """))
    rows = result.fetchall()
    return [dict(row._mapping) for row in rows]


async def find_by_id(user_id: int, db: AsyncSession):
    """사용자 ID로 조회 (비밀번호 제외)"""
    result = await db.execute(text("""
        SELECT user_id, email, username, role, status, avatar_url, avatar_color, created_at, last_login_at
        FROM "user"
        WHERE user_id = :user_id AND deleted_at IS NULL
    """), {'user_id': user_id})
    row = result.fetchone()
    return dict(row._mapping) if row else None


async def find_by_id_with_password(user_id: int, db: AsyncSession):
    """사용자 ID로 조회 (비밀번호 포함, 비밀번호 검증용)"""
    result = await db.execute(text("""
        SELECT user_id, email, password, username, role, status, avatar_url
        FROM "user"
        WHERE user_id = :user_id AND deleted_at IS NULL
    """), {'user_id': user_id})
    row = result.fetchone()
    return dict(row._mapping) if row else None


async def update_status(user_id: int, status: str, db: AsyncSession):
    """사용자 상태 변경 (active, pending, rejected)"""
    await db.execute(text("""
        UPDATE "user"
        SET status = :status
        WHERE user_id = :user_id AND deleted_at IS NULL
    """), {'user_id': user_id, 'status': status})


async def update_username(user_id: int, username: str, db: AsyncSession):
    """사용자 이름 변경"""
    await db.execute(text("""
        UPDATE "user"
        SET username = :username
        WHERE user_id = :user_id AND deleted_at IS NULL
    """), {'user_id': user_id, 'username': username})


async def update_password(user_id: int, password_hash: bytes, db: AsyncSession):
    """비밀번호 변경 (must_change_password 플래그도 해제)"""
    await db.execute(text("""
        UPDATE "user"
        SET password = :password, must_change_password = FALSE
        WHERE user_id = :user_id AND deleted_at IS NULL
    """), {'user_id': user_id, 'password': password_hash})


async def set_must_change_password(user_id: int, flag: bool, db: AsyncSession):
    """비밀번호 변경 강제 플래그 설정"""
    await db.execute(text("""
        UPDATE "user"
        SET must_change_password = :flag
        WHERE user_id = :user_id AND deleted_at IS NULL
    """), {'user_id': user_id, 'flag': flag})


async def batch_usernames(user_ids: list[int], db: AsyncSession) -> dict:
    """멘션 칩 하이드레이션용 username 배치 조회.

    별도 스코핑 없음 — username은 GET /chat/users(전체 사용자 목록, require_login)로
    이미 전 로그인 사용자에게 노출되는 수준의 정보다.
    """
    if not user_ids:
        return {}
    result = await db.execute(text("""
        SELECT user_id, username FROM "user"
        WHERE user_id = ANY(:ids) AND status = 'active' AND deleted_at IS NULL
    """), {'ids': user_ids})
    return {str(r.user_id): {'username': r.username} for r in result.fetchall()}


async def soft_delete(user_id: int, db: AsyncSession):
    """사용자 소프트 삭제"""
    await db.execute(text("""
        UPDATE "user"
        SET deleted_at = NOW()
        WHERE user_id = :user_id
    """), {'user_id': user_id})


async def update_avatar(user_id: int, avatar_url: str, db: AsyncSession):
    """아바타 URL 변경"""
    await db.execute(text("""
        UPDATE "user"
        SET avatar_url = :avatar_url
        WHERE user_id = :user_id AND deleted_at IS NULL
    """), {'user_id': user_id, 'avatar_url': avatar_url})


async def update_avatar_color(user_id: int, color, db: AsyncSession):
    """아바타 색상 변경 (None이면 자동 해시 색으로 복귀)"""
    await db.execute(text("""
        UPDATE "user"
        SET avatar_color = :color
        WHERE user_id = :user_id AND deleted_at IS NULL
    """), {'user_id': user_id, 'color': color})


async def get_ui_prefs(user_id: int, db: AsyncSession):
    """per-user 뷰 상태(ui_prefs) 조회"""
    result = await db.execute(text("""
        SELECT ui_prefs FROM "user" WHERE user_id = :user_id AND deleted_at IS NULL
    """), {'user_id': user_id})
    row = result.fetchone()
    return row._mapping['ui_prefs'] if row else None


async def update_ui_prefs(user_id: int, patch: dict, db: AsyncSession):
    """per-user 뷰 상태(ui_prefs) top-level 네임스페이스 원자적 병합 저장.
    `||`는 top-level 키 단위 shallow merge → 동시 탭이 서로 다른 네임스페이스를
    PATCH해도 clobber 없음(read-modify-write 경합 제거)."""
    await db.execute(text("""
        UPDATE "user"
        SET ui_prefs = COALESCE(ui_prefs, '{}'::jsonb) || CAST(:patch AS jsonb)
        WHERE user_id = :user_id AND deleted_at IS NULL
    """), {'user_id': user_id, 'patch': __import__('json').dumps(patch)})


async def get_language_region(user_id: int, db: AsyncSession):
    """개인 language_region 네임스페이스만 조회 (ui_prefs 전체를 끌어오지 않는다).

    정규화는 하지 않는다 — 호출부(library.locale_prefs.normalize_language_region)가
    프런트와 같은 규칙으로 검증한다. 손상된 값은 여기서 그대로 나가고 폴백은 호출부 책임.
    """
    result = await db.execute(text("""
        SELECT ui_prefs -> 'language_region' AS language_region
        FROM "user"
        WHERE user_id = :user_id AND deleted_at IS NULL
    """), {'user_id': user_id})
    row = result.fetchone()
    return row._mapping['language_region'] if row else None
