from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from library.user_avatar import user_color


async def create(branch_name: str, key: str, description: str,
                 visibility: str, created_by: int, db: AsyncSession) -> int:
    """Branch 생성"""
    result = await db.execute(text("""
        INSERT INTO branch (branch_name, key, description, visibility, created_by)
        VALUES (:branch_name, :key, :description, :visibility, :created_by)
        RETURNING branch_id
    """), {
        'branch_name': branch_name,
        'key': key,
        'description': description,
        'visibility': visibility,
        'created_by': created_by,
    })
    return result.scalar_one()


async def find_by_id(branch_id: int, db: AsyncSession):
    """Branch 상세 조회"""
    result = await db.execute(text("""
        SELECT b.branch_id, b.branch_name, b.key, b.description,
               b.icon, b.color, b.visibility, b.is_archived,
               b.created_by, b.created_at, b.updated_at
        FROM branch b
        WHERE b.branch_id = :branch_id AND b.is_archived = FALSE
    """), {'branch_id': branch_id})
    row = result.fetchone()
    return dict(row._mapping) if row else None


async def find_accessible(user_id: int, db: AsyncSession):
    """사용자가 접근 가능한 Branch 목록 (홈 카드 집계 필드 포함).

    각 branch dict 에 추가되는 필드:
    - progress_percent: 현재 active 스프린트 진행률(terminal/total). active 스프린트가
      없거나 스프린트 태스크가 0이면 None.
    - active_sprint_count: status='active' 스프린트 수
    - active_sprint_name: active 스프린트가 정확히 1개일 때 그 이름, 아니면 None
    - sprint_task_total: active 스프린트의 최상위 태스크 수 (칩 카운트)
    - active_task_count: 브랜치 전체 최상위 미완료(non-terminal) 태스크 수 (빈 상태 칩)
    - member_count, members (상위 4명 [{name, color}])

    terminal = workflow_status category in (done, cancelled). 카운트는 최상위
    태스크(parent_task_id IS NULL)만. 집계는 단일 목록 쿼리 + 상관 서브쿼리,
    멤버 미리보기만 별도 배치 1회로 N+1 회피.
    """
    result = await db.execute(text("""
        SELECT b.branch_id, b.branch_name, b.key, b.description,
               b.icon, b.color, b.visibility, b.created_at,
               bm.role AS my_role,
               COALESCE(sa.sprint_task_total, 0) AS sprint_task_total,
               COALESCE(sa.sprint_task_done, 0) AS sprint_task_done,
               COALESCE(sa.active_task_count, 0) AS active_task_count,
               (SELECT COUNT(*) FROM sprint s2
                WHERE s2.branch_id = b.branch_id AND s2.status = 'active'
               ) AS active_sprint_count,
               (SELECT s.sprint_name FROM sprint s
                WHERE s.branch_id = b.branch_id AND s.status = 'active'
                ORDER BY s.created_at DESC, s.sprint_id DESC
                LIMIT 1) AS active_sprint_name,
               (SELECT COUNT(*) FROM branch_member bm2
                WHERE bm2.branch_id = b.branch_id) AS member_count
        FROM branch b
        INNER JOIN branch_member bm ON b.branch_id = bm.branch_id
        LEFT JOIN (
            -- 스프린트 스코프 + 활성 집계. 최상위 태스크만(parent_task_id IS NULL).
            -- Caveat: status에 매칭되는 workflow_status row가 없으면 'done'으로 폴백
            -- (core/model/task.py 미러) → terminal 로 침.
            SELECT t.branch_id,
                   COUNT(*) FILTER (WHERE s.status = 'active') AS sprint_task_total,
                   COUNT(*) FILTER (
                       WHERE s.status = 'active'
                         AND COALESCE(ws.category, 'done') IN ('done', 'cancelled')
                   ) AS sprint_task_done,
                   COUNT(*) FILTER (
                       WHERE COALESCE(ws.category, 'done') NOT IN ('done', 'cancelled')
                   ) AS active_task_count
            FROM task t
            LEFT JOIN sprint s ON s.sprint_id = t.sprint_id
            LEFT JOIN workflow_status ws
                ON ws.branch_id = t.branch_id AND ws.key = t.status
            WHERE t.parent_task_id IS NULL
            GROUP BY t.branch_id
        ) sa ON sa.branch_id = b.branch_id
        WHERE bm.user_id = :user_id AND b.is_archived = FALSE
        ORDER BY b.branch_name
    """), {'user_id': user_id})
    branches = [dict(row._mapping) for row in result.fetchall()]

    if not branches:
        return branches

    for b in branches:
        st = b['sprint_task_total']
        b['progress_percent'] = (
            round(b['sprint_task_done'] / st * 100)
            if b['active_sprint_count'] and st else None
        )
        if b['active_sprint_count'] != 1:
            b['active_sprint_name'] = None
        del b['sprint_task_done']   # 내부 계산용, 응답에서 제외
        b['members'] = []

    # 멤버 미리보기(상위 4명) 배치 조회 — branch 당 가입 순으로 4명까지.
    branch_ids = [b['branch_id'] for b in branches]
    members_result = await db.execute(text("""
        SELECT branch_id, user_id, username, avatar_url, avatar_color
        FROM (
            SELECT bm.branch_id, bm.user_id, u.username, u.avatar_url, u.avatar_color,
                   ROW_NUMBER() OVER (
                       PARTITION BY bm.branch_id
                       ORDER BY bm.joined_at, bm.user_id
                   ) AS rn
            FROM branch_member bm
            INNER JOIN "user" u ON bm.user_id = u.user_id
            WHERE bm.branch_id = ANY(:branch_ids)
              AND u.deleted_at IS NULL
        ) ranked
        WHERE rn <= 4
        ORDER BY branch_id, rn
    """), {'branch_ids': branch_ids})

    by_branch = {b['branch_id']: b for b in branches}
    for row in members_result.fetchall():
        m = row._mapping
        by_branch[m['branch_id']]['members'].append({
            'name': m['username'],
            'avatar_url': m['avatar_url'],
            'color': user_color(m['user_id'], m.get('avatar_color')),
        })

    return branches


async def home_stats(user_id: int, today, db: AsyncSession):
    """사용자가 접근 가능한 Branch 전체에 대한 홈 KPI 집계.

    - open_count: 미완료(done/cancelled 외) 중 in_progress 가 아닌 태스크 수
    - in_progress_count: category = 'in_progress' 태스크 수
    - due_this_week_count: due_date 가 today~+7일 이내인 미완료 태스크 수
    - active_sprint_count: status = 'active' 스프린트 수
    모두 사용자가 멤버인(아카이브 안 된) branch 기준.

    today: 컨트롤러가 넘기는 **개인 timezone의 오늘**(datetime.date). 홈 카드의 '이번 주 마감'은
    사용자별 파생 상태라 서버·DB 세션의 CURRENT_DATE(UTC)를 쓰면 뉴욕 사용자에게 하루 어긋난다.
    home_stat_items 도 같은 값을 받아 카운트와 목록이 항상 1:1로 맞는다.
    """
    result = await db.execute(text("""
        WITH my_branches AS (
            SELECT b.branch_id
            FROM branch b
            INNER JOIN branch_member bm ON b.branch_id = bm.branch_id
            WHERE bm.user_id = :user_id AND b.is_archived = FALSE
        ),
        my_tasks AS (
            SELECT t.task_id, t.due_date,
                   COALESCE(ws.category, 'done') AS category
            FROM task t
            INNER JOIN my_branches mb ON mb.branch_id = t.branch_id
            LEFT JOIN workflow_status ws
                ON ws.branch_id = t.branch_id AND ws.key = t.status
            WHERE t.parent_task_id IS NULL
        )
        SELECT
            COUNT(*) FILTER (
                WHERE category NOT IN ('done', 'cancelled', 'in_progress')
            ) AS open_count,
            COUNT(*) FILTER (WHERE category = 'in_progress') AS in_progress_count,
            COUNT(*) FILTER (
                WHERE category NOT IN ('done', 'cancelled')
                  AND due_date IS NOT NULL
                  AND due_date >= CAST(:today AS DATE)
                  AND due_date < CAST(:today AS DATE) + 7
            ) AS due_this_week_count,
            (SELECT COUNT(*) FROM sprint s
             INNER JOIN my_branches mb2 ON mb2.branch_id = s.branch_id
             WHERE s.status = 'active') AS active_sprint_count
        FROM my_tasks
    """), {'user_id': user_id, 'today': today})
    row = result.fetchone()
    return {
        'open_count': row._mapping['open_count'],
        'in_progress_count': row._mapping['in_progress_count'],
        'due_this_week_count': row._mapping['due_this_week_count'],
        'active_sprint_count': row._mapping['active_sprint_count'],
    }


# bucket별 task WHERE 조건 — home_stats 와 동일 필터(카운트=목록 1:1).
_TASK_BUCKET_WHERE = {
    'open': "category NOT IN ('done', 'cancelled', 'in_progress')",
    'in_progress': "category = 'in_progress'",
    'due_this_week': (
        "category NOT IN ('done', 'cancelled') "
        "AND due_date IS NOT NULL "
        "AND due_date >= CAST(:today AS DATE) AND due_date < CAST(:today AS DATE) + 7"
    ),
}


async def home_stat_items(user_id: int, bucket: str, limit: int, today, db: AsyncSession):
    """home_stats 카드 숫자 뒤의 실제 행. bucket 으로 분기.

    태스크 버킷(open/in_progress/due_this_week)은 home_stats 와 동일한
    my_branches CTE + 동일 필터 + **동일한 today**(개인 timezone)를 재사용해 카운트와 1:1 일치한다.
    active_sprint 버킷은 Task 2 에서 추가.
    반환: {'total_count': int, 'items': [...]}  (COUNT(*) OVER() 로 cap 전 총계).
    """
    if bucket == 'active_sprint':
        result = await db.execute(text("""
            WITH my_branches AS (
                SELECT b.branch_id, b.branch_name
                FROM branch b
                INNER JOIN branch_member bm ON b.branch_id = bm.branch_id
                WHERE bm.user_id = :user_id AND b.is_archived = FALSE
            )
            SELECT s.sprint_id, s.sprint_name, s.branch_id, mb.branch_name,
                   s.start_date, s.end_date,
                   COUNT(t.task_id) FILTER (
                       WHERE COALESCE(ws.category, 'done') IN ('done', 'cancelled')
                   ) AS done_count,
                   COUNT(t.task_id) AS total_count_tasks,
                   COUNT(*) OVER() AS total_count
            FROM sprint s
            INNER JOIN my_branches mb ON mb.branch_id = s.branch_id
            LEFT JOIN task t
                ON t.sprint_id = s.sprint_id AND t.parent_task_id IS NULL
            LEFT JOIN workflow_status ws
                ON ws.branch_id = t.branch_id AND ws.key = t.status
            WHERE s.status = 'active'
            GROUP BY s.sprint_id, s.sprint_name, s.branch_id, mb.branch_name,
                     s.start_date, s.end_date
            ORDER BY s.end_date ASC NULLS LAST, s.sprint_id
            LIMIT :limit
        """), {'user_id': user_id, 'limit': limit})
        rows = result.fetchall()
        items = [{
            'sprint_id': r._mapping['sprint_id'],
            'sprint_name': r._mapping['sprint_name'],
            'branch_id': r._mapping['branch_id'],
            'branch_name': r._mapping['branch_name'],
            'start_date': r._mapping['start_date'].isoformat() if r._mapping['start_date'] else None,
            'end_date': r._mapping['end_date'].isoformat() if r._mapping['end_date'] else None,
            'done_count': r._mapping['done_count'],
            'total_count_tasks': r._mapping['total_count_tasks'],
        } for r in rows]
        total = rows[0]._mapping['total_count'] if rows else 0
        return {'total_count': total, 'items': items}

    where = _TASK_BUCKET_WHERE[bucket]
    result = await db.execute(text(f"""
        WITH my_branches AS (
            SELECT b.branch_id, b.branch_name
            FROM branch b
            INNER JOIN branch_member bm ON b.branch_id = bm.branch_id
            WHERE bm.user_id = :user_id AND b.is_archived = FALSE
        ),
        my_tasks AS (
            SELECT t.task_id, t.title, t.due_date, t.branch_id,
                   mb.branch_name,
                   COALESCE(ws.category, 'done') AS category
            FROM task t
            INNER JOIN my_branches mb ON mb.branch_id = t.branch_id
            LEFT JOIN workflow_status ws
                ON ws.branch_id = t.branch_id AND ws.key = t.status
            WHERE t.parent_task_id IS NULL
        )
        SELECT task_id, title, branch_id, branch_name, due_date, category,
               COUNT(*) OVER() AS total_count
        FROM my_tasks
        WHERE {where}
        ORDER BY due_date ASC NULLS LAST, task_id
        LIMIT :limit
    """), {'user_id': user_id, 'limit': limit, 'today': today})
    rows = result.fetchall()
    items = [{
        'task_id': r._mapping['task_id'],
        'title': r._mapping['title'],
        'branch_id': r._mapping['branch_id'],
        'branch_name': r._mapping['branch_name'],
        'due_date': r._mapping['due_date'].isoformat() if r._mapping['due_date'] else None,
        'status_category': r._mapping['category'],
    } for r in rows]
    total = rows[0]._mapping['total_count'] if rows else 0
    return {'total_count': total, 'items': items}


async def update(branch_id: int, fields: dict, db: AsyncSession):
    """Branch 정보 수정"""
    set_clauses = ', '.join(f'{k} = :{k}' for k in fields)
    params = {**fields, 'branch_id': branch_id}
    await db.execute(text(f"""
        UPDATE branch SET {set_clauses}, updated_at = NOW()
        WHERE branch_id = :branch_id
    """), params)


async def find_by_key(key: str, db: AsyncSession):
    """key로 Branch 조회 (중복 체크용)"""
    result = await db.execute(text("""
        SELECT branch_id FROM branch WHERE key = :key
    """), {'key': key})
    return result.fetchone() is not None


async def find_by_key_row(key: str, db: AsyncSession):
    """key로 active Branch row 조회 (대소문자 무시). GitHub 참조 해석용.

    기존 find_by_key는 중복체크용 bool을 반환하므로 branch_id가 필요한
    dispatch 경로에선 쓸 수 없다. 활성 브랜치만(is_archived=FALSE) 반환한다.
    """
    result = await db.execute(text("""
        SELECT branch_id, key FROM branch
        WHERE UPPER(key) = UPPER(:key) AND is_archived = FALSE
    """), {'key': key})
    row = result.fetchone()
    return dict(row._mapping) if row else None


async def archive(branch_id: int, db: AsyncSession):
    """Branch 아카이브 (soft delete)"""
    await db.execute(text("""
        UPDATE branch SET is_archived = TRUE, updated_at = NOW()
        WHERE branch_id = :branch_id
    """), {'branch_id': branch_id})


async def restore(branch_id: int, db: AsyncSession):
    """Branch 복원 (is_archived=FALSE)"""
    await db.execute(text("""
        UPDATE branch SET is_archived = FALSE, updated_at = NOW()
        WHERE branch_id = :branch_id
    """), {'branch_id': branch_id})


async def find_archived(user_id: int, db: AsyncSession):
    """admin인 사용자의 아카이브된 Branch 목록(보관함용)."""
    result = await db.execute(text("""
        SELECT b.branch_id, b.branch_name, b.key, b.icon, b.color,
               b.updated_at, bm.role AS my_role
        FROM branch b
        INNER JOIN branch_member bm ON b.branch_id = bm.branch_id
        WHERE bm.user_id = :user_id AND b.is_archived = TRUE AND bm.role = 'admin'
        ORDER BY b.updated_at DESC NULLS LAST, b.branch_id DESC
    """), {'user_id': user_id})
    return [dict(r._mapping) for r in result.fetchall()]


async def hard_delete(branch_id: int, db: AsyncSession):
    """Branch 영구 삭제. canvas는 detach(branch_id=NULL), poly 참조 정리 후 branch 삭제.
    branch 자식(task/sprint/epic/...)은 ON DELETE CASCADE로 자동 삭제된다.
    canvas.branch_id는 NO ACTION이라 먼저 끊어야 FK 위반이 안 난다(문서는 보존).
    """
    # 1) 이 브랜치 task를 가리키는 poly 참조(FK 없음) 정리
    await db.execute(text("""
        DELETE FROM recent_view
        WHERE item_type = 'task' AND item_id IN (
            SELECT task_id FROM task WHERE branch_id = :branch_id)
    """), {'branch_id': branch_id})
    await db.execute(text("""
        DELETE FROM user_star
        WHERE item_type = 'task' AND item_id IN (
            SELECT task_id FROM task WHERE branch_id = :branch_id)
    """), {'branch_id': branch_id})
    await db.execute(text("""
        DELETE FROM notification
        WHERE (entity_type = 'task' AND entity_id IN (
                 SELECT task_id FROM task WHERE branch_id = :branch_id))
           OR (entity_type = 'branch' AND entity_id = :branch_id)
    """), {'branch_id': branch_id})
    # 2) canvas detach (branch_id NULL → 문서 보존)
    await db.execute(text("""
        UPDATE canvas SET branch_id = NULL WHERE branch_id = :branch_id
    """), {'branch_id': branch_id})
    # 3) branch 삭제 → 나머지 자식 CASCADE
    await db.execute(text("""
        DELETE FROM branch WHERE branch_id = :branch_id
    """), {'branch_id': branch_id})


async def find_public(user_id: int, query: str, db: AsyncSession):
    """public Branch 목록 (가입 여부 포함)"""
    params = {'user_id': user_id}
    where_search = ''
    if query:
        where_search = "AND (b.branch_name ILIKE :q OR b.key ILIKE :q)"
        params['q'] = f'%{query}%'

    result = await db.execute(text(f"""
        SELECT b.branch_id, b.branch_name, b.key, b.description,
               b.color, b.created_at,
               (SELECT COUNT(*) FROM branch_member bm2
                WHERE bm2.branch_id = b.branch_id) AS member_count,
               EXISTS(
                   SELECT 1 FROM branch_member bm3
                   WHERE bm3.branch_id = b.branch_id AND bm3.user_id = :user_id
               ) AS is_member
        FROM branch b
        WHERE b.visibility = 'public'
          AND b.is_archived = FALSE
          {where_search}
        ORDER BY b.branch_name
    """), params)
    rows = result.fetchall()
    return [dict(row._mapping) for row in rows]
