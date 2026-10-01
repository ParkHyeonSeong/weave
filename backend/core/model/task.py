from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from core.query.filter_builder import build_where, build_order


async def next_display_number(branch_id: int, db: AsyncSession) -> int:
    """Branch별 task 번호 원자적 증가.

    단일 upsert로 처리해, task_sequence 행이 없던 Branch(레거시)에서 두 요청이 동시에
    첫 task를 만들 때도 INSERT 경합으로 500이 나지 않게 한다(LOG-17). 행이 없으면 1을
    넣고, 있으면 +1 — ON CONFLICT가 행 잠금을 잡아 동시 호출은 직렬화되며 서로 다른
    번호를 받는다.
    """
    result = await db.execute(text("""
        INSERT INTO task_sequence (branch_id, last_number)
        VALUES (:branch_id, 1)
        ON CONFLICT (branch_id) DO UPDATE SET last_number = task_sequence.last_number + 1
        RETURNING last_number
    """), {'branch_id': branch_id})
    return result.scalar_one()


async def create(branch_id: int, display_number: int, title: str,
                 description: str, task_type: str, status: str, priority: str,
                 epic_id, sprint_id, parent_task_id,
                 start_date, due_date, created_by: int, db: AsyncSession,
                 custom_fields: dict = None) -> int:
    """Task 생성"""
    import json
    cf_json = json.dumps(custom_fields) if custom_fields else '{}'

    # 같은 컨테이너(sprint/backlog) 내 마지막 sort_order 조회
    max_row = await db.execute(text("""
        SELECT COALESCE(MAX(sort_order), -1) AS max_sort
        FROM task
        WHERE branch_id = :branch_id
          AND sprint_id IS NOT DISTINCT FROM :sprint_id
    """), {'branch_id': branch_id, 'sprint_id': sprint_id})
    next_sort = max_row.scalar_one() + 1

    result = await db.execute(text("""
        INSERT INTO task (branch_id, display_number, title, description,
                          task_type, status, priority, epic_id, sprint_id,
                          parent_task_id, start_date, due_date, created_by,
                          custom_fields, sort_order)
        VALUES (:branch_id, :display_number, :title, :description,
                :task_type, :status, :priority, :epic_id, :sprint_id,
                :parent_task_id, :start_date, :due_date, :created_by,
                :custom_fields, :sort_order)
        RETURNING task_id
    """), {
        'branch_id': branch_id,
        'display_number': display_number,
        'title': title,
        'description': description,
        'task_type': task_type,
        'status': status,
        'priority': priority,
        'epic_id': epic_id,
        'sprint_id': sprint_id,
        'parent_task_id': parent_task_id,
        'start_date': start_date,
        'due_date': due_date,
        'created_by': created_by,
        'custom_fields': cf_json,
        'sort_order': next_sort,
    })
    return result.scalar_one()


async def find_by_id(task_id: int, db: AsyncSession):
    """Task 상세 조회 (라벨, 담당자, 에픽, 스프린트 정보 포함)"""
    result = await db.execute(text("""
        SELECT t.task_id, t.branch_id, t.display_number, t.title, t.description,
               t.task_type, t.status, t.priority,
               t.epic_id, t.sprint_id, t.parent_task_id,
               t.start_date, t.due_date, t.sort_order,
               t.created_by, t.created_at, t.updated_at,
               t.custom_fields,
               b.key AS branch_key,
               e.epic_name,
               s.sprint_name,
               (SELECT COUNT(*) FROM task_issue ti WHERE ti.task_id = t.task_id) AS issue_count,
               cu.username AS creator_username,
               cu.avatar_url AS creator_avatar_url,
               cu.avatar_color AS creator_avatar_color
        FROM task t
        INNER JOIN branch b ON t.branch_id = b.branch_id
        LEFT JOIN epic e ON t.epic_id = e.epic_id
        LEFT JOIN sprint s ON t.sprint_id = s.sprint_id
        LEFT JOIN "user" cu ON t.created_by = cu.user_id
        WHERE t.task_id = :task_id
    """), {'task_id': task_id})
    row = result.fetchone()
    if not row:
        return None

    task = dict(row._mapping)
    task['display_id'] = f"{task['branch_key']}-{task['display_number']}"

    # creator 중첩 객체 구성 — JOIN에서 user 못 찾으면 (soft-delete 등) creator=None 처리
    creator_username = task.pop('creator_username', None)
    creator_avatar_url = task.pop('creator_avatar_url', None)
    creator_avatar_color = task.pop('creator_avatar_color', None)
    task['creator'] = {
        'user_id': task['created_by'],
        'username': creator_username,
        'avatar_url': creator_avatar_url,
        'avatar_color': creator_avatar_color,
    } if task['created_by'] and creator_username else None

    # 라벨 조회
    labels_result = await db.execute(text("""
        SELECT l.label_id, l.label_name, l.color
        FROM task_label tl
        INNER JOIN label l ON tl.label_id = l.label_id
        WHERE tl.task_id = :task_id
        ORDER BY l.label_name
    """), {'task_id': task_id})
    task['labels'] = [dict(r._mapping) for r in labels_result.fetchall()]

    # 담당자 조회
    assignees_result = await db.execute(text("""
        SELECT ta.user_id, u.username, u.avatar_url, u.avatar_color, ta.role
        FROM task_assignee ta
        INNER JOIN "user" u ON ta.user_id = u.user_id
        WHERE ta.task_id = :task_id
          AND u.deleted_at IS NULL
        ORDER BY ta.role, u.username
    """), {'task_id': task_id})
    task['assignees'] = [dict(r._mapping) for r in assignees_result.fetchall()]

    return task


async def find_by_branch(branch_id: int, sprint_id, db: AsyncSession):
    """Branch의 Task 목록 (Tasks 탭용, sprint_id 필터 가능)"""
    if sprint_id is not None:
        where_sprint = "AND t.sprint_id = :sprint_id"
        # active sprint이면 done 포함, 아니면 done 제외
        done_filter = ("AND (NOT EXISTS ("
                       "  SELECT 1 FROM workflow_status ws"
                       "  WHERE ws.branch_id = t.branch_id AND ws.key = t.status AND ws.category IN ('done', 'cancelled')"
                       ") OR (SELECT status FROM sprint WHERE sprint_id = :sprint_id) = 'active')")
        params = {'branch_id': branch_id, 'sprint_id': sprint_id}
    else:
        where_sprint = "AND t.sprint_id IS NULL"
        done_filter = ("AND NOT EXISTS ("
                       "  SELECT 1 FROM workflow_status ws"
                       "  WHERE ws.branch_id = t.branch_id AND ws.key = t.status AND ws.category IN ('done', 'cancelled')"
                       ")")
        params = {'branch_id': branch_id}

    result = await db.execute(text(f"""
        SELECT t.task_id, t.display_number, t.title,
               t.task_type, t.status, t.priority,
               t.epic_id, t.sprint_id, t.parent_task_id,
               t.start_date, t.due_date, t.sort_order, t.created_at,
               t.custom_fields,
               b.key AS branch_key,
               e.epic_name, e.color AS epic_color,
               (SELECT COUNT(*) FROM task_issue ti WHERE ti.task_id = t.task_id) AS issue_count
        FROM task t
        INNER JOIN branch b ON t.branch_id = b.branch_id
        LEFT JOIN epic e ON t.epic_id = e.epic_id
        WHERE t.branch_id = :branch_id AND t.parent_task_id IS NULL
              {where_sprint} {done_filter}
        ORDER BY t.sort_order, t.created_at, t.task_id
    """), params)
    rows = result.fetchall()
    tasks = []
    for row in rows:
        task = dict(row._mapping)
        task['display_id'] = f"{task['branch_key']}-{task['display_number']}"
        tasks.append(task)

    await _hydrate_labels_assignees(tasks, db)

    await attach_subtasks(tasks, db)
    return tasks


async def _hydrate_labels_assignees(items: list, db: AsyncSession):
    """item 목록에 labels[]/assignees[]를 배치 부착(N+1 금지).

    find_by_branch에서 추출한 공유 헬퍼 — task.query()도 동일 라벨/담당자 형태를 재사용한다.
    items가 비면 no-op.
    """
    if not items:
        return

    task_ids = [t['task_id'] for t in items]

    # 라벨 일괄 조회
    labels_result = await db.execute(text("""
        SELECT tl.task_id, l.label_id, l.label_name, l.color
        FROM task_label tl
        INNER JOIN label l ON tl.label_id = l.label_id
        WHERE tl.task_id = ANY(:task_ids)
        ORDER BY l.label_name
    """), {'task_ids': task_ids})
    label_map = {}
    for lr in labels_result.fetchall():
        ld = dict(lr._mapping)
        label_map.setdefault(ld['task_id'], []).append({
            'label_id': ld['label_id'],
            'label_name': ld['label_name'],
            'color': ld['color'],
        })

    # 담당자 일괄 조회
    assignees_result = await db.execute(text("""
        SELECT ta.task_id, ta.user_id, u.username, u.avatar_url, u.avatar_color, ta.role
        FROM task_assignee ta
        INNER JOIN "user" u ON ta.user_id = u.user_id
        WHERE ta.task_id = ANY(:task_ids)
          AND u.deleted_at IS NULL
        ORDER BY ta.role, u.username
    """), {'task_ids': task_ids})
    assignee_map = {}
    for ar in assignees_result.fetchall():
        ad = dict(ar._mapping)
        assignee_map.setdefault(ad['task_id'], []).append({
            'user_id': ad['user_id'],
            'username': ad['username'],
            'avatar_url': ad.get('avatar_url'),
            'avatar_color': ad.get('avatar_color'),
            'role': ad['role'],
        })

    for task in items:
        task['labels'] = label_map.get(task['task_id'], [])
        task['assignees'] = assignee_map.get(task['task_id'], [])


_GROUPABLE = {"status": "t.status", "priority": "t.priority", "task_type": "t.task_type",
              "epic": "t.epic_id", "sprint": "t.sprint_id"}


async def query(branch_ids, spec, sort, group_by, limit, offset, ctx, db):
    """FilterSpec 기반 순수 task 쿼리(MCP·크로스브랜치·Saved View·Reporting용).

    - 스코프: top-level(parent_task_id IS NULL) + branch_ids IN + FilterSpec WHERE.
    - find_by_branch의 "active sprint면 done 포함" 뷰 규칙은 재현하지 않는다(순수 필터).
    - items 형태: find_by_branch superset(− subtasks) + branch_name/updated_at/custom_fields.
    - total: 같은 WHERE의 별도 COUNT(페이지 무관).
    - groups: 전체 매칭 집계(스칼라 5개만; 그 외 None).
    """
    where_sql, params = build_where(spec, ctx)
    order_sql = build_order(sort)
    params.update({"branch_ids": list(branch_ids), "limit": limit, "offset": offset})
    # rows/COUNT/groups가 공유하는 스코프 술어(드리프트 방지 — 한 곳에서 정의)
    scope = f"t.branch_id = ANY(:branch_ids) AND t.parent_task_id IS NULL AND ({where_sql})"
    rows = (await db.execute(text(f"""
        SELECT t.task_id, t.branch_id, t.display_number, t.title, t.task_type, t.status, t.priority,
               t.epic_id, t.sprint_id, t.parent_task_id, t.start_date, t.due_date,
               t.sort_order, t.created_at, t.updated_at, t.custom_fields,
               b.key AS branch_key, b.branch_name, b.color AS branch_color, b.icon AS branch_icon,
               e.epic_name, e.color AS epic_color,
               ws.label AS status_label, ws.color AS status_color, ws.category AS status_category,
               (SELECT COUNT(*) FROM task_issue ti WHERE ti.task_id = t.task_id) AS issue_count
        FROM task t
        INNER JOIN branch b ON t.branch_id = b.branch_id
        LEFT JOIN epic e ON t.epic_id = e.epic_id
        LEFT JOIN workflow_status ws ON ws.branch_id = t.branch_id AND ws.key = t.status
        WHERE {scope}
        ORDER BY {order_sql}
        LIMIT :limit OFFSET :offset
    """), params)).fetchall()
    items = [dict(r._mapping) for r in rows]
    for it in items:
        it["display_id"] = f"{it['branch_key']}-{it['display_number']}"
    await _hydrate_labels_assignees(items, db)

    count_params = {k: v for k, v in params.items() if k not in ("limit", "offset")}
    total = (await db.execute(text(f"""
        SELECT COUNT(*) FROM task t WHERE {scope}
    """), count_params)).scalar_one()

    groups = None
    if group_by in _GROUPABLE:
        gcol = _GROUPABLE[group_by]
        grows = (await db.execute(text(f"""
            SELECT {gcol} AS key, COUNT(*) AS count FROM task t
            WHERE {scope}
            GROUP BY {gcol}
        """), count_params)).fetchall()
        groups = [{"key": r._mapping["key"], "count": r._mapping["count"]} for r in grows]

    return {"items": items, "total": total, "groups": groups}


async def find_for_board(branch_id: int, sprint_id, db: AsyncSession):
    """Board 탭용 Task 목록"""
    params = {'branch_id': branch_id}
    if sprint_id is not None:
        where_sprint = "AND t.sprint_id = :sprint_id"
        params['sprint_id'] = sprint_id
    else:
        # sprint_id 미지정 시 모든 active sprint의 task 조회
        where_sprint = "AND t.sprint_id IN (SELECT sprint_id FROM sprint WHERE branch_id = :branch_id AND status = 'active')"

    # epic_id·due_date·created_at은 보드의 에픽 필터·카드 마감/에픽 칩·마감일/생성일 정렬이 읽는다
    # (frontend/library/filterSpec.js LEAF, taskViewState.js val) — 빼면 에픽 필터가 모든 카드를 숨긴다
    result = await db.execute(text(f"""
        SELECT t.task_id, t.display_number, t.title,
               t.task_type, t.status, t.priority,
               t.epic_id, t.due_date,
               t.sort_order, t.created_at, t.custom_fields,
               b.key AS branch_key
        FROM task t
        INNER JOIN branch b ON t.branch_id = b.branch_id
        WHERE t.branch_id = :branch_id AND t.parent_task_id IS NULL
              {where_sprint}
        ORDER BY t.sort_order, t.created_at, t.task_id
    """), params)
    rows = result.fetchall()
    tasks = []
    for row in rows:
        task = dict(row._mapping)
        task['display_id'] = f"{task['branch_key']}-{task['display_number']}"
        tasks.append(task)

    if tasks:
        task_ids = [t['task_id'] for t in tasks]

        # 라벨 일괄 조회
        labels_result = await db.execute(text("""
            SELECT tl.task_id, l.label_id, l.label_name, l.color
            FROM task_label tl
            INNER JOIN label l ON tl.label_id = l.label_id
            WHERE tl.task_id = ANY(:task_ids)
        """), {'task_ids': task_ids})
        label_map = {}
        for lr in labels_result.fetchall():
            ld = dict(lr._mapping)
            label_map.setdefault(ld['task_id'], []).append({
                'label_id': ld['label_id'],
                'label_name': ld['label_name'],
                'color': ld['color'],
            })

        # 담당자 일괄 조회
        assignees_result = await db.execute(text("""
            SELECT ta.task_id, ta.user_id, u.username, u.avatar_url, u.avatar_color, ta.role
            FROM task_assignee ta
            INNER JOIN "user" u ON ta.user_id = u.user_id
            WHERE ta.task_id = ANY(:task_ids)
              AND u.deleted_at IS NULL
            ORDER BY ta.role, u.username
        """), {'task_ids': task_ids})
        assignee_map = {}
        for ar in assignees_result.fetchall():
            ad = dict(ar._mapping)
            assignee_map.setdefault(ad['task_id'], []).append({
                'user_id': ad['user_id'],
                'username': ad['username'],
                'avatar_url': ad.get('avatar_url'),
                'avatar_color': ad.get('avatar_color'),
                'role': ad['role'],
            })

        for task in tasks:
            task['labels'] = label_map.get(task['task_id'], [])
            task['assignees'] = assignee_map.get(task['task_id'], [])

    await attach_subtasks(tasks, db)
    return tasks


async def attach_subtasks(tasks: list, db: AsyncSession):
    """상위 task 목록에 subtasks[] + subtask_progress{done,total}를 배치 부착.

    parent_task_id = ANY(:ids) 단일 쿼리로 모든 하위를 가져와 부모별로 그룹핑한다
    (per-parent find_subtasks = N+1 금지). 하위 행에 라벨/담당자도 배치 조인.
    progress: total = category != 'cancelled' 개수, done = category = 'done' 개수
    (cancelled은 분자·분모 모두 제외).
    """
    for t in tasks:
        t['subtasks'] = []
        t['subtask_progress'] = {'done': 0, 'total': 0}
    if not tasks:
        return

    parent_ids = [t['task_id'] for t in tasks]
    result = await db.execute(text("""
        SELECT t.task_id, t.branch_id, t.parent_task_id, t.display_number,
               t.title, t.task_type, t.status, t.priority,
               t.epic_id, t.due_date, t.sort_order, t.created_at,
               b.key AS branch_key,
               ws.category AS status_category,
               (SELECT COUNT(*) FROM task_issue ti WHERE ti.task_id = t.task_id) AS issue_count
        FROM task t
        INNER JOIN branch b ON t.branch_id = b.branch_id
        LEFT JOIN workflow_status ws ON ws.branch_id = t.branch_id AND ws.key = t.status
        WHERE t.parent_task_id = ANY(:parent_ids)
        ORDER BY t.sort_order, t.created_at, t.task_id
    """), {'parent_ids': parent_ids})
    sub_rows = result.fetchall()
    if not sub_rows:
        return

    subs = []
    sub_ids = []
    for row in sub_rows:
        s = dict(row._mapping)
        s['display_id'] = f"{s['branch_key']}-{s['display_number']}"
        subs.append(s)
        sub_ids.append(s['task_id'])

    # 라벨 일괄 조회
    labels_result = await db.execute(text("""
        SELECT tl.task_id, l.label_id, l.label_name, l.color
        FROM task_label tl
        INNER JOIN label l ON tl.label_id = l.label_id
        WHERE tl.task_id = ANY(:sub_ids)
        ORDER BY l.label_name
    """), {'sub_ids': sub_ids})
    label_map = {}
    for lr in labels_result.fetchall():
        ld = dict(lr._mapping)
        label_map.setdefault(ld['task_id'], []).append({
            'label_id': ld['label_id'],
            'label_name': ld['label_name'],
            'color': ld['color'],
        })

    # 담당자 일괄 조회
    assignees_result = await db.execute(text("""
        SELECT ta.task_id, ta.user_id, u.username, u.avatar_url, u.avatar_color, ta.role
        FROM task_assignee ta
        INNER JOIN "user" u ON ta.user_id = u.user_id
        WHERE ta.task_id = ANY(:sub_ids)
          AND u.deleted_at IS NULL
        ORDER BY ta.role, u.username
    """), {'sub_ids': sub_ids})
    assignee_map = {}
    for ar in assignees_result.fetchall():
        ad = dict(ar._mapping)
        assignee_map.setdefault(ad['task_id'], []).append({
            'user_id': ad['user_id'],
            'username': ad['username'],
            'avatar_url': ad.get('avatar_url'),
            'avatar_color': ad.get('avatar_color'),
            'role': ad['role'],
        })

    # 부모별 그룹핑 + 진행도 집계
    groups = {}
    progress = {}
    for s in subs:
        pid = s['parent_task_id']
        category = s.pop('status_category', None)
        s.pop('branch_key', None)
        s.pop('sort_order', None)
        s.pop('created_at', None)
        s['labels'] = label_map.get(s['task_id'], [])
        s['assignees'] = assignee_map.get(s['task_id'], [])
        groups.setdefault(pid, []).append(s)
        prog = progress.setdefault(pid, {'done': 0, 'total': 0})
        if category != 'cancelled':
            prog['total'] += 1
            if category == 'done':
                prog['done'] += 1

    for t in tasks:
        t['subtasks'] = groups.get(t['task_id'], [])
        t['subtask_progress'] = progress.get(t['task_id'], {'done': 0, 'total': 0})


async def find_by_epic(epic_id: int, branch_id: int, db: AsyncSession):
    """Epic에 속한 Task 목록 (간략)"""
    result = await db.execute(text("""
        SELECT t.task_id, t.display_number, t.title,
               t.task_type, t.status, t.priority,
               t.sort_order, t.created_at, t.due_date,
               b.key AS branch_key
        FROM task t
        INNER JOIN branch b ON t.branch_id = b.branch_id
        WHERE t.epic_id = :epic_id AND t.branch_id = :branch_id
              AND t.parent_task_id IS NULL
        ORDER BY t.sort_order, t.created_at, t.task_id
    """), {'epic_id': epic_id, 'branch_id': branch_id})
    rows = result.fetchall()
    tasks = []
    for row in rows:
        task = dict(row._mapping)
        task['display_id'] = f"{task['branch_key']}-{task['display_number']}"
        tasks.append(task)
    return tasks


async def find_archived(branch_id: int, db: AsyncSession):
    """Branch의 완료된(done) Task 목록 (Archive 탭용)"""
    params = {'branch_id': branch_id}

    result = await db.execute(text("""
        SELECT t.task_id, t.display_number, t.title,
               t.task_type, t.status, t.priority,
               t.epic_id, t.sprint_id, t.parent_task_id,
               t.start_date, t.due_date, t.sort_order,
               t.created_at, t.updated_at,
               b.key AS branch_key,
               e.epic_name, e.color AS epic_color,
               s.sprint_name
        FROM task t
        INNER JOIN branch b ON t.branch_id = b.branch_id
        LEFT JOIN epic e ON t.epic_id = e.epic_id
        LEFT JOIN sprint s ON t.sprint_id = s.sprint_id
        WHERE t.branch_id = :branch_id AND t.parent_task_id IS NULL
              AND EXISTS (
                  SELECT 1 FROM workflow_status ws
                  WHERE ws.branch_id = t.branch_id AND ws.key = t.status AND ws.category IN ('done', 'cancelled')
              )
        ORDER BY t.updated_at DESC NULLS LAST, t.created_at DESC
    """), params)
    rows = result.fetchall()
    tasks = []
    for row in rows:
        task = dict(row._mapping)
        task['display_id'] = f"{task['branch_key']}-{task['display_number']}"
        tasks.append(task)

    if tasks:
        task_ids = [t['task_id'] for t in tasks]

        # 라벨 일괄 조회
        labels_result = await db.execute(text("""
            SELECT tl.task_id, l.label_id, l.label_name, l.color
            FROM task_label tl
            INNER JOIN label l ON tl.label_id = l.label_id
            WHERE tl.task_id = ANY(:task_ids)
            ORDER BY l.label_name
        """), {'task_ids': task_ids})
        label_map = {}
        for lr in labels_result.fetchall():
            ld = dict(lr._mapping)
            label_map.setdefault(ld['task_id'], []).append({
                'label_id': ld['label_id'],
                'label_name': ld['label_name'],
                'color': ld['color'],
            })

        # 담당자 일괄 조회
        assignees_result = await db.execute(text("""
            SELECT ta.task_id, ta.user_id, u.username, u.avatar_url, u.avatar_color, ta.role
            FROM task_assignee ta
            INNER JOIN "user" u ON ta.user_id = u.user_id
            WHERE ta.task_id = ANY(:task_ids)
              AND u.deleted_at IS NULL
            ORDER BY ta.role, u.username
        """), {'task_ids': task_ids})
        assignee_map = {}
        for ar in assignees_result.fetchall():
            ad = dict(ar._mapping)
            assignee_map.setdefault(ad['task_id'], []).append({
                'user_id': ad['user_id'],
                'username': ad['username'],
                'avatar_url': ad.get('avatar_url'),
                'avatar_color': ad.get('avatar_color'),
                'role': ad['role'],
            })

        for task in tasks:
            task['labels'] = label_map.get(task['task_id'], [])
            task['assignees'] = assignee_map.get(task['task_id'], [])

    return tasks


async def find_subtasks(parent_task_id: int, db: AsyncSession):
    """하위 Task 목록 (라벨 + 담당자 포함, get_detail Subtasks 섹션용)"""
    result = await db.execute(text("""
        SELECT t.task_id, t.branch_id, t.parent_task_id, t.display_number, t.title,
               t.task_type, t.status, t.priority,
               t.sort_order, t.created_at,
               b.key AS branch_key
        FROM task t
        INNER JOIN branch b ON t.branch_id = b.branch_id
        WHERE t.parent_task_id = :parent_task_id
        ORDER BY t.sort_order, t.created_at, t.task_id
    """), {'parent_task_id': parent_task_id})
    rows = result.fetchall()
    tasks = []
    for row in rows:
        task = dict(row._mapping)
        task['display_id'] = f"{task['branch_key']}-{task['display_number']}"
        tasks.append(task)

    if tasks:
        task_ids = [t['task_id'] for t in tasks]

        # 라벨 일괄 조회
        labels_result = await db.execute(text("""
            SELECT tl.task_id, l.label_id, l.label_name, l.color
            FROM task_label tl
            INNER JOIN label l ON tl.label_id = l.label_id
            WHERE tl.task_id = ANY(:task_ids)
            ORDER BY l.label_name
        """), {'task_ids': task_ids})
        label_map = {}
        for lr in labels_result.fetchall():
            ld = dict(lr._mapping)
            label_map.setdefault(ld['task_id'], []).append({
                'label_id': ld['label_id'],
                'label_name': ld['label_name'],
                'color': ld['color'],
            })

        # 담당자 일괄 조회
        assignees_result = await db.execute(text("""
            SELECT ta.task_id, ta.user_id, u.username, u.avatar_url, u.avatar_color, ta.role
            FROM task_assignee ta
            INNER JOIN "user" u ON ta.user_id = u.user_id
            WHERE ta.task_id = ANY(:task_ids)
              AND u.deleted_at IS NULL
            ORDER BY ta.role, u.username
        """), {'task_ids': task_ids})
        assignee_map = {}
        for ar in assignees_result.fetchall():
            ad = dict(ar._mapping)
            assignee_map.setdefault(ad['task_id'], []).append({
                'user_id': ad['user_id'],
                'username': ad['username'],
                'avatar_url': ad.get('avatar_url'),
                'avatar_color': ad.get('avatar_color'),
                'role': ad['role'],
            })

        for task in tasks:
            task['labels'] = label_map.get(task['task_id'], [])
            task['assignees'] = assignee_map.get(task['task_id'], [])

    return tasks


async def count_subtasks(parent_task_id: int, db: AsyncSession) -> int:
    """parent_task_id를 부모로 갖는 하위 태스크 개수 (1단계 불변식 검증용)."""
    result = await db.execute(text("""
        SELECT COUNT(*) FROM task WHERE parent_task_id = :parent_task_id
    """), {'parent_task_id': parent_task_id})
    return result.scalar_one()


async def find_parent_summary(task_id: int, db: AsyncSession):
    """하위 Task의 부모 요약(브레드크럼 + 상속 sprint/epic live 조인). top-level이면 None."""
    result = await db.execute(text("""
        SELECT p.task_id, p.display_number, p.title,
               p.sprint_id, p.epic_id,
               b.key AS branch_key,
               s.sprint_name,
               e.epic_name
        FROM task t
        INNER JOIN task p ON t.parent_task_id = p.task_id
        INNER JOIN branch b ON p.branch_id = b.branch_id
        LEFT JOIN sprint s ON p.sprint_id = s.sprint_id
        LEFT JOIN epic e ON p.epic_id = e.epic_id
        WHERE t.task_id = :task_id
    """), {'task_id': task_id})
    row = result.fetchone()
    if not row:
        return None
    parent = dict(row._mapping)
    parent['display_id'] = f"{parent['branch_key']}-{parent['display_number']}"
    return parent


async def update(task_id: int, fields: dict, db: AsyncSession):
    """Task 수정 (동적 필드)"""
    import json
    allowed = {'title', 'description', 'task_type', 'status', 'priority',
               'epic_id', 'sprint_id', 'parent_task_id', 'start_date', 'due_date',
               'sort_order', 'custom_fields'}
    updates = {k: v for k, v in fields.items() if k in allowed}
    if 'custom_fields' in updates and isinstance(updates['custom_fields'], dict):
        updates['custom_fields'] = json.dumps(updates['custom_fields'])
    if not updates:
        return

    set_parts = [f'{k} = :{k}' for k in updates]
    set_parts.append('updated_at = NOW()')
    set_clause = ', '.join(set_parts)
    updates['task_id'] = task_id
    await db.execute(text(f"""
        UPDATE task SET {set_clause} WHERE task_id = :task_id
    """), updates)


async def delete(task_id: int, db: AsyncSession):
    """Task 삭제 (subtask도 CASCADE 삭제)"""
    await db.execute(text("""
        DELETE FROM task WHERE task_id = :task_id
    """), {'task_id': task_id})


async def count_ids_in_branch(branch_id: int, task_ids: list, db: AsyncSession) -> int:
    """task_ids 중 해당 branch에 속하는 (중복 제거된) task 수를 단일 쿼리로 반환.

    cross-branch IDOR 방어용 set-membership 체크. 호출부는 이 값을
    set(task_ids) 크기와 비교해 전부 branch 소속인지 all-or-nothing 판정.
    """
    if not task_ids:
        return 0
    result = await db.execute(text("""
        SELECT COUNT(DISTINCT task_id)
        FROM task
        WHERE branch_id = :branch_id AND task_id = ANY(:task_ids)
    """), {'branch_id': branch_id, 'task_ids': list(task_ids)})
    return result.scalar_one()


async def reorder(branch_id: int, task_ids: list, sprint_id, after_task_id, db: AsyncSession):
    """태스크 이동 + 순서 변경 (다중 지원)
    - task_ids: 이동할 태스크 ID 목록 — 최상위만 유효. 하위태스크는 컨테이너
      위치를 소유하지 않으므로(sprint는 부모 라이브 파생, sort_order는 부모 내
      순서) 섞여 들어와도 조용히 제외한다.
    - sprint_id: 대상 스프린트 (None = backlog)
    - after_task_id: 이 태스크 뒤에 삽입 (None = 맨 위)
    """
    # 0. 하위태스크 제외 — Cmd/Ctrl 다중 선택에 하위가 섞인 드래그 등.
    #    남기면 하위의 sprint_id(stale 재유입)·sort_order(부모 내 순서 오염)를 써버린다.
    result = await db.execute(text("""
        SELECT task_id FROM task
        WHERE task_id = ANY(:ids) AND parent_task_id IS NULL
    """), {'ids': list(task_ids)})
    top_level = {row[0] for row in result.fetchall()}
    task_ids = [tid for tid in task_ids if tid in top_level]
    if not task_ids:
        return

    # 1. 대상 컨테이너의 현재 태스크 순서 조회 (이동할 태스크 제외).
    #    최상위만 — 하위태스크(sprint_id NULL)가 백로그 컨테이너에 섞여
    #    sort_order가 재배열되는 것 방지.
    if sprint_id is not None:
        where = "t.sprint_id = :sprint_id"
        params = {'branch_id': branch_id, 'sprint_id': sprint_id}
    else:
        where = "t.sprint_id IS NULL"
        params = {'branch_id': branch_id}

    result = await db.execute(text(f"""
        SELECT task_id FROM task t
        WHERE t.branch_id = :branch_id AND t.parent_task_id IS NULL AND {where}
        ORDER BY t.sort_order, t.created_at, t.task_id
    """), params)
    existing_ids = [row[0] for row in result.fetchall()]

    # 기존 목록에서 이동할 태스크 제거
    task_id_set = set(task_ids)
    filtered = [tid for tid in existing_ids if tid not in task_id_set]

    # 2. after_task_id 위치 찾기
    if after_task_id is not None and after_task_id in filtered:
        insert_idx = filtered.index(after_task_id) + 1
    else:
        insert_idx = 0

    # 3. 새 순서 조합
    new_order = filtered[:insert_idx] + list(task_ids) + filtered[insert_idx:]

    # 4. sort_order 일괄 업데이트
    for idx, tid in enumerate(new_order):
        await db.execute(text("""
            UPDATE task SET sort_order = :sort_order, updated_at = NOW()
            WHERE task_id = :task_id
        """), {'sort_order': idx, 'task_id': tid})

    # 5. 이동할 태스크의 sprint_id 변경 (parent IS NULL은 0단계 필터의 이중 방어)
    for tid in task_ids:
        await db.execute(text("""
            UPDATE task SET sprint_id = :sprint_id
            WHERE task_id = :task_id AND branch_id = :branch_id
              AND parent_task_id IS NULL
        """), {'sprint_id': sprint_id, 'task_id': tid, 'branch_id': branch_id})



async def move_incomplete(from_sprint_id: int, to_sprint_id, db: AsyncSession) -> int:
    """미완료 task를 다른 sprint로 이동 (to_sprint_id=None이면 backlog)"""
    result = await db.execute(text("""
        UPDATE task t SET sprint_id = :to_sprint_id, updated_at = NOW()
        WHERE t.sprint_id = :from_sprint_id
          AND NOT EXISTS (
              SELECT 1 FROM workflow_status ws
              WHERE ws.branch_id = t.branch_id AND ws.key = t.status AND ws.category IN ('done', 'cancelled')
          )
    """), {'from_sprint_id': from_sprint_id, 'to_sprint_id': to_sprint_id})
    return result.rowcount


async def count_by_sprint_status(sprint_id: int, db: AsyncSession):
    """Sprint 내 완료/미완료 task 수 (workflow_status category 기반)"""
    result = await db.execute(text("""
        SELECT
            COUNT(*) FILTER (WHERE COALESCE(ws.category, 'done') IN ('done', 'cancelled')) AS done_count,
            COUNT(*) FILTER (WHERE COALESCE(ws.category, 'done') NOT IN ('done', 'cancelled')) AS incomplete_count
        FROM task t
        LEFT JOIN workflow_status ws ON t.branch_id = ws.branch_id AND t.status = ws.key
        WHERE t.sprint_id = :sprint_id AND t.parent_task_id IS NULL
    """), {'sprint_id': sprint_id})
    row = result.fetchone()
    return {'done_count': row[0], 'incomplete_count': row[1]}


async def count_by_sprint_for_user(sprint_id: int, branch_id: int, user_id: int, db: AsyncSession):
    """task-counts 응답용 한 번 조회.

    done_count/incomplete_count는 count_by_sprint_status와 같은 상위 태스크 기준이고,
    all_*·my_*는 하위태스크 포함(my_* = main/sub 담당, my_incomplete_count = 그중 미완료).
    all_in_progress_count/all_cancelled_count는 같은 집합의 카테고리별 분해다
    (all_done_count = done + cancelled는 그대로, 알 수 없는 status는 done 취급).
    하위태스크는 sprint_id가 NULL로 저장되고 부모의 sprint를 따르므로 상위 태스크를 먼저 고른 뒤 그 자식을 붙인다
    (idx_task_branch_sprint → idx_task_parent).
    """
    result = await db.execute(text("""
        WITH top AS (
            SELECT task_id, branch_id, status, TRUE AS is_top FROM task
            WHERE branch_id = :branch_id AND sprint_id = :sprint_id AND parent_task_id IS NULL
        ), scoped AS (
            SELECT * FROM top
            UNION ALL
            SELECT c.task_id, c.branch_id, c.status, FALSE FROM task c
            JOIN top ON c.parent_task_id = top.task_id
        ), flagged AS (
            -- task_assignee PK(task_id, user_id)라 LEFT JOIN은 행을 늘리지 않는다
            SELECT s.is_top,
                   COALESCE(ws.category, 'done') IN ('done', 'cancelled') AS closed,
                   COALESCE(ws.category, 'done') AS category,
                   ta.task_id IS NOT NULL AS mine
            FROM scoped s
            LEFT JOIN workflow_status ws ON s.branch_id = ws.branch_id AND s.status = ws.key
            LEFT JOIN task_assignee ta ON ta.task_id = s.task_id AND ta.user_id = :user_id
        )
        SELECT
            COUNT(*) FILTER (WHERE is_top AND closed) AS done_count,
            COUNT(*) FILTER (WHERE is_top AND NOT closed) AS incomplete_count,
            COUNT(*) FILTER (WHERE closed) AS all_done_count,
            COUNT(*) AS all_total_count,
            COUNT(*) FILTER (WHERE category = 'in_progress') AS all_in_progress_count,
            COUNT(*) FILTER (WHERE category = 'cancelled') AS all_cancelled_count,
            COUNT(*) FILTER (WHERE mine) AS my_count,
            COUNT(*) FILTER (WHERE mine AND NOT closed) AS my_incomplete_count
        FROM flagged
    """), {'sprint_id': sprint_id, 'branch_id': branch_id, 'user_id': user_id})
    return dict(result.fetchone()._mapping)


async def search_for_chat(user_id: int, keyword: str, my_only: bool, db: AsyncSession,
                          limit: int = 50, offset: int = 0):
    """채팅용 Task 검색 (접근 가능한 Branch의 Task만)"""
    keyword_like = f'%{keyword}%' if keyword else '%'
    assignee_filter = "AND t.task_id IN (SELECT task_id FROM task_assignee WHERE user_id = :user_id)" if my_only else ""

    # description의 regexp_replace 태그 제거 식은 마이그레이션 054의 함수형 trgm
    # 인덱스(idx_task_desc_trgm)와 글자 그대로 같아야 플래너가 인덱스를 쓴다.
    result = await db.execute(text(f"""
        SELECT DISTINCT t.task_id, t.branch_id, t.parent_task_id, t.display_number, t.title, t.status, t.priority,
               b.key AS branch_key,
               t.updated_at, t.created_at,
               ws.label AS status_label, ws.color AS status_color, ws.category AS status_category,
               CASE
                   -- 입력이 task ID와 정확히 같으면(대소문자 무시) 맨 앞 — 'WV-12'가 부분일치인
                   -- WV-120·WV-121(더 최근 수정) 아래로 묻히지 않게 한다.
                   WHEN LOWER(b.key || '-' || t.display_number::text) = LOWER(:keyword) THEN -1
                   -- (b.key || '-' || display_number) = 'KEY-123' 사용자 노출 task ID
                   WHEN (b.key || '-' || t.display_number::text) ILIKE :keyword_like
                        OR t.display_number::text ILIKE :keyword_like THEN 0
                   WHEN t.title ILIKE :keyword_like THEN 1
                   ELSE 2
               END AS _rank
        FROM task t
        INNER JOIN branch b ON t.branch_id = b.branch_id
        INNER JOIN branch_member bm ON b.branch_id = bm.branch_id AND bm.user_id = :user_id
        LEFT JOIN workflow_status ws ON ws.branch_id = t.branch_id AND ws.key = t.status
        WHERE (
                  t.title ILIKE :keyword_like
                  OR regexp_replace(t.description, '<[^>]+>', ' ', 'g') ILIKE :keyword_like
                  OR (b.key || '-' || t.display_number::text) ILIKE :keyword_like
                  OR t.display_number::text ILIKE :keyword_like
              )
              AND b.is_archived = FALSE
              {assignee_filter}
        ORDER BY _rank, t.updated_at DESC NULLS LAST, t.created_at DESC
        LIMIT :limit OFFSET :offset
    """), {'user_id': user_id, 'keyword_like': keyword_like, 'keyword': keyword or '',
           'limit': max(1, min(limit, 200)), 'offset': max(0, offset)})
    rows = result.fetchall()
    tasks = []
    for row in rows:
        task = dict(row._mapping)
        task.pop('_rank', None)
        task['display_id'] = f"{task['branch_key']}-{task['display_number']}"
        tasks.append(task)

    # 담당자 일괄 조회
    if tasks:
        task_ids = [t['task_id'] for t in tasks]
        assignees_result = await db.execute(text("""
            SELECT ta.task_id, ta.user_id, u.username, u.avatar_url, u.avatar_color, ta.role
            FROM task_assignee ta
            INNER JOIN "user" u ON ta.user_id = u.user_id
            WHERE ta.task_id = ANY(:task_ids)
              AND u.deleted_at IS NULL
            ORDER BY ta.role, u.username
        """), {'task_ids': task_ids})
        assignee_map = {}
        for ar in assignees_result.fetchall():
            ad = dict(ar._mapping)
            assignee_map.setdefault(ad['task_id'], []).append({
                'user_id': ad['user_id'],
                'username': ad['username'],
                'avatar_url': ad.get('avatar_url'),
                'avatar_color': ad.get('avatar_color'),
                'role': ad['role'],
            })
        for task in tasks:
            task['assignees'] = assignee_map.get(task['task_id'], [])

    return tasks


async def find_by_assignee(user_id: int, status: str, status_category: str, priority: str,
                           branch_id: int, sort_by: str, db: AsyncSession):
    """사용자에게 할당된 모든 Task (cross-branch)"""
    filters = []
    params = {'user_id': user_id}

    if status:
        filters.append("AND t.status = :status")
        params['status'] = status
    if status_category:
        filters.append("AND ws.category = :status_category")
        params['status_category'] = status_category
    if priority:
        filters.append("AND t.priority = :priority")
        params['priority'] = priority
    if branch_id:
        filters.append("AND t.branch_id = :branch_id")
        params['branch_id'] = branch_id

    filter_clause = ' '.join(filters)

    order_map = {
        'updated': 't.updated_at DESC NULLS LAST, t.created_at DESC',
        'created': 't.created_at DESC',
        'priority': "CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END, t.updated_at DESC NULLS LAST",
        'due_date': 't.due_date ASC NULLS LAST, t.updated_at DESC NULLS LAST',
    }
    order_clause = order_map.get(sort_by, order_map['updated'])

    result = await db.execute(text(f"""
        SELECT t.task_id, t.branch_id, t.display_number, t.title,
               t.task_type, t.status, t.priority,
               t.start_date, t.due_date, t.updated_at, t.created_at,
               b.key AS branch_key, b.branch_name, b.color AS branch_color, b.icon AS branch_icon,
               ws.label AS status_label, ws.color AS status_color, ws.category AS status_category
        FROM task t
        INNER JOIN branch b ON t.branch_id = b.branch_id
        INNER JOIN branch_member bm ON bm.branch_id = t.branch_id AND bm.user_id = :user_id
        LEFT JOIN workflow_status ws ON ws.branch_id = t.branch_id AND ws.key = t.status
        WHERE t.task_id IN (SELECT task_id FROM task_assignee WHERE user_id = :user_id)
              AND b.is_archived = FALSE
              {filter_clause}
        ORDER BY {order_clause}
    """), params)

    rows = result.fetchall()
    tasks = []
    for row in rows:
        task = dict(row._mapping)
        task['display_id'] = f"{task['branch_key']}-{task['display_number']}"
        tasks.append(task)

    if tasks:
        task_ids = [t['task_id'] for t in tasks]

        # 담당자 일괄 조회
        assignees_result = await db.execute(text("""
            SELECT ta.task_id, ta.user_id, u.username, u.avatar_url, u.avatar_color, ta.role
            FROM task_assignee ta
            INNER JOIN "user" u ON ta.user_id = u.user_id
            WHERE ta.task_id = ANY(:task_ids)
              AND u.deleted_at IS NULL
            ORDER BY ta.role, u.username
        """), {'task_ids': task_ids})
        assignee_map = {}
        for ar in assignees_result.fetchall():
            ad = dict(ar._mapping)
            assignee_map.setdefault(ad['task_id'], []).append({
                'user_id': ad['user_id'],
                'username': ad['username'],
                'avatar_url': ad.get('avatar_url'),
                'avatar_color': ad.get('avatar_color'),
                'role': ad['role'],
            })

        # 라벨 일괄 조회
        labels_result = await db.execute(text("""
            SELECT tl.task_id, l.label_id, l.label_name, l.color
            FROM task_label tl
            INNER JOIN label l ON tl.label_id = l.label_id
            WHERE tl.task_id = ANY(:task_ids)
        """), {'task_ids': task_ids})
        label_map = {}
        for lr in labels_result.fetchall():
            ld = dict(lr._mapping)
            label_map.setdefault(ld['task_id'], []).append({
                'label_id': ld['label_id'],
                'label_name': ld['label_name'],
                'color': ld['color'],
            })

        for task in tasks:
            task['assignees'] = assignee_map.get(task['task_id'], [])
            task['labels'] = label_map.get(task['task_id'], [])

    return tasks


async def count_label_ids_in_branch(branch_id: int, label_ids: list, db: AsyncSession) -> int:
    """label_ids 중 해당 branch 소속(중복 제거) 라벨 수. cross-branch IDOR 방어.

    반환값은 COUNT(DISTINCT)이므로 호출부는 **dedupe된 입력**의 len과 비교할 것
    (all-or-nothing). 예: count == len(list(dict.fromkeys(label_ids))).
    """
    if not label_ids:
        return 0
    result = await db.execute(text("""
        SELECT COUNT(DISTINCT label_id)
        FROM label
        WHERE branch_id = :branch_id AND label_id = ANY(:label_ids)
    """), {'branch_id': branch_id, 'label_ids': list(label_ids)})
    return result.scalar_one()


async def set_labels(task_id: int, label_ids: list, db: AsyncSession):
    """Task 라벨 전체 교체"""
    await db.execute(text("""
        DELETE FROM task_label WHERE task_id = :task_id
    """), {'task_id': task_id})
    for label_id in dict.fromkeys(label_ids):  # 순서 보존 dedupe (PK 위반 방지)
        await db.execute(text("""
            INSERT INTO task_label (task_id, label_id) VALUES (:task_id, :label_id)
        """), {'task_id': task_id, 'label_id': label_id})


async def add_label(task_id: int, label_id: int, db: AsyncSession):
    """단일 라벨 추가(기존 라벨 유지). 멱등."""
    await db.execute(text("""
        INSERT INTO task_label (task_id, label_id) VALUES (:task_id, :label_id)
        ON CONFLICT (task_id, label_id) DO NOTHING
    """), {'task_id': task_id, 'label_id': label_id})


async def remove_label(task_id: int, label_id: int, db: AsyncSession):
    """단일 라벨 제거."""
    await db.execute(text("""
        DELETE FROM task_label WHERE task_id = :task_id AND label_id = :label_id
    """), {'task_id': task_id, 'label_id': label_id})


async def merge_custom_field(task_id: int, field_id: int, value, db: AsyncSession):
    """custom_fields JSONB에서 한 키만 원자적으로 병합/삭제(나머지 키 보존). value=None이면 키 제거.

    단일 UPDATE의 JSONB 연산(`||` / `-`)으로 처리해 read-modify-write 경쟁
    (동시에 다른 키를 set할 때 한쪽이 유실되는 문제)을 피한다.
    """
    import json
    key = str(field_id)
    if value is None:
        await db.execute(text("""
            UPDATE task
            SET custom_fields = COALESCE(custom_fields, '{}'::jsonb) - CAST(:key AS text),
                updated_at = NOW()
            WHERE task_id = :task_id
        """), {'task_id': task_id, 'key': key})
    else:
        await db.execute(text("""
            UPDATE task
            SET custom_fields = COALESCE(custom_fields, '{}'::jsonb)
                                || jsonb_build_object(CAST(:key AS text), CAST(:val AS jsonb)),
                updated_at = NOW()
            WHERE task_id = :task_id
        """), {'task_id': task_id, 'key': key, 'val': json.dumps(value)})


async def batch_statuses(task_ids: list[int], user_id: int, db: AsyncSession) -> dict:
    """Ref 상태 배치 조회 (task_id → status/title/display_id + workflow info), 멤버인 branch만"""
    if not task_ids:
        return {}
    result = await db.execute(text("""
        SELECT t.task_id, t.status, t.title,
               b.key || '-' || t.display_number::text AS display_id,
               ws.label AS status_label, ws.color AS status_color, ws.category AS status_category
        FROM task t
        INNER JOIN branch_member bm ON bm.branch_id = t.branch_id AND bm.user_id = :user_id
        INNER JOIN branch b ON b.branch_id = t.branch_id
        LEFT JOIN workflow_status ws ON ws.branch_id = t.branch_id AND ws.key = t.status
        WHERE t.task_id = ANY(:ids)
          AND b.is_archived = FALSE
    """), {'ids': task_ids, 'user_id': user_id})
    out = {}
    for r in result.fetchall():
        row = dict(r._mapping)
        out[str(row['task_id'])] = {
            'status': row['status'],
            'title': row['title'],
            'display_id': row['display_id'],
            'status_label': row.get('status_label'),
            'status_color': row.get('status_color'),
            'status_category': row.get('status_category'),
        }
    return out


async def find_for_calendar(branch_id: int, range_start, range_end, db: AsyncSession):
    """캘린더 표시용 Task 목록 (start_date 또는 due_date가 범위에 포함)"""
    result = await db.execute(text("""
        SELECT t.task_id, t.display_number, t.title,
               t.task_type, t.status, t.priority,
               t.start_date, t.due_date,
               b.key AS branch_key,
               ws.label AS status_label, ws.color AS status_color, ws.category AS status_category
        FROM task t
        INNER JOIN branch b ON t.branch_id = b.branch_id
        LEFT JOIN workflow_status ws ON ws.branch_id = t.branch_id AND ws.key = t.status
        WHERE t.branch_id = :branch_id
          AND t.parent_task_id IS NULL
          AND (
            (t.start_date IS NOT NULL AND t.start_date <= :range_end AND t.start_date >= :range_start)
            OR (t.due_date IS NOT NULL AND t.due_date <= :range_end AND t.due_date >= :range_start)
          )
        ORDER BY COALESCE(t.start_date, t.due_date), t.created_at
    """), {'branch_id': branch_id, 'range_start': range_start, 'range_end': range_end})
    rows = result.fetchall()
    tasks = []
    for row in rows:
        task = dict(row._mapping)
        task['display_id'] = f"{task['branch_key']}-{task['display_number']}"
        tasks.append(task)
    return tasks


async def set_assignees(task_id: int, main_user_id, sub_user_ids: list, db: AsyncSession):
    """Task 담당자 전체 교체 (메인 1명 + 서브 N명).

    sub 중복과 main 중복을 제거해 (task_id, user_id) PK 위반을 방지한다(main 우선).
    """
    await db.execute(text("""
        DELETE FROM task_assignee WHERE task_id = :task_id
    """), {'task_id': task_id})
    if main_user_id:
        await db.execute(text("""
            INSERT INTO task_assignee (task_id, user_id, role) VALUES (:task_id, :user_id, 'main')
        """), {'task_id': task_id, 'user_id': main_user_id})
    for sub_id in dict.fromkeys(sub_user_ids):  # 순서 보존 dedupe
        if sub_id == main_user_id:
            continue  # main으로 이미 추가됨 (main 우선)
        await db.execute(text("""
            INSERT INTO task_assignee (task_id, user_id, role) VALUES (:task_id, :user_id, 'sub')
        """), {'task_id': task_id, 'user_id': sub_id})


async def upsert_assignee(task_id: int, user_id: int, role: str, db: AsyncSession):
    """담당자 1명 추가/role 갱신(멱등)."""
    await db.execute(text("""
        INSERT INTO task_assignee (task_id, user_id, role) VALUES (:task_id, :user_id, :role)
        ON CONFLICT (task_id, user_id) DO UPDATE SET role = EXCLUDED.role
    """), {'task_id': task_id, 'user_id': user_id, 'role': role})


async def remove_assignee(task_id: int, user_id: int, db: AsyncSession):
    """담당자 1명 제거."""
    await db.execute(text("""
        DELETE FROM task_assignee WHERE task_id = :task_id AND user_id = :user_id
    """), {'task_id': task_id, 'user_id': user_id})


async def remove_main_except(task_id: int, keep_user_id, db: AsyncSession):
    """기존 main 담당자를 제거(결정 B: 새 main 설정 시 기존 main 제거).

    keep_user_id가 현재 main이면 건드리지 않는다(멱등).
    """
    await db.execute(text("""
        DELETE FROM task_assignee
        WHERE task_id = :task_id AND role = 'main' AND user_id != :keep
    """), {'task_id': task_id, 'keep': keep_user_id})


async def find_by_display(branch_id: int, display_number: int, db: AsyncSession):
    """(branch_id, display_number)로 단일 task 조회 — GitHub 참조(WV-123) 해석용.

    branch_key는 호출부가 이미 branch_id로 변환한 뒤이므로 여기선 숫자만 본다.
    display_id를 합성해 반환한다. 미존재 시 None.
    """
    result = await db.execute(text("""
        SELECT t.task_id, t.branch_id, t.display_number, t.title, t.status,
               t.created_by, b.key AS branch_key
        FROM task t
        INNER JOIN branch b ON t.branch_id = b.branch_id
        WHERE t.branch_id = :branch_id AND t.display_number = :display_number
    """), {'branch_id': branch_id, 'display_number': display_number})
    row = result.fetchone()
    if not row:
        return None
    task = dict(row._mapping)
    task['display_id'] = f"{task['branch_key']}-{task['display_number']}"
    return task


async def transition_status(task_id: int, target_key: str,
                            allowed_current_keys: list, db: AsyncSession):
    """원자적 조건부 전이(CAS): 현재 status가 allowed_current_keys에 있을 때만
    target_key로 옮긴다. RETURNING task_id로 실제 이동 여부를 보고한다.

    read-then-update가 아니라 단일 UPDATE의 WHERE가 compare-and-swap을 수행하므로
    처리 중 사람이 옮긴 status를 stale overwrite하지 않는다(전진 전용 보장).
    None = 선조건 불일치/경쟁 패배 → 호출부는 부수효과 없이 skip.
    """
    result = await db.execute(text("""
        UPDATE task SET status = :target_key, updated_at = NOW()
        WHERE task_id = :task_id AND status = ANY(:allowed_current_keys)
        RETURNING task_id
    """), {
        'target_key': target_key,
        'task_id': task_id,
        'allowed_current_keys': list(allowed_current_keys),
    })
    row = result.fetchone()
    return row[0] if row else None
