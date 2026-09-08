// frontend/library/filterSpec.js
/** FilterSpec 클라이언트 평가기. backend/core/query/eval_inmem.py와 의미 일치(parity 픽스처로 강제). */
//
// ⚠️ 이 모듈은 **시계를 직접 읽지 않는다**. `$today`는 호출부가 ctx.today로 넘긴
//    'YYYY-MM-DD'(= useDateFormat().today(), 사용자 **개인** timezone의 오늘)로만 해석된다.
//    여기서 new Date()를 읽으면 브라우저 timezone의 오늘이 되어 백엔드 $today(사용자
//    language_region.time_zone 기준)와 갈린다 — 같은 저장 필터가 프런트/백엔드에서
//    다른 날을 가리키게 된다.
import { addDaysToDateOnly } from './formatDateTime';

const DATE_FIELDS = new Set(['due_date', 'start_date', 'created_at', 'updated_at']);
const LEAF = { status: 'status', status_category: 'status_category', priority: 'priority',
  task_type: 'task_type', epic: 'epic_id', sprint: 'sprint_id', created_by: 'created_by',
  due_date: 'due_date', start_date: 'start_date', created_at: 'created_at', updated_at: 'updated_at' };

// grammar는 filter_spec._DATE_TOKEN / eval_inmem._REL과 동기.
const DATE_TOKEN_RE = /^\$today([+-]\d+)d$/;

/**
 * `$today` / `$today±Nd` → 'YYYY-MM-DD'.
 * @param value 필터 값(토큰이 아니면 그대로 반환)
 * @param today **명시 인자**로 받는 오늘('YYYY-MM-DD'). 이 함수는 시계를 읽지 않는다.
 */
export function resolveDateToken(value, today) {
  if (typeof value !== 'string') return value;
  if (value === '$today') return today;
  const m = DATE_TOKEN_RE.exec(value);
  if (!m) return value;
  // 오프셋도 달력 산술 — instant로 환산하지 않으므로 DST/timezone과 무관하다.
  return today ? addDaysToDateOnly(today, parseInt(m[1], 10)) : today;
}

function resolve(value, ctx, isDate) {
  if (value === '$me') return ctx.userId;
  if (isDate) return resolveDateToken(value, ctx.today);
  return value;
}
function cmp(a, op, b) {
  if (a == null) return false;
  if (op === 'eq') return a === b;
  if (op === 'lt') return a < b;
  if (op === 'lte') return a <= b;
  if (op === 'gt') return a > b;
  if (op === 'gte') return a >= b;
  return false;
}
const strip = (s) => (s || '').replace(/<[^>]+>/g, ' ');

function cfText(raw) {
  // custom_fields raw → 비교용 텍스트(Py _cf_text와 1:1). bool 소문자, null은 비매칭.
  // 소수(1.0)는 JS가 int/float 구분이 없어 Py와 표기차가 남음 — v1 cf는 text/select 위주.
  if (raw == null) return null;
  if (typeof raw === 'boolean') return raw ? 'true' : 'false';
  return String(raw);
}

function evalCond(task, node, ctx) {
  const { field, op, value } = node;
  if (field === 'assignee') {
    if (op === 'is_empty') return (task.assignees || []).length === 0;
    const ids = (op === 'in' ? value : [value]).map((v) => (v === '$me' ? ctx.userId : v));
    return (task.assignees || []).some((a) => ids.includes(a.user_id));
  }
  if (field === 'label') {
    if (op === 'is_empty') return (task.labels || []).length === 0;
    const set = new Set(value);
    return (task.labels || []).some((l) => set.has(l.label_id));
  }
  if (field === 'has_subtasks') {
    const has = (task.subtaskCount || (task.subtasks || []).length) > 0;
    return value ? has : !has;
  }
  if (field === 'is_top_level') {
    const top = task.parent_task_id == null;
    return value ? top : !top;
  }
  if (field === 'text') {
    const hay = `${task.title || ''} ${strip(task.description)}`.toLowerCase();
    return hay.includes(String(value).toLowerCase());  // text는 contains만
  }
  if (field.startsWith('cf:')) {
    const raw = cfText((task.custom_fields || {})[field.slice(3)]);
    if (op === 'is_empty') return raw == null;
    if (raw == null) return false;
    if (op === 'contains') return raw.toLowerCase().includes(String(value).toLowerCase());
    if (op === 'in') return value.map(String).includes(raw);
    // eq (v1: cf 비교 op 없음)
    return raw === String(value);
  }
  const col = LEAF[field];
  const isDate = DATE_FIELDS.has(field);
  const lv = task[col];
  if (op === 'is_empty') return lv == null;
  if (op === 'in') return value.map((v) => resolve(v, ctx, isDate)).includes(lv);
  if (op === 'between') return lv != null && lv >= resolve(value[0], ctx, isDate) && lv <= resolve(value[1], ctx, isDate);
  return cmp(lv, op, resolve(value, ctx, isDate));
}

export function evaluate(task, node, ctx = {}) {
  if (!node) return true;
  let res;
  if (node.type === 'group') {
    const ch = node.children || [];
    if (ch.length === 0) res = true;
    else if (node.op === 'OR') res = ch.some((x) => evaluate(task, x, ctx));
    else res = ch.every((x) => evaluate(task, x, ctx));
  } else {
    res = evalCond(task, node, ctx);
  }
  return node.negate ? !res : res;
}
