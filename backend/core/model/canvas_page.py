from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from library.html_sanitize import sanitize_html


async def create(canvas_id: int, title: str, content: str,
                 parent_page_id: int, position: int, created_by: int,
                 page_type: str = 'document', db: AsyncSession = None) -> int:
    """Canvas 페이지 생성"""
    result = await db.execute(text("""
        INSERT INTO canvas_page (canvas_id, title, content, parent_page_id, position, created_by, updated_by, type)
        VALUES (:canvas_id, :title, :content, :parent_page_id, :position, :created_by, :created_by, :type)
        RETURNING page_id
    """), {
        'canvas_id': canvas_id,
        'title': title,
        'content': content,
        'parent_page_id': parent_page_id,
        'position': position,
        'created_by': created_by,
        'type': page_type,
    })
    return result.scalar_one()


async def find_by_id(page_id: int, db: AsyncSession):
    """페이지 상세 조회 (content 포함)"""
    result = await db.execute(text("""
        SELECT p.page_id, p.canvas_id, p.parent_page_id, p.title,
               p.content, p.position, p.type, p.is_archived, p.wide_mode,
               p.created_by, p.updated_by, p.created_at, p.updated_at,
               p.yjs_state, p.yjs_updated_at,
               u.username AS created_by_name,
               u2.username AS updated_by_name
        FROM canvas_page p
        LEFT JOIN "user" u ON p.created_by = u.user_id
        LEFT JOIN "user" u2 ON p.updated_by = u2.user_id
        WHERE p.page_id = :page_id AND p.is_archived = FALSE
    """), {'page_id': page_id})
    row = result.fetchone()
    if not row:
        return None
    d = dict(row._mapping)
    # yjs_state는 바이너리라 JSON 직렬화 불가 → boolean 플래그로 변환
    d['yjs_state'] = bool(d.get('yjs_state'))
    return d


async def find_by_id_simple(page_id: int, db: AsyncSession):
    """페이지 간단 조회 (채팅 doc_ref 용)"""
    result = await db.execute(text("""
        SELECT p.page_id, p.canvas_id, p.title, c.canvas_name
        FROM canvas_page p
        INNER JOIN canvas c ON p.canvas_id = c.canvas_id
        WHERE p.page_id = :page_id AND p.is_archived = FALSE AND c.is_archived = FALSE
    """), {'page_id': page_id})
    row = result.fetchone()
    return dict(row._mapping) if row else None


async def batch_titles(page_ids: list[int], user_id: int, db: AsyncSession) -> dict:
    """Ref 제목 배치 조회 (page_id → title/canvas_name), 멤버인 canvas만"""
    if not page_ids:
        return {}
    result = await db.execute(text("""
        SELECT p.page_id, p.title, c.canvas_name
        FROM canvas_page p
        INNER JOIN canvas c ON c.canvas_id = p.canvas_id
        INNER JOIN canvas_member cm ON cm.canvas_id = p.canvas_id AND cm.user_id = :user_id
        WHERE p.page_id = ANY(:ids) AND p.is_archived = FALSE AND c.is_archived = FALSE
    """), {'ids': page_ids, 'user_id': user_id})
    return {str(r.page_id): {'title': r.title, 'canvas_name': r.canvas_name} for r in result.fetchall()}


async def find_tree(canvas_id: int, db: AsyncSession):
    """Canvas 내 전체 페이지 트리 (content 제외, 가볍게)"""
    result = await db.execute(text("""
        SELECT p.page_id, p.parent_page_id, p.title, p.position, p.type,
               p.created_by, p.updated_at
        FROM canvas_page p
        WHERE p.canvas_id = :canvas_id AND p.is_archived = FALSE
        ORDER BY p.position, p.created_at, p.page_id
    """), {'canvas_id': canvas_id})
    rows = result.fetchall()
    return [dict(row._mapping) for row in rows]


# update()로 변경 가능한 필드 화이트리스트.
# parent_page_id/position은 트리 무결성(사이클·cross-canvas) 검증이 필요하므로
# 부모/위치 변경은 move_page() 전용이며 여기서는 의도적으로 제외한다 (CP-002).
_UPDATABLE_FIELDS = frozenset({'title', 'content', 'wide_mode'})


async def lock(page_id: int, db: AsyncSession):
    """행을 잠근다(호출 세션이 커밋할 때 풀린다). 편집기 밖 본문 쓰기가 협업 방 확인 전에 잡는다 — 방 입장도
    get_yjs_state(for_update=True)로 같은 행을 잠그므로 둘은 서로의 커밋을 기다린다(core/controller/canvas_page.update)."""
    await db.execute(text("""
        SELECT 1 FROM canvas_page WHERE page_id = :page_id FOR UPDATE
    """), {'page_id': page_id})


async def update(page_id: int, fields: dict, updated_by: int, db: AsyncSession,
                 reset_yjs: bool = False):
    """페이지 수정 (화이트리스트 필드만 — parent_page_id/position 제외).

    reset_yjs=True면 같은 UPDATE에서 공동편집 상태(yjs_state)를 비운다 — 편집기 밖에서 content를 바꾼 뒤 다음
    편집기가 옛 Yjs 문서 대신 새 content에서 시작하게 한다."""
    fields = {k: v for k, v in fields.items() if k in _UPDATABLE_FIELDS}
    if not fields:
        return
    fields['updated_by'] = updated_by
    set_clauses = ', '.join(f'{k} = :{k}' for k in fields)
    if reset_yjs:
        set_clauses += ', yjs_state = NULL, yjs_updated_at = NULL'
    params = {**fields, 'page_id': page_id}
    await db.execute(text(f"""
        UPDATE canvas_page SET {set_clauses}, updated_at = NOW()
        WHERE page_id = :page_id
    """), params)


async def is_circular_parent(page_id: int, new_parent_id, db: AsyncSession) -> bool:
    """page_id의 부모를 new_parent_id로 바꾸면 사이클이 생기는지 검사 (True = 사이클).

    - new_parent_id is None → 루트로 이동이므로 사이클 불가 (False).
    - new_parent_id == page_id → self-parent (True).
    - 그 외: new_parent_id에서 parent_page_id 체인을 위로(조상 방향) 따라가
      page_id가 나오면 new_parent가 page의 후손이므로 사이클 (True).

    task_dependency.check_circular의 재귀 CTE 패턴을 따르되, 이미 사이클이
    DB에 들어있어도 헬퍼 자체가 무한 루프하지 않도록 UNION(중복 제거) +
    깊이 제한(depth)을 둔다.
    """
    if new_parent_id is None:
        return False
    if new_parent_id == page_id:
        return True
    result = await db.execute(text("""
        WITH RECURSIVE ancestors AS (
            SELECT page_id, parent_page_id, 1 AS depth
            FROM canvas_page
            WHERE page_id = :new_parent_id
            UNION
            SELECT cp.page_id, cp.parent_page_id, a.depth + 1
            FROM canvas_page cp
            INNER JOIN ancestors a ON cp.page_id = a.parent_page_id
            WHERE a.depth < 10000
        )
        SELECT EXISTS (SELECT 1 FROM ancestors WHERE page_id = :page_id)
    """), {'new_parent_id': new_parent_id, 'page_id': page_id})
    return result.scalar_one()


async def move_page(page_id: int, canvas_id: int, new_parent_id, new_position: int,
                    updated_by: int, db: AsyncSession):
    """페이지 이동 (형제 position 자동 재정렬)"""
    # 현재 페이지 정보
    row = await db.execute(text("""
        SELECT parent_page_id, position FROM canvas_page
        WHERE page_id = :page_id AND is_archived = FALSE
    """), {'page_id': page_id})
    current = row.fetchone()
    if not current:
        return
    old_parent_id = current.parent_page_id
    old_position = current.position

    # 1. 기존 부모에서 갭 정리 (이동 아이템 뒤 형제들 position-1)
    await db.execute(text("""
        UPDATE canvas_page SET position = position - 1
        WHERE canvas_id = :canvas_id
          AND parent_page_id IS NOT DISTINCT FROM :old_parent_id
          AND position > :old_position
          AND page_id != :page_id
          AND is_archived = FALSE
    """), {
        'canvas_id': canvas_id,
        'old_parent_id': old_parent_id,
        'old_position': old_position,
        'page_id': page_id,
    })

    # 2. 새 부모에서 공간 확보 (삽입 위치 이후 형제들 position+1)
    await db.execute(text("""
        UPDATE canvas_page SET position = position + 1
        WHERE canvas_id = :canvas_id
          AND parent_page_id IS NOT DISTINCT FROM :new_parent_id
          AND position >= :new_position
          AND page_id != :page_id
          AND is_archived = FALSE
    """), {
        'canvas_id': canvas_id,
        'new_parent_id': new_parent_id,
        'new_position': new_position,
        'page_id': page_id,
    })

    # 3. 페이지 이동
    await db.execute(text("""
        UPDATE canvas_page
        SET parent_page_id = :new_parent_id, position = :new_position,
            updated_by = :updated_by, updated_at = NOW()
        WHERE page_id = :page_id
    """), {
        'new_parent_id': new_parent_id,
        'new_position': new_position,
        'updated_by': updated_by,
        'page_id': page_id,
    })



async def hard_delete(page_id: int, db: AsyncSession):
    """페이지 영구 삭제 (하위 페이지 포함)"""
    # 하위 페이지 포함 recent_view, user_star 정리
    await db.execute(text("""
        WITH RECURSIVE descendants AS (
            SELECT page_id FROM canvas_page WHERE page_id = :page_id
            UNION ALL
            SELECT wp.page_id FROM canvas_page wp
            INNER JOIN descendants d ON wp.parent_page_id = d.page_id
        )
        DELETE FROM recent_view
        WHERE item_type = 'doc' AND item_id IN (SELECT page_id FROM descendants)
    """), {'page_id': page_id})
    await db.execute(text("""
        WITH RECURSIVE descendants AS (
            SELECT page_id FROM canvas_page WHERE page_id = :page_id
            UNION ALL
            SELECT wp.page_id FROM canvas_page wp
            INNER JOIN descendants d ON wp.parent_page_id = d.page_id
        )
        DELETE FROM user_star
        WHERE item_type = 'doc' AND item_id IN (SELECT page_id FROM descendants)
    """), {'page_id': page_id})
    await db.execute(text("""
        WITH RECURSIVE descendants AS (
            SELECT page_id FROM canvas_page WHERE page_id = :page_id
            UNION ALL
            SELECT wp.page_id FROM canvas_page wp
            INNER JOIN descendants d ON wp.parent_page_id = d.page_id
        )
        DELETE FROM canvas_page
        WHERE page_id IN (SELECT page_id FROM descendants)
    """), {'page_id': page_id})


async def copy_page(page_id: int, parent_page_id: int | None,
                    created_by: int, db: AsyncSession) -> int:
    """페이지 복제 (content만 복사, yjs_state 미복사)"""
    original = await find_by_id(page_id, db)
    if not original:
        return None

    canvas_id = original['canvas_id']
    target_parent = parent_page_id if parent_page_id is not None else original.get('parent_page_id')
    position = await get_next_position(canvas_id, target_parent, db)

    new_title = f"{original['title']} (copy)"
    content = original.get('content') or ''
    if original['type'] != 'typst':
        # SEC-17: 복제 시에도 정화 — 정화 도입 이전에 저장된 기존 콘텐츠의 오염 전파 차단.
        # typst는 raw 소스라 우회한다(controller create/update와 같은 근거: nh3가 <intro> 라벨을
        # 지우고 '<'·'&'를 엔티티로 바꿔 원문을 훼손한다).
        content = sanitize_html(content) or ''
    return await create(
        canvas_id=canvas_id,
        title=new_title,
        content=content,
        parent_page_id=target_parent,
        position=position,
        created_by=created_by,
        page_type=original['type'],
        db=db,
    )


async def get_yjs_state(page_id: int, db: AsyncSession, for_update: bool = False) -> bytes | None:
    """페이지의 Yjs 바이너리 상태 조회.

    for_update: 협업 방 입장이 행을 잠그고 읽는다 — 편집기 밖 본문 쓰기(yjs_state를 비운다)가 커밋될 때까지
    기다렸다가 그 결과를 읽는다(library/ws_collab_manager.py). 잠금은 호출 세션의 커밋 때 풀린다."""
    lock_clause = " FOR UPDATE" if for_update else ""
    result = await db.execute(text(f"""
        SELECT yjs_state FROM canvas_page WHERE page_id = :page_id{lock_clause}
    """), {'page_id': page_id})
    row = result.fetchone()
    return row[0] if row else None


async def save_yjs_state(page_id: int, yjs_state: bytes,
                         html_content: str | None, db: AsyncSession):
    """Yjs document state 저장. html_content가 제공되면 content도 갱신."""
    if html_content is not None:
        await db.execute(text("""
            UPDATE canvas_page
            SET yjs_state = :yjs_state, content = :content,
                yjs_updated_at = NOW(), updated_at = NOW()
            WHERE page_id = :page_id
        """), {'page_id': page_id, 'yjs_state': yjs_state, 'content': html_content})
    else:
        await db.execute(text("""
            UPDATE canvas_page
            SET yjs_state = :yjs_state, yjs_updated_at = NOW(), updated_at = NOW()
            WHERE page_id = :page_id
        """), {'page_id': page_id, 'yjs_state': yjs_state})


async def search_for_chat(user_id: int, keyword: str, db: AsyncSession):
    """채팅용 캔버스 페이지 검색 (유저가 접근 가능한 캔버스만). 제목·본문·캔버스명 매칭."""
    keyword_like = f'%{keyword}%' if keyword else '%'
    # content의 regexp_replace 태그 제거 식은 마이그레이션 054의 함수형 trgm
    # 인덱스(idx_canvas_page_content_trgm)와 글자 그대로 같아야 플래너가 인덱스를 쓴다.
    result = await db.execute(text("""
        SELECT p.page_id, p.canvas_id, p.title,
               c.canvas_name, p.updated_at,
               CASE WHEN p.title ILIKE :keyword THEN 0 ELSE 1 END AS _rank
        FROM canvas_page p
        INNER JOIN canvas c ON p.canvas_id = c.canvas_id
        INNER JOIN canvas_member cm ON c.canvas_id = cm.canvas_id
        WHERE cm.user_id = :user_id
          AND c.is_archived = FALSE
          AND p.is_archived = FALSE
          AND (p.title ILIKE :keyword OR regexp_replace(p.content, '<[^>]+>', ' ', 'g') ILIKE :keyword OR c.canvas_name ILIKE :keyword)
        ORDER BY _rank, p.updated_at DESC
        LIMIT 10
    """), {'user_id': user_id, 'keyword': keyword_like})
    rows = result.fetchall()
    pages = []
    for row in rows:
        page = dict(row._mapping)
        page.pop('_rank', None)
        pages.append(page)
    return pages


async def get_next_position(canvas_id: int, parent_page_id: int, db: AsyncSession) -> int:
    """같은 부모 아래에서 다음 position 값"""
    if parent_page_id:
        result = await db.execute(text("""
            SELECT COALESCE(MAX(position), -1) + 1
            FROM canvas_page
            WHERE canvas_id = :canvas_id AND parent_page_id = :parent_page_id AND is_archived = FALSE
        """), {'canvas_id': canvas_id, 'parent_page_id': parent_page_id})
    else:
        result = await db.execute(text("""
            SELECT COALESCE(MAX(position), -1) + 1
            FROM canvas_page
            WHERE canvas_id = :canvas_id AND parent_page_id IS NULL AND is_archived = FALSE
        """), {'canvas_id': canvas_id})
    return result.scalar_one()
