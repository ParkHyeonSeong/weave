from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from core.errors import error_response, ErrorCode
from core.model import task as task_model
from core.model import branch_member as member_model
from core.model import saved_view as sv_model
from core.model import task_type_config as type_model
from core.model import workflow_status as ws_model
from core.model import recent_view
from core.model import track_scope as track_scope_model
from core.guard.branch_scope import find_resource_in_branch
from core.query.filter_spec import validate_filter, FilterError
from core.query.filter_db import validate_custom_fields
from library import notification_service
from library import activity_service
from library.custom_field_validator import validate_custom_field_values
from library.mention_parser import extract_mention_user_ids
from library.time_context import personal_today
from library.date_validator import is_valid_date_order
from library.html_markdown import ensure_html, html_to_markdown
from library.assignee_cascade import cascade_main_assignee_to_subtasks, main_of


def _collect_assignee_ids(assignees) -> set[int]:
    """AssigneeInput에서 main + sub user_id를 중복 없이 모은다.

    결과는 set-equality 비교에만 쓰이므로 순서는 무의미하다.
    """
    ids = set()
    if assignees.main:
        ids.add(assignees.main)
    ids.update(assignees.sub or [])
    return ids


async def _validate_parent_target(task_id, parent_task_id: int, branch_id: int,
                                  db: AsyncSession):
    """하위로 이동/생성 시 1단계 불변식 검증.

    위반 시 error_response(ErrorCode.X)(status:False + code/category/retryable) 반환
    (라우터 4xx 금지, 호출부에서 status 확인). 통과 시 None.
    parent_task_id is None(승격)인 경우 호출하지 않는다.
    """
    if task_id is not None and parent_task_id == task_id:
        return error_response(ErrorCode.PARENT_SELF)
    parent = await task_model.find_by_id(parent_task_id, db)
    if not parent or parent['branch_id'] != branch_id:
        return error_response(ErrorCode.PARENT_NOT_FOUND)
    if parent['parent_task_id'] is not None:
        return error_response(ErrorCode.PARENT_NOT_TOP_LEVEL)
    # 대상 태스크가 자기 하위를 가지면 하위가 될 수 없음(2단계 방지). 생성 시엔 task_id=None.
    if task_id is not None and await task_model.count_subtasks(task_id, db) > 0:
        return error_response(ErrorCode.TARGET_HAS_SUBTASKS)
    return None


async def _assignees_valid_for_branch(assignees, branch_id: int, db: AsyncSession) -> bool:
    """지정된 모든 담당자가 해당 branch의 멤버인지 검증 (all-or-nothing).

    담당자 없음(빈/None)은 정상으로 간주한다. 비멤버/미존재 user가
    하나라도 섞이면 False.
    """
    assignee_ids = _collect_assignee_ids(assignees)
    if not assignee_ids:
        return True
    valid_ids = await member_model.filter_users_in_branch(branch_id, list(assignee_ids), db)
    return assignee_ids == set(valid_ids)


async def _resolve_status_ref(branch_id: int, value: str, db: AsyncSession):
    """status 문자열(key 또는 label)을 workflow_status row로 해석. 반환 (row, error).

    key는 생성 후 불변·소문자 강제라 strip().lower() 후 exact 매칭이 canonical 경로
    (기존 호출자 쿼리 수 무변화). miss 시에만 label 대소문자 무시 매칭 — 다중 매치는
    hard error, 0건은 유효값 목록 동봉. key 공간이 label 공간보다 우선하므로 어떤
    입력이 status A의 key이자 status B의 label이면 항상 A로 해석된다(결정적,
    AMBIGUOUS는 label 공간 내에서만).
    """
    normalized = value.strip().lower()
    if not normalized:  # 빈 입력이 공백 label에 조용히 매칭되는 것 차단 (별도 fetch로 유효값 동봉)
        statuses = await ws_model.find_by_branch(branch_id, db)
        return None, error_response(
            ErrorCode.INVALID_STATUS,
            valid_statuses=[{'key': s['key'], 'label': s['label']} for s in statuses])
    row = await ws_model.find_by_key(branch_id, normalized, db)
    if row:
        return row, None
    statuses = await ws_model.find_by_branch(branch_id, db)
    matches = [s for s in statuses if s['label'].strip().lower() == normalized]
    if len(matches) == 1:
        return matches[0], None
    if len(matches) > 1:
        return None, error_response(
            ErrorCode.AMBIGUOUS_STATUS,
            candidates=[{'key': s['key'], 'label': s['label']} for s in matches])
    return None, error_response(
        ErrorCode.INVALID_STATUS,
        valid_statuses=[{'key': s['key'], 'label': s['label']} for s in statuses])


async def _resolve_type_ref(branch_id: int, value: str, db: AsyncSession):
    """task_type 문자열(type_key 또는 type_name)을 config row로 해석. 반환 (row, error).

    규칙은 _resolve_status_ref와 동일.
    """
    normalized = value.strip().lower()
    if not normalized:  # 빈 입력이 공백 type_name에 조용히 매칭되는 것 차단 (별도 fetch로 유효값 동봉)
        types = await type_model.find_by_branch(branch_id, db)
        return None, error_response(
            ErrorCode.INVALID_TASK_TYPE,
            valid_task_types=[{'type_key': t['type_key'], 'type_name': t['type_name']}
                              for t in types])
    row = await type_model.find_by_key(branch_id, normalized, db)
    if row:
        return row, None
    types = await type_model.find_by_branch(branch_id, db)
    matches = [t for t in types if t['type_name'].strip().lower() == normalized]
    if len(matches) == 1:
        return matches[0], None
    if len(matches) > 1:
        return None, error_response(
            ErrorCode.AMBIGUOUS_TASK_TYPE,
            candidates=[{'type_key': t['type_key'], 'type_name': t['type_name']}
                        for t in matches])
    return None, error_response(
        ErrorCode.INVALID_TASK_TYPE,
        valid_task_types=[{'type_key': t['type_key'], 'type_name': t['type_name']}
                          for t in types])


async def create(body, branch_id: int, request: Request, db: AsyncSession):
    """Task 생성"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return error_response(ErrorCode.NOT_BRANCH_MEMBER)

    # markdown ingress 휴리스틱 (§3.4) — 태그 없으면 md→HTML 변환 후 저장
    if body.description:
        body.description = ensure_html(body.description)

    # task_type 해석 — 생략 시 branch 기본값(sort_order 첫 번째), 문자열이면 key/label 해석.
    if body.task_type is None:
        valid_type = await type_model.find_first(branch_id, db)
        if not valid_type:  # 0건 가드 — status 가드와 대칭 방어(마이그레이션 유래는 없음)
            return error_response(ErrorCode.INVALID_TASK_TYPE, valid_task_types=[])
    else:
        valid_type, err = await _resolve_type_ref(branch_id, body.task_type, db)
        if err:
            return err

    # status 해석 — 생략 시 branch 기본값(is_default 우선), 문자열이면 key/label 해석.
    # 0건 가드 필수: 마이그레이션 024가 아카이브 branch를 시딩에서 제외했고 restore는
    # 재시딩하지 않아 status 0건 branch가 실존 — None 역참조 500 금지, 200 에러 유지.
    if body.status is None:
        valid_status = await ws_model.find_default(branch_id, db)
        if not valid_status:
            return error_response(ErrorCode.INVALID_STATUS, valid_statuses=[])
    else:
        valid_status, err = await _resolve_status_ref(branch_id, body.status, db)
        if err:
            return err

    task_type_key = valid_type['type_key']
    status_key = valid_status['key']

    # 날짜 순서 검증 (시작일 <= 마감일)
    if not is_valid_date_order(body.start_date, body.due_date):
        return error_response(ErrorCode.INVALID_DATE_RANGE)

    # 담당자 소속 검증 (모든 담당자가 branch 멤버여야 함)
    if body.assignees and not await _assignees_valid_for_branch(body.assignees, branch_id, db):
        return error_response(ErrorCode.INVALID_ASSIGNEE)

    # 하위 생성: 부모가 top-level·동일 branch인지 검증 (1단계 불변식). sprint/epic은 복사 X(§4).
    if body.parent_task_id is not None:
        err = await _validate_parent_target(None, body.parent_task_id, branch_id, db)
        if err:
            return err

    # 라벨 branch 소속 검증 (task 생성 전 — 실패 시 task가 남지 않도록)
    unique_label_ids = list(dict.fromkeys(body.label_ids)) if body.label_ids else []
    if unique_label_ids and await task_model.count_label_ids_in_branch(
            branch_id, unique_label_ids, db) != len(unique_label_ids):
        return error_response(ErrorCode.LABEL_NOT_FOUND)

    # custom_fields lenient 검증 (task 생성 전; 위에서 검증된 valid_type 재사용)
    if body.custom_fields:
        verr = await validate_custom_field_values(
            valid_type['type_id'], body.custom_fields, db, strict=False)
        if verr:
            return error_response(verr)

    # display_number 발급
    display_number = await task_model.next_display_number(branch_id, db)

    task_id = await task_model.create(
        branch_id=branch_id,
        display_number=display_number,
        title=body.title,
        description=body.description,
        task_type=task_type_key,
        status=status_key,
        priority=body.priority,
        # 하위로 생성 시 sprint/epic은 저장하지 않는다 — 부모 라이브 파생 불변식(§4)
        epic_id=None if body.parent_task_id is not None else body.epic_id,
        sprint_id=None if body.parent_task_id is not None else body.sprint_id,
        parent_task_id=body.parent_task_id,
        start_date=body.start_date,
        due_date=body.due_date,
        created_by=user_id,
        db=db,
        custom_fields=body.custom_fields,
    )

    # 라벨 할당 (위에서 검증/dedupe 완료)
    if unique_label_ids:
        await task_model.set_labels(task_id, unique_label_ids, db)

    # 담당자 할당
    if body.assignees:
        await task_model.set_assignees(task_id, body.assignees.main, body.assignees.sub or [], db)

    # description 멘션 알림
    mentioned = extract_mention_user_ids(body.description)
    if mentioned:
        username = request.state.payload.get('username', '')
        prefix = f'{task_type_key.upper()}-{display_number}'
        link = f'/branch/{branch_id}/task/{task_id}'
        await notification_service.notify_bulk(
            mentioned, 'mention', user_id,
            f'{username}님이 {prefix} {body.title}에서 회원님을 멘션했습니다',
            link, 'task', task_id, db,
        )

    # 활동 로그
    await activity_service.log_task_created(task_id, branch_id, user_id, db)

    return {'status': True, 'task_id': task_id, 'display_number': display_number,
            'applied_status': status_key, 'applied_task_type': task_type_key}


async def get_detail(task_id: int, branch_id: int, request: Request, db: AsyncSession,
                     fmt: str = 'html'):
    """Task 상세"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return error_response(ErrorCode.NOT_BRANCH_MEMBER)

    task = await task_model.find_by_id(task_id, db)
    if not task or task['branch_id'] != branch_id:
        return error_response(ErrorCode.TASK_NOT_FOUND)

    # subtask 목록
    subtasks = await task_model.find_subtasks(task_id, db)
    task['subtasks'] = subtasks

    # 하위 Task이면 부모 요약(브레드크럼 + 상속 sprint/epic). top-level이면 None.
    task['parent'] = (
        await task_model.find_parent_summary(task_id, db)
        if task.get('parent_task_id') else None
    )

    if fmt == 'markdown' and task.get('description'):
        task['description'] = html_to_markdown(task['description'])

    # 조회 기록
    await recent_view.upsert(user_id, 'task', task_id, db)

    return {'status': True, 'task': task}


async def get_list(branch_id: int, sprint_id, request: Request, db: AsyncSession):
    """Task 목록 (sprint_id 필터)"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return error_response(ErrorCode.NOT_BRANCH_MEMBER)

    tasks = await task_model.find_by_branch(branch_id, sprint_id, db)
    return {'status': True, 'tasks': tasks}


async def get_board(branch_id: int, sprint_id, request: Request, db: AsyncSession):
    """Board 탭용 Task 목록"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return error_response(ErrorCode.NOT_BRANCH_MEMBER)

    tasks = await task_model.find_for_board(branch_id, sprint_id, db)

    # workflow_status 기반 동적 컬럼
    statuses = await ws_model.find_by_branch(branch_id, db)
    columns = {s['key']: [] for s in statuses}
    for task in tasks:
        key = task['status']
        if key in columns:
            columns[key].append(task)
        else:
            # 매칭되지 않는 status는 첫번째 컬럼에 배치
            first_key = statuses[0]['key'] if statuses else 'todo'
            columns.setdefault(first_key, []).append(task)

    return {'status': True, 'columns': columns, 'statuses': statuses}


async def get_archive(branch_id: int, request: Request, db: AsyncSession):
    """완료된 Task 목록 (Archive 탭)"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return error_response(ErrorCode.NOT_BRANCH_MEMBER)

    tasks = await task_model.find_archived(branch_id, db)
    return {'status': True, 'tasks': tasks}


def _build_dry_run_preview(task, fields, body, unique_label_ids):
    """검증 통과 후, 실제 write 없이 변경 예상 diff를 계산해 반환(순수 함수)."""
    changes = {}

    field_changes = {}
    for k, v in fields.items():
        if k == 'custom_fields':
            continue
        if task.get(k) != v:
            field_changes[k] = {'from': task.get(k), 'to': v}
    if field_changes:
        changes['fields'] = field_changes

    if unique_label_ids is not None:
        old_ids = [l['label_id'] for l in (task.get('labels') or [])]
        changes['labels'] = {
            'added': [i for i in unique_label_ids if i not in old_ids],
            'removed': [i for i in old_ids if i not in unique_label_ids],
            'final': unique_label_ids,
        }

    if body.assignees is not None:
        # 순서/dedupe 규칙(main 우선)은 model.set_assignees와 동일하게 유지할 것
        main_id = body.assignees.main
        sub_ids = [u for u in dict.fromkeys(body.assignees.sub or []) if u != main_id]
        new_ids = ([main_id] if main_id else []) + sub_ids
        old_assignees = task.get('assignees') or []
        old_ids = [a['user_id'] for a in old_assignees]
        a_changes = {
            'added': [i for i in new_ids if i not in old_ids],
            'removed': [i for i in old_ids if i not in new_ids],
            'final': new_ids,
        }
        # main 변경(role-only 포함, set-diff엔 안 잡힘)도 표시
        old_main = next((a['user_id'] for a in old_assignees if a['role'] == 'main'), None)
        if old_main != main_id:
            a_changes['main_change'] = {'from': old_main, 'to': main_id}
        changes['assignees'] = a_changes

    if 'custom_fields' in fields and fields['custom_fields'] is not None:
        old_cf = task.get('custom_fields') or {}
        new_cf = fields['custom_fields']
        changes['custom_fields'] = {
            'set': new_cf,
            'removed': [k for k in old_cf if k not in new_cf],
            'final': new_cf,
        }

    return {'status': True, 'dry_run': True, 'changes': changes}


async def update(task_id: int, body, branch_id: int, request: Request, db: AsyncSession):
    """Task 수정"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return error_response(ErrorCode.NOT_BRANCH_MEMBER)

    task = await task_model.find_by_id(task_id, db)
    if not task or task['branch_id'] != branch_id:
        return error_response(ErrorCode.TASK_NOT_FOUND)

    # 담당자 소속 검증 (모델 변경 전, all-or-nothing)
    if body.assignees is not None and not await _assignees_valid_for_branch(body.assignees, branch_id, db):
        return error_response(ErrorCode.INVALID_ASSIGNEE)

    # parent_task_id 전환 검증: 명시적으로 보낸 경우만(생략은 무시 — exclude_unset과 동일 시맨틱).
    # 명시적 null = 승격(검증 불필요, NULL set). 값 지정 = 하위로 이동(1단계 불변식 검증).
    if 'parent_task_id' in body.model_fields_set and body.parent_task_id is not None:
        err = await _validate_parent_target(task_id, body.parent_task_id, branch_id, db)
        if err:
            return err

    fields = body.model_dump(exclude_unset=True, exclude={'label_ids', 'assignees', 'dry_run'})

    if fields.get('description'):
        fields['description'] = ensure_html(fields['description'])

    # 하위로 되는/남는 task엔 sprint/epic 자기 값을 저장하지 않는다 — 부모 라이브
    # 파생 불변식(§4). 승격(명시적 parent=null)은 최상위가 되므로 저장을 허용한다.
    effective_parent = (body.parent_task_id if 'parent_task_id' in body.model_fields_set
                        else task['parent_task_id'])
    if effective_parent is not None:
        if 'parent_task_id' in body.model_fields_set:
            # 전환: 기존 stale 값까지 일괄 소거
            fields['sprint_id'] = None
            fields['epic_id'] = None
        else:
            # 이미 하위: sprint/epic만 온 PATCH는 필드를 제거해 무시 —
            # fields가 비면 DB UPDATE 자체가 생략되어 updated_at도 안 움직인다.
            fields.pop('sprint_id', None)
            fields.pop('epic_id', None)

    # status 동적 검증 + alias 해석 — canonical key로 치환 후 저장.
    # explicit null(NOT NULL 컬럼이라 통과 시 NULL UPDATE 500)은 ''로 흘려
    # 빈 문자열과 동일하게 INVALID_STATUS + 유효값 동봉으로 거부한다.
    if 'status' in fields:
        status_row, err = await _resolve_status_ref(branch_id, fields['status'] or '', db)
        if err:
            return err
        fields['status'] = status_row['key']

    # task_type 동적 검증 (변경 시) — create와 동일 규칙(explicit null 거부 포함).
    # row는 custom_fields 검증에 재사용
    resolved_type_row = None
    if 'task_type' in fields:
        resolved_type_row, err = await _resolve_type_ref(branch_id, fields['task_type'] or '', db)
        if err:
            return err
        fields['task_type'] = resolved_type_row['type_key']

    # 날짜 순서 검증 (부분 PATCH는 기존 값과 병합)
    new_start = fields.get('start_date', task['start_date'])
    new_due = fields.get('due_date', task['due_date'])
    if not is_valid_date_order(new_start, new_due):
        return error_response(ErrorCode.INVALID_DATE_RANGE)

    # 라벨 branch 소속 검증 (첫 write 전 — title 등만 부분 적용되는 것 방지)
    unique_label_ids = None
    if body.label_ids is not None:
        unique_label_ids = list(dict.fromkeys(body.label_ids))
        if unique_label_ids and await task_model.count_label_ids_in_branch(
                branch_id, unique_label_ids, db) != len(unique_label_ids):
            return error_response(ErrorCode.LABEL_NOT_FOUND)

    # custom_fields lenient 검증 (첫 write 전; 최종 task_type 기준)
    if 'custom_fields' in fields and fields['custom_fields']:
        type_cfg = resolved_type_row
        if type_cfg is None:  # 이번 update가 type을 안 바꾸면 기존 task의 type으로
            type_cfg = await type_model.find_by_key(branch_id, task['task_type'], db)
        if not type_cfg:  # 타입 미해석 시 무검증 통과 금지(조용한 skip 차단)
            return error_response(ErrorCode.INVALID_TASK_TYPE)
        verr = await validate_custom_field_values(
            type_cfg['type_id'], fields['custom_fields'], db, strict=False)
        if verr:
            return error_response(verr)

    # dry_run: 모든 검증을 동일하게 거친 뒤, DB 쓰기/로깅/알림 없이 변경 diff만 반환
    if body.dry_run:
        return _build_dry_run_preview(task, fields, body, unique_label_ids)

    if fields:
        await task_model.update(task_id, fields, db)
        # 필드 변경 활동 로그 (update 후 새 task 조회하여 new_label 보강)
        updated = await task_model.find_by_id(task_id, db)
        await activity_service.log_task_change(task_id, branch_id, user_id, task, fields, updated, db)

        # 하위 전환이면, 이 task가 올라간 모든 track에 부모 sprint scope 보강
        if fields.get('parent_task_id') is not None:
            await track_scope_model.register_parent_sprint_scope_for_task_tracks(
                task_id, db)

    # description 멘션 알림 (새로 추가된 멘션만)
    if 'description' in fields and fields['description']:
        old_mentions = set(extract_mention_user_ids(task.get('description') or ''))
        new_mentions = set(extract_mention_user_ids(fields['description']))
        added_mentions = new_mentions - old_mentions
        if added_mentions:
            username = request.state.payload.get('username', '')
            display_id = task.get('display_id', '')
            link = f'/branch/{branch_id}/task/{task_id}'
            await notification_service.notify_bulk(
                list(added_mentions), 'mention', user_id,
                f'{username}님이 {display_id} {task.get("title", "")}에서 회원님을 멘션했습니다',
                link, 'task', task_id, db,
            )

    # 라벨 업데이트 (위에서 검증/dedupe 완료)
    if unique_label_ids is not None:
        old_labels = task.get('labels') or []
        await task_model.set_labels(task_id, unique_label_ids, db)
        # 새 라벨 목록 조회 후 diff 로깅
        updated_task = await task_model.find_by_id(task_id, db)
        new_labels = updated_task.get('labels') or []
        await activity_service.log_task_label_change(task_id, branch_id, user_id, old_labels, new_labels, db)

    # 담당자 업데이트 + 알림
    if body.assignees is not None:
        # 이전 담당자 목록
        old_assignees_list = task.get('assignees') or []
        old_assignee_ids = set()
        for a in old_assignees_list:
            old_assignee_ids.add(a['user_id'])

        # set_assignees가 sub 중복·main 중복을 제거(PK 위반 방지)
        await task_model.set_assignees(task_id, body.assignees.main, body.assignees.sub or [], db)

        # 담당자 변경 활동 로그 (add/remove는 set-diff, main 승격은 role 로그)
        updated_task_for_assignees = await task_model.find_by_id(task_id, db)
        new_assignees_list = updated_task_for_assignees.get('assignees') or []
        await activity_service.log_task_assignee_change(
            task_id, branch_id, user_id, old_assignees_list, new_assignees_list, db
        )
        await activity_service.log_task_assignee_role_changes(
            task_id, branch_id, user_id, old_assignees_list, new_assignees_list, db
        )

        # 새로 추가된 담당자에게 알림
        new_assignee_ids = set()
        if body.assignees.main:
            new_assignee_ids.add(body.assignees.main)
        for sub_id in (body.assignees.sub or []):
            new_assignee_ids.add(sub_id)

        added = new_assignee_ids - old_assignee_ids
        if added:
            display_id = task.get('display_id', '')
            title = task.get('title', '')
            username = request.state.payload.get('username', '')
            link = f'/branch/{branch_id}/task/{task_id}'
            await notification_service.notify_bulk(
                list(added), 'task_assigned', user_id,
                f'{username}님이 {display_id} {title}에 회원님을 담당자로 지정했습니다',
                link, 'task', task_id, db,
            )

        # 부모 Main 변경을 갈라지지 않은 직접 하위에 전파(WEAVE-43). 이 task가 하위면 대상 없음.
        # dry_run은 위(:453)에서 이미 반환했으므로 여기 도달하지 않는다.
        if effective_parent is None:
            await cascade_main_assignee_to_subtasks(
                task_id, main_of(old_assignees_list), body.assignees.main,
                branch_id, user_id, request.state.payload.get('username', ''), db)

    return {'status': True}


async def reorder(body, branch_id: int, request: Request, db: AsyncSession):
    """Task 이동 + 순서 변경"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return error_response(ErrorCode.NOT_BRANCH_MEMBER)

    # cross-branch IDOR 차단: 대상 sprint가 이 branch 소속인지 검증.
    # sprint_id=None은 백로그 이동(정상 케이스)이므로 검증 생략.
    if body.sprint_id is not None:
        if not await find_resource_in_branch(body.sprint_id, branch_id, 'sprint', db):
            return error_response(ErrorCode.SPRINT_NOT_FOUND)

    # 참조 anchor(after_task_id)도 같은 branch task인지 검증 (있을 경우만).
    if body.after_task_id is not None:
        if not await find_resource_in_branch(body.after_task_id, branch_id, 'task', db):
            return error_response(ErrorCode.AFTER_TASK_NOT_FOUND)

    # cross-branch IDOR 차단: 재정렬 대상 task_ids가 모두 이 branch 소속인지
    # 단일 쿼리 set-membership으로 검증 (all-or-nothing). 하나라도 외부/존재하지
    # 않는 id면 sort_order를 일절 변경하지 않고 거부한다.
    unique_ids = set(body.task_ids)
    if unique_ids:
        in_branch = await task_model.count_ids_in_branch(branch_id, unique_ids, db)
        if in_branch != len(unique_ids):
            return error_response(ErrorCode.TASK_NOT_FOUND)

    await task_model.reorder(branch_id, body.task_ids, body.sprint_id, body.after_task_id, db)
    return {'status': True}


async def delete(task_id: int, branch_id: int, request: Request, db: AsyncSession):
    """Task 삭제"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return error_response(ErrorCode.NOT_BRANCH_MEMBER)

    task = await task_model.find_by_id(task_id, db)
    if not task or task['branch_id'] != branch_id:
        return error_response(ErrorCode.TASK_NOT_FOUND)

    await activity_service.log_task_deleted(task_id, branch_id, user_id, db)
    await task_model.delete(task_id, db)
    return {'status': True}


# ---------------------------------------------------------------------------
# FilterSpec 기반 복합 쿼리 (MCP·크로스브랜치·Saved View·Reporting)
# ---------------------------------------------------------------------------

def _paging(body):
    # limit/offset 직접 지정이 우선(offset 의미 보존). 아니면 page/page_size에서 산출.
    if getattr(body, "limit", None) is not None:
        limit = max(1, min(body.limit, 200))
        return limit, max(0, getattr(body, "offset", 0) or 0)
    limit = max(1, min(body.page_size, 200))
    return limit, max(0, (body.page - 1) * limit)


def _dump_sort(sort):
    """sort item이 pydantic 모델이든 dict든 dict 리스트로 정규화(컨트롤러-direct 테스트는 dict를 넘길 수 있음)."""
    return [(s.model_dump() if hasattr(s, "model_dump") else dict(s)) for s in (sort or [])]


def _and(existing, extra):
    if not existing:
        return {"type": "group", "op": "AND", "negate": False, "children": [extra]}
    return {"type": "group", "op": "AND", "negate": False, "children": [existing, extra]}


async def _resolve_view(saved_view_id, user_id, expect_branch_id, db):
    """saved_view_id → {'spec','group_by','sort','scope'} | 에러 dict. expect_branch_id=None이면 개인 뷰만 허용(크로스).
    접근/스코프는 saved_view 컨트롤러의 Global 계약과 동일하게 여기서도 재검증(IDOR 방지)."""
    view = await sv_model.find_by_id(saved_view_id, db)
    if not view:
        return error_response(ErrorCode.VIEW_NOT_FOUND)
    # 접근: 개인 뷰=owner만; 브랜치 뷰=현재 멤버 AND (owner OR shared) — owner여도 멤버십 재확인(탈퇴 시 회수)
    if view['scope_branch_id'] is None:
        if view['owner_user_id'] != user_id:
            return error_response(ErrorCode.NOT_VIEW_VISIBLE)
    else:
        if not await member_model.is_member(view['scope_branch_id'], user_id, db):
            return error_response(ErrorCode.NOT_VIEW_VISIBLE)
        if view['owner_user_id'] != user_id and view['visibility'] != 'shared':
            return error_response(ErrorCode.NOT_VIEW_VISIBLE)
    # 스코프 일치
    if expect_branch_id is None:
        # 크로스=개인(scope NULL) 소유 뷰만. owner 재확인은 위 접근검사와 중복이지만 계약을 코드로 못박는 방어선.
        if view['scope_branch_id'] is not None or view['owner_user_id'] != user_id:
            return error_response(ErrorCode.VIEW_SCOPE_MISMATCH)
    elif view['scope_branch_id'] != expect_branch_id:
        return error_response(ErrorCode.VIEW_SCOPE_MISMATCH)
    # falsy(None/{}=server_default)만 빈 그룹으로 정규화. group/cond 루트는 보존(cond 루트도 유효).
    fs = view['filter_spec']
    spec = fs if fs else {'type': 'group', 'op': 'AND', 'negate': False, 'children': []}
    return {'spec': spec, 'group_by': view['group_by'], 'sort': view['sort'] or [], 'scope': view['scope']}


async def query_branch(branch_id, body, request, db):
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return error_response(ErrorCode.NOT_BRANCH_MEMBER)
    spec, group_by, sort = body.filter, body.group_by, _dump_sort(body.sort)
    if getattr(body, 'saved_view_id', None) is not None:  # 뷰가 있으면 서버가 spec/group_by/sort 로드(body 값 무시)
        v = await _resolve_view(body.saved_view_id, user_id, branch_id, db)
        if 'status' in v:        # 에러 dict(성공 dict엔 status 키 없음)
            return v
        spec, group_by, sort = v['spec'], v['group_by'], v['sort']
    try:
        validate_filter(spec)
        await validate_custom_fields(spec, branch_id, db)
    except FilterError as e:
        return error_response(ErrorCode.INVALID_FILTER, detail=str(e))
    # $today / $today±Nd 는 **요청 사용자 개인** timezone 기준이다(서버 로컬이 아니라).
    # 프런트 My Tasks 연체 표시와 같은 날짜 계약을 써야 같은 Task가 한쪽에서만 연체로 보이지 않는다.
    ctx = {'user_id': user_id, 'today': await personal_today(user_id, db)}
    limit, offset = _paging(body)
    result = await task_model.query([branch_id], spec, sort, group_by, limit, offset, ctx, db)
    return {'status': True, **result}


async def query_cross_branch(body, request, db):
    user_id = request.state.payload.get('user_id')
    if body.scope not in ("my", "all"):
        # 기본값 my인 API에서 오타가 더 넓은 결과를 주지 않도록 명시 거부
        return error_response(ErrorCode.INVALID_SCOPE)
    effective_scope = body.scope
    spec, group_by, sort = body.filter, body.group_by, _dump_sort(body.sort)
    if getattr(body, 'saved_view_id', None) is not None:
        v = await _resolve_view(body.saved_view_id, user_id, None, db)  # 개인(scope NULL) 소유 뷰만
        if 'status' in v:        # 에러 dict(성공 dict엔 status 키 없음)
            return v
        spec, group_by, sort = v['spec'], v['group_by'], v['sort']
        if v.get('scope') in ('my', 'all'):  # 뷰가 scope를 가지면 우선(뷰가 full 표현 — body.scope 무시)
            effective_scope = v['scope']
    try:                          # 로드한 뷰 spec도 SQL 전 재검증(개인 뷰가 cf 조건이면 FilterError→INVALID_FILTER)
        validate_filter(spec)
        await validate_custom_fields(spec, None, db)
    except FilterError as e:
        return error_response(ErrorCode.INVALID_FILTER, detail=str(e))
    # 멤버인 branch만 — assignee 할당이 남아있어도 비멤버 branch는 제외(IDOR)
    member_ids = await member_model.member_branch_ids(user_id, db)
    if not member_ids:
        return {'status': True, 'items': [], 'total': 0, 'groups': None}
    if effective_scope == "my":
        spec = _and(spec, {"type": "cond", "field": "assignee", "op": "eq", "value": "$me", "negate": False})
    # $today / $today±Nd 는 **요청 사용자 개인** timezone 기준이다(서버 로컬이 아니라).
    # 프런트 My Tasks 연체 표시와 같은 날짜 계약을 써야 같은 Task가 한쪽에서만 연체로 보이지 않는다.
    ctx = {'user_id': user_id, 'today': await personal_today(user_id, db)}
    limit, offset = _paging(body)
    result = await task_model.query(list(member_ids), spec, sort, group_by, limit, offset, ctx, db)
    return {'status': True, **result}
