// 활동 이력 요약을 **읽는 시점의 사용자 언어**로 만든다.
//
// activity_log 행은 action(created/updated/deleted/moved) · entity_type · changes(구조화 diff)를
// 모두 갖고 있으므로, 서버가 저장해 둔 한국어 summary 문장을 그대로 쓸 이유가 없다.
// summary는 구조화 데이터로 문장을 만들 수 없는 **구버전 행**의 폴백으로만 남긴다.

const ENTITY_KEYS = {
  task: 'common.activity.entity.task',
  canvas_page: 'common.activity.entity.page',
};

const FIELD_KEYS = {
  title: 'common.activity.field.title',
  description: 'common.activity.field.description',
  task_type: 'common.activity.field.taskType',
  status: 'common.activity.field.status',
  priority: 'common.activity.field.priority',
  epic_id: 'common.activity.field.epic',
  sprint_id: 'common.activity.field.sprint',
  parent_task_id: 'common.activity.field.parentTask',
  start_date: 'common.activity.field.startDate',
  due_date: 'common.activity.field.dueDate',
  content: 'common.activity.field.content',
  assignees: 'common.activity.field.assignees',
  labels: 'common.activity.field.labels',
};

const MEMBER_NAME = (m) => m?.username || m?.label_name || m?.name || '?';

function entityLabel(entityType, t) {
  const key = ENTITY_KEYS[entityType];
  return key ? t(key) : (entityType || '');
}

function fieldLabel(field, t) {
  const key = FIELD_KEYS[field];
  return key ? t(key) : (field || '');
}

/** 스칼라 값 표시 — 라벨(old_label/new_label)이 있으면 그것이 우선이다(상태 이름 등 사용자 데이터). */
function scalarValue(change, side, t) {
  const label = side === 'old' ? change.old_label : change.new_label;
  const raw = side === 'old' ? change.old : change.new;
  const value = label != null ? label : raw;
  if (value === null || value === undefined || value === '') return t('common.activity.noValue');
  return String(value);
}

function changePhrase(change, t) {
  const field = change?.field;

  // 담당자 role 전이(main ↔ sub) — 집합은 그대로라 added/removed로 표현되지 않는다.
  if (field === 'assignee_role') {
    const key = change.role === 'main'
      ? 'common.activity.change.assigneeMain'
      : 'common.activity.change.assigneeSub';
    return t(key, { name: change.username || t('common.activity.unknownUser') });
  }

  // 집합형(담당자·라벨)
  if (change?.added || change?.removed) {
    const parts = [];
    if (change.added?.length) parts.push(`+${change.added.map(MEMBER_NAME).join(', ')}`);
    if (change.removed?.length) parts.push(`-${change.removed.map(MEMBER_NAME).join(', ')}`);
    return `${fieldLabel(field, t)} ${parts.join(' ')}`.trim();
  }

  // 본문 필드 — 값 대신 "수정"만 (diff가 너무 길다)
  if (field === 'description' || field === 'content' || change?.changed) {
    return t('common.activity.change.edited', { field: fieldLabel(field, t) });
  }

  return t('common.activity.change.replaced', {
    field: fieldLabel(field, t),
    from: scalarValue(change, 'old', t),
    to: scalarValue(change, 'new', t),
  });
}

/**
 * 활동 한 건의 요약 문장.
 * @param {object} activity  { action, entity_type, changes, summary }
 * @param {Function} t
 */
export function activitySummary(activity, t) {
  const action = activity?.action;
  const entity = entityLabel(activity?.entity_type, t);
  const changes = Array.isArray(activity?.changes) ? activity.changes : [];

  if (action === 'created') {
    const title = changes.find((c) => c?.field === 'title')?.new;
    return title
      ? t('common.activity.action.createdNamed', { entity, name: title })
      : t('common.activity.action.created', { entity });
  }
  if (action === 'deleted') {
    const title = changes.find((c) => c?.field === 'title')?.old;
    return title
      ? t('common.activity.action.deletedNamed', { entity, name: title })
      : t('common.activity.action.deleted', { entity });
  }
  if (action === 'moved') return t('common.activity.action.moved', { entity });

  if (action === 'updated') {
    // 최대 3개 필드까지만 요약한다(서버 _generate_summary와 같은 규칙).
    const parts = changes.slice(0, 3).map((c) => changePhrase(c, t)).filter(Boolean);
    if (parts.length) return parts.join(', ');
    return t('common.activity.action.updated', { entity });
  }

  // 알 수 없는 action(구버전 행) — 서버가 저장한 문장을 그대로 보여준다.
  return activity?.summary || '';
}
