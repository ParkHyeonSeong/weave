from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def create(track_name: str, description: str, color: str, icon: str,
                 visibility: str, default_view: str, created_by: int,
                 db: AsyncSession) -> int:
    """Track 생성"""
    result = await db.execute(text("""
        INSERT INTO track (track_name, description, color, icon, visibility,
                           default_view, created_by)
        VALUES (:track_name, :description, :color, :icon, :visibility,
                :default_view, :created_by)
        RETURNING track_id
    """), {
        'track_name': track_name,
        'description': description,
        'color': color,
        'icon': icon,
        'visibility': visibility,
        'default_view': default_view,
        'created_by': created_by,
    })
    return result.scalar_one()


async def find_by_id(track_id: int, db: AsyncSession):
    """Track 상세 (생성자만, 멤버 체크는 controller에서)"""
    result = await db.execute(text("""
        SELECT track_id, track_name, description, color, icon, visibility,
               default_view, is_archived, created_by, created_at, updated_at
        FROM track
        WHERE track_id = :track_id AND is_archived = FALSE
    """), {'track_id': track_id})
    row = result.fetchone()
    return dict(row._mapping) if row else None


async def find_accessible(user_id: int, db: AsyncSession):
    """사용자가 멤버인 Track 목록 (홈 카드 집계 필드 포함).

    각 track dict 에 추가되는 필드:
    - item_count / branch_count / member_count (기존)
    - progress_percent (0-100): track 의 task 참조(track_item, source_type='task')
      전체에 대한 완료율. done = workflow_status category in done/cancelled
      (branch/canvas 와 동일 규칙). task 가 없으면 0.
    - branches (상위 3 [{name, color}]): 연결 branch 미리보기. track_branch 의
      display_name_override / color_override 가 있으면 그쪽 우선
      (track_branch.find_by_track 와 동일 해석).

    progress 는 단일 목록 쿼리에서 상관 서브쿼리로 처리하고, branches 미리보기만
    별도 배치 쿼리 1회로 가져와 N+1 을 피한다.
    """
    result = await db.execute(text("""
        SELECT t.track_id, t.track_name, t.description, t.color, t.icon,
               t.visibility, t.default_view, t.created_at, t.updated_at,
               tm.role AS my_role,
               COALESCE(pa.item_count, 0) AS item_count,
               (SELECT COUNT(*) FROM track_branch tb WHERE tb.track_id = t.track_id) AS branch_count,
               (SELECT COUNT(*) FROM track_member tm2 WHERE tm2.track_id = t.track_id) AS member_count,
               COALESCE(pa.task_total, 0) AS task_total,
               COALESCE(pa.task_done, 0) AS task_done
        FROM track t
        INNER JOIN track_member tm ON t.track_id = tm.track_id
        LEFT JOIN (
            -- track 당 item 총수(item_count) 와 task 참조 집계를 한 번에.
            -- Caveat: status 가 매칭되는 workflow_status row 가 없으면 'done' 으로
            -- fallback(branch/canvas 와 동일). task 가 삭제됐으면 CASCADE 로
            -- track_item 도 사라지므로 t.task_id NULL 케이스는 발생하지 않음.
            SELECT ti.track_id,
                   COUNT(*) AS item_count,
                   COUNT(*) FILTER (
                       WHERE ti.source_type = 'task' AND bk.is_archived = FALSE
                   ) AS task_total,
                   COUNT(*) FILTER (
                       WHERE ti.source_type = 'task'
                         AND bk.is_archived = FALSE
                         AND COALESCE(ws.category, 'done') IN ('done', 'cancelled')
                   ) AS task_done
            FROM track_item ti
            LEFT JOIN task tk ON tk.task_id = ti.source_task_id
            LEFT JOIN branch bk ON bk.branch_id = tk.branch_id
            LEFT JOIN workflow_status ws
                ON ws.branch_id = tk.branch_id AND ws.key = tk.status
            GROUP BY ti.track_id
        ) pa ON pa.track_id = t.track_id
        WHERE tm.user_id = :user_id AND t.is_archived = FALSE
        ORDER BY t.updated_at DESC NULLS LAST, t.created_at DESC
    """), {'user_id': user_id})
    tracks = [dict(r._mapping) for r in result.fetchall()]

    if not tracks:
        return tracks

    for t in tracks:
        total = t.pop('task_total')
        done = t.pop('task_done')
        t['progress_percent'] = round(done / total * 100) if total else 0
        t['branches'] = []

    # 연결 branch 미리보기(상위 3) 배치 조회 — branch_name 순으로 3개까지.
    # override 가 있으면 display_name / color 를 그쪽으로 해석
    # (track_branch.find_by_track 와 동일).
    track_ids = [t['track_id'] for t in tracks]
    branches_result = await db.execute(text("""
        SELECT track_id,
               COALESCE(display_name_override, branch_real_name) AS name,
               COALESCE(color_override, branch_real_color) AS color
        FROM (
            SELECT tb.track_id,
                   tb.display_name_override, tb.color_override,
                   b.branch_name AS branch_real_name,
                   b.color AS branch_real_color,
                   ROW_NUMBER() OVER (
                       PARTITION BY tb.track_id
                       ORDER BY b.branch_name, b.branch_id
                   ) AS rn
            FROM track_branch tb
            INNER JOIN branch b ON tb.branch_id = b.branch_id
            WHERE tb.track_id = ANY(:track_ids) AND b.is_archived = FALSE
        ) ranked
        WHERE rn <= 3
        ORDER BY track_id, rn
    """), {'track_ids': track_ids})

    by_track = {t['track_id']: t for t in tracks}
    for row in branches_result.fetchall():
        m = row._mapping
        by_track[m['track_id']]['branches'].append({
            'name': m['name'],
            'color': m['color'],
        })

    return tracks


async def home_stats(user_id: int, today, db: AsyncSession):
    """사용자가 접근 가능한 Track 전체에 대한 홈 KPI 집계.

    - active_track_count: 멤버인(아카이브 안 된) track 수.
      track 에는 close/status 컬럼이 없고 is_archived 만 있으며,
      find_accessible 과 동일하게 archived 는 이미 제외되므로
      "활성 트랙 = 접근 가능한 트랙" 이다.
    - connected_branch_count: 그 track 들에 연결된 distinct branch 수.
    - in_progress_task_count: track 의 task 참조 중 category = 'in_progress'.
    - due_this_week_count: 미완료(done/cancelled 외) 중 due_date 가
      today~+7일 이내인 task 참조 수. today 는 컨트롤러가 넘기는 **개인 timezone의 오늘**
      (Branch 홈과 같은 정책 — 사용자별 파생 상태라 CURRENT_DATE(UTC)를 쓰지 않는다).

    같은 task / branch 가 여러 track 에 참조돼도 distinct 로 한 번만 센다
    (branch 는 명시적 DISTINCT, task 는 task_id distinct).
    """
    result = await db.execute(text("""
        WITH my_tracks AS (
            SELECT t.track_id
            FROM track t
            INNER JOIN track_member tm ON t.track_id = tm.track_id
            WHERE tm.user_id = :user_id AND t.is_archived = FALSE
        ),
        my_tasks AS (
            SELECT DISTINCT tk.task_id, tk.due_date,
                   COALESCE(ws.category, 'done') AS category
            FROM track_item ti
            INNER JOIN my_tracks mt ON mt.track_id = ti.track_id
            INNER JOIN task tk ON tk.task_id = ti.source_task_id
            INNER JOIN branch b ON b.branch_id = tk.branch_id AND b.is_archived = FALSE
            LEFT JOIN workflow_status ws
                ON ws.branch_id = tk.branch_id AND ws.key = tk.status
            WHERE ti.source_type = 'task'
        )
        SELECT
            (SELECT COUNT(*) FROM my_tracks) AS active_track_count,
            (SELECT COUNT(DISTINCT tb.branch_id)
             FROM track_branch tb
             INNER JOIN my_tracks mt2 ON mt2.track_id = tb.track_id
            ) AS connected_branch_count,
            (SELECT COUNT(*) FROM my_tasks
             WHERE category = 'in_progress') AS in_progress_task_count,
            (SELECT COUNT(*) FROM my_tasks
             WHERE category NOT IN ('done', 'cancelled')
               AND due_date IS NOT NULL
               AND due_date >= CAST(:today AS DATE)
               AND due_date < CAST(:today AS DATE) + 7) AS due_this_week_count
    """), {'user_id': user_id, 'today': today})
    row = result.fetchone()
    return {
        'active_track_count': row._mapping['active_track_count'],
        'connected_branch_count': row._mapping['connected_branch_count'],
        'in_progress_task_count': row._mapping['in_progress_task_count'],
        'due_this_week_count': row._mapping['due_this_week_count'],
    }


async def update(track_id: int, fields: dict, db: AsyncSession):
    """Track 정보 수정 (동적 필드)"""
    allowed = {'track_name', 'description', 'color', 'icon', 'visibility', 'default_view'}
    updates = {k: v for k, v in fields.items() if k in allowed}
    if not updates:
        return
    set_parts = [f'{k} = :{k}' for k in updates]
    set_parts.append('updated_at = NOW()')
    set_clause = ', '.join(set_parts)
    params = {**updates, 'track_id': track_id}
    await db.execute(text(f"""
        UPDATE track SET {set_clause}
        WHERE track_id = :track_id
    """), params)


async def delete(track_id: int, db: AsyncSession):
    """Track 하드 삭제 — 자식 정리는 controller가 orchestration."""
    await db.execute(text("""
        DELETE FROM track WHERE track_id = :track_id
    """), {'track_id': track_id})


async def find_materialized_dep_ids(track_id: int, db: AsyncSession):
    """Track의 모든 track_link이 만든 task_dependency id 모음 (Track 삭제 cascade용)."""
    result = await db.execute(text("""
        SELECT materialized_dependency_id
        FROM track_link
        WHERE track_id = :track_id AND materialized_dependency_id IS NOT NULL
    """), {'track_id': track_id})
    return [r[0] for r in result.fetchall()]


async def archive(track_id: int, db: AsyncSession):
    """Track 아카이브 (soft delete)"""
    await db.execute(text("""
        UPDATE track SET is_archived = TRUE, updated_at = NOW()
        WHERE track_id = :track_id
    """), {'track_id': track_id})


async def restore(track_id: int, db: AsyncSession):
    """Track 복원 (is_archived=FALSE)"""
    await db.execute(text("""
        UPDATE track SET is_archived = FALSE, updated_at = NOW()
        WHERE track_id = :track_id
    """), {'track_id': track_id})


async def find_archived(user_id: int, db: AsyncSession):
    """owner인 사용자의 아카이브된 Track 목록(보관함용)."""
    result = await db.execute(text("""
        SELECT t.track_id, t.track_name, t.icon, t.color,
               t.updated_at, tm.role AS my_role
        FROM track t
        INNER JOIN track_member tm ON t.track_id = tm.track_id
        WHERE tm.user_id = :user_id AND t.is_archived = TRUE AND tm.role = 'owner'
        ORDER BY t.updated_at DESC NULLS LAST, t.track_id DESC
    """), {'user_id': user_id})
    return [dict(r._mapping) for r in result.fetchall()]
