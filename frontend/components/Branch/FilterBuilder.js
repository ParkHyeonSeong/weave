import { useMemo } from 'react';
import { Plus, X } from 'lucide-react';
import MultiSelect from '@/components/common/MultiSelect';
import { priorityVar } from '@/library/themePalette';
import { useTranslation } from 'react-i18next';
// 순수 불변 헬퍼는 library로 분리(vitest 커버). 컴포넌트는 이를 사용만 한다.
import {
  emptyGroup, addCondition, setGroupOp, removeNode, updateAtPath,
} from '@/library/filterBuilderState';

// ── 컴포넌트 메타 ──────────────────────────────────────────────────
// FIELD_SPECS(backend/core/query/filter_spec.py)와 의미 일치. text op는 contains만.
// 라벨은 렌더 시점에 t로 해석한다(모듈 상수는 키만 갖는다).
const PRIORITY_OPTIONS = [
  { value: 'urgent', labelKey: 'branch.priority.urgent', color: priorityVar('urgent') },
  { value: 'high', labelKey: 'branch.priority.high', color: priorityVar('high') },
  { value: 'medium', labelKey: 'branch.priority.medium', color: priorityVar('medium') },
  { value: 'low', labelKey: 'branch.priority.low', color: priorityVar('low') },
];
const STATUS_CATEGORY_OPTIONS = [
  { value: 'todo', labelKey: 'branch.statusCategory.todo' },
  { value: 'in_progress', labelKey: 'branch.statusCategory.inProgress' },
  { value: 'done', labelKey: 'branch.statusCategory.done' },
  { value: 'cancelled', labelKey: 'branch.statusCategory.cancelled' },
];

// op 라벨 (UI 표기)
const OP_LABEL_KEYS = {
  eq: 'branch.filter.op.eq', in: 'branch.filter.op.in', is_empty: 'branch.filter.op.isEmpty',
  contains: 'branch.filter.op.contains', lt: 'branch.filter.op.lt', lte: 'branch.filter.op.lte',
  gt: 'branch.filter.op.gt', gte: 'branch.filter.op.gte', between: 'branch.filter.op.between',
};

// 필드별 허용 op (FIELD_SPECS 미러). custom은 동적으로 _CUSTOM_OPS.
const FIELD_OPS = {
  status: ['eq', 'in', 'is_empty'],
  status_category: ['eq', 'in'],
  priority: ['eq', 'in'],
  task_type: ['eq', 'in'],
  label: ['in', 'is_empty'],
  epic: ['eq', 'in', 'is_empty'],
  sprint: ['eq', 'in', 'is_empty'],
  assignee: ['eq', 'in', 'is_empty'],
  created_by: ['eq', 'in'],
  due_date: ['eq', 'lt', 'lte', 'gt', 'gte', 'between', 'is_empty'],
  start_date: ['eq', 'lt', 'lte', 'gt', 'gte', 'between', 'is_empty'],
  created_at: ['lt', 'lte', 'gt', 'gte', 'between'],
  updated_at: ['lt', 'lte', 'gt', 'gte', 'between'],
  text: ['contains'],
  has_subtasks: ['eq'],
  is_top_level: ['eq'],
};
// v1 cf ops: eq/in/contains/is_empty (filter_spec._CUSTOM_OPS)
const CUSTOM_OPS = ['eq', 'in', 'contains', 'is_empty'];

const DATE_FIELDS = new Set(['due_date', 'start_date', 'created_at', 'updated_at']);
const BOOL_FIELDS = new Set(['has_subtasks', 'is_top_level']);
const ENUM_FIELDS = new Set(['status', 'status_category', 'priority', 'task_type']);
const ID_FIELDS = new Set(['label', 'epic', 'sprint', 'assignee', 'created_by']);

const isCustom = (field) => typeof field === 'string' && field.startsWith('cf:');
const cfId = (field) => field.slice(3);

function opsForField(field) {
  if (isCustom(field)) return CUSTOM_OPS;
  return FIELD_OPS[field] || ['eq'];
}

// op 변경/필드 변경 시 value를 op kind에 맞춰 정규화(in→[], is_empty→null, 그 외→'').
function defaultValueForOp(op, prevValue) {
  if (op === 'is_empty') return null;
  if (op === 'in') return Array.isArray(prevValue) ? prevValue : [];
  if (op === 'between') return Array.isArray(prevValue) && prevValue.length === 2 ? prevValue : ['', ''];
  if (Array.isArray(prevValue)) return '';
  return prevValue == null ? '' : prevValue;
}

// ── 값 입력 위젯 ───────────────────────────────────────────────────
function EnumValueInput({ field, op, value, onChange, members, labels, epics, taskTypes, workflowStatuses, customFields }) {
  const { t } = useTranslation();
  // enum/id 필드의 선택 옵션 목록
  const options = useMemo(() => {
    if (field === 'priority') return PRIORITY_OPTIONS.map((o) => ({ ...o, label: t(o.labelKey) }));
    if (field === 'status_category') return STATUS_CATEGORY_OPTIONS.map((o) => ({ ...o, label: t(o.labelKey) }));
    if (field === 'status') return (workflowStatuses || []).map((ws) => ({ value: ws.key, label: ws.label, color: ws.color }));
    if (field === 'task_type') return (taskTypes || []).map((tt) => ({ value: tt.type_key, label: tt.type_name, color: tt.color }));
    if (field === 'label') return (labels || []).map((lb) => ({ value: lb.label_id, label: lb.label_name, color: lb.color }));
    if (field === 'epic') return (epics || []).map((ep) => ({ value: ep.epic_id, label: ep.epic_name, color: ep.color || '#5E6AD2' }));
    if (field === 'assignee' || field === 'created_by') {
      return (members || []).map((m) => ({ value: m.user_id, label: m.username || m.email }));
    }
    if (isCustom(field)) {
      const cf = (customFields || []).find((f) => String(f.custom_field_id) === cfId(field));
      return (cf?.field_options || []).map((o) => ({ value: o, label: o }));
    }
    return [];
  }, [field, members, labels, epics, taskTypes, workflowStatuses, customFields, t]);

  if (op === 'in') {
    const selected = new Set(Array.isArray(value) ? value : []);
    return (
      <MultiSelect
        label={selected.size ? t('branch.filter.selected', { count: selected.size }) : t('branch.filter.selectPlaceholder')}
        selectedValues={selected}
        options={options}
        onToggle={(v) => {
          const next = new Set(selected);
          if (next.has(v)) next.delete(v); else next.add(v);
          onChange([...next]);
        }}
      />
    );
  }
  // eq → 단일 select
  return (
    <select
      className="FilterBuilder__Select"
      value={value == null ? '' : String(value)}
      onChange={(e) => {
        const raw = e.target.value;
        // id 필드는 숫자로 캐스팅(assignee/created_by의 $me는 후속, v1은 멤버 선택)
        const cast = ID_FIELDS.has(field) && raw !== '' ? Number(raw) : raw;
        onChange(cast);
      }}
    >
      <option value="">{t('branch.filter.selectPlaceholder')}</option>
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>{o.label}</option>
      ))}
    </select>
  );
}

function ValueInput(props) {
  const { t } = useTranslation();
  const { field, op, value, onChange } = props;
  const relativeDateHint = t('branch.filter.relativeDateHint');

  if (op === 'is_empty') return <span className="FilterBuilder__NoValue">—</span>;

  if (BOOL_FIELDS.has(field)) {
    return (
      <select
        className="FilterBuilder__Select"
        value={value === true ? 'true' : value === false ? 'false' : ''}
        onChange={(e) => onChange(e.target.value === 'true')}
      >
        <option value="">{t('branch.filter.selectPlaceholder')}</option>
        <option value="true">{t('branch.filter.yes')}</option>
        <option value="false">{t('branch.filter.no')}</option>
      </select>
    );
  }

  if (DATE_FIELDS.has(field)) {
    if (op === 'between') {
      const arr = Array.isArray(value) ? value : ['', ''];
      return (
        <span className="FilterBuilder__DateRange">
          <input
            className="FilterBuilder__DateInput" type="text" placeholder={relativeDateHint}
            title={relativeDateHint} value={arr[0] || ''}
            onChange={(e) => onChange([e.target.value, arr[1] || ''])}
          />
          <span className="FilterBuilder__DateSep">→</span>
          <input
            className="FilterBuilder__DateInput" type="text" placeholder={relativeDateHint}
            title={relativeDateHint} value={arr[1] || ''}
            onChange={(e) => onChange([arr[0] || '', e.target.value])}
          />
        </span>
      );
    }
    // 상대 토큰($today±Nd)도 허용해야 하므로 text input(+힌트)
    return (
      <input
        className="FilterBuilder__DateInput" type="text" placeholder={relativeDateHint}
        title={relativeDateHint} value={value == null ? '' : value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  // enum/id/custom-select: 옵션 선택(eq 단일 / in 멀티)
  const usesOptions = ENUM_FIELDS.has(field) || ID_FIELDS.has(field)
    || (isCustom(field) && (props.customFields || []).find((f) => String(f.custom_field_id) === cfId(field))?.field_type === 'select');
  if (usesOptions && (op === 'eq' || op === 'in')) {
    return <EnumValueInput {...props} />;
  }

  // custom number/date 등은 v1에서 text op로 contains/eq 비교(JSONB ->> text). text input.
  if (op === 'in') {
    // 자유 텍스트 in: 쉼표 구분 입력
    const arr = Array.isArray(value) ? value : [];
    return (
      <input
        className="FilterBuilder__TextInput" type="text" placeholder={t('branch.filter.commaSeparated')}
        value={arr.join(', ')}
        onChange={(e) => onChange(e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
      />
    );
  }
  return (
    <input
      className="FilterBuilder__TextInput" type="text" placeholder={t('branch.filter.valuePlaceholder')}
      value={value == null ? '' : value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

// ── 조건 행 ────────────────────────────────────────────────────────
function ConditionRow({ node, path, onChange, fieldOptions, ...rest }) {
  const { t } = useTranslation();
  const ops = opsForField(node.field);

  const setField = (field) => {
    const newOps = opsForField(field);
    const op = newOps.includes(node.op) ? node.op : newOps[0];
    onChange((root) => updateAtPath(root, path, () => ({
      type: 'cond', field, op, value: defaultValueForOp(op, undefined), negate: false,
    })));
  };
  const setOp = (op) => {
    onChange((root) => updateAtPath(root, path, (n) => ({ ...n, op, value: defaultValueForOp(op, n.value) })));
  };
  const setValue = (value) => {
    onChange((root) => updateAtPath(root, path, (n) => ({ ...n, value })));
  };

  return (
    <div className="FilterBuilder__Cond">
      <select
        className="FilterBuilder__Select FilterBuilder__FieldSelect"
        value={node.field}
        onChange={(e) => setField(e.target.value)}
      >
        {fieldOptions.map((f) => (
          <option key={f.value} value={f.value}>{f.label}</option>
        ))}
      </select>

      <select
        className="FilterBuilder__Select FilterBuilder__OpSelect"
        value={node.op}
        onChange={(e) => setOp(e.target.value)}
      >
        {ops.map((op) => (
          <option key={op} value={op}>{OP_LABEL_KEYS[op] ? t(OP_LABEL_KEYS[op]) : op}</option>
        ))}
      </select>

      <span className="FilterBuilder__Value">
        <ValueInput field={node.field} op={node.op} value={node.value} onChange={setValue} {...rest} />
      </span>

      <button
        type="button"
        className="FilterBuilder__RemoveBtn"
        title={t('branch.filter.removeCondition')}
        onClick={() => onChange((root) => removeNode(root, path))}
      >
        <X size={13} />
      </button>
    </div>
  );
}

// ── 그룹 노드 ──────────────────────────────────────────────────────
function GroupNode({ node, path, onChange, fieldOptions, isRoot, ...rest }) {
  const { t } = useTranslation();
  const children = node.children || [];

  const addCond = () => onChange((root) => addCondition(root, path, {
    type: 'cond', field: fieldOptions[0].value, op: opsForField(fieldOptions[0].value)[0],
    value: defaultValueForOp(opsForField(fieldOptions[0].value)[0], undefined), negate: false,
  }));
  const addGroup = () => onChange((root) => addCondition(root, path, emptyGroup()));
  const toggleOp = (op) => onChange((root) => setGroupOp(root, path, op));

  return (
    <div className={`FilterBuilder__Group ${isRoot ? 'FilterBuilder__Group--root' : ''}`}>
      <div className="FilterBuilder__GroupHeader">
        <div className="FilterBuilder__OpToggle">
          <button
            type="button"
            className={`FilterBuilder__OpToggleBtn ${node.op === 'AND' ? 'FilterBuilder__OpToggleBtn--active' : ''}`}
            onClick={() => toggleOp('AND')}
          >AND</button>
          <button
            type="button"
            className={`FilterBuilder__OpToggleBtn ${node.op === 'OR' ? 'FilterBuilder__OpToggleBtn--active' : ''}`}
            onClick={() => toggleOp('OR')}
          >OR</button>
        </div>
        {!isRoot && (
          <button
            type="button"
            className="FilterBuilder__RemoveBtn"
            title={t('branch.filter.removeGroup')}
            onClick={() => onChange((root) => removeNode(root, path))}
          >
            <X size={13} />
          </button>
        )}
      </div>

      <div className="FilterBuilder__Children">
        {children.map((child, i) => (
          child.type === 'group'
            ? (
              <GroupNode
                key={i}
                node={child}
                path={[...path, i]}
                onChange={onChange}
                fieldOptions={fieldOptions}
                {...rest}
              />
            )
            : (
              <ConditionRow
                key={i}
                node={child}
                path={[...path, i]}
                onChange={onChange}
                fieldOptions={fieldOptions}
                {...rest}
              />
            )
        ))}
        {children.length === 0 && (
          <div className="FilterBuilder__Empty">{t('branch.filter.noConditions')}</div>
        )}
      </div>

      <div className="FilterBuilder__GroupActions">
        <button type="button" className="FilterBuilder__AddBtn" onClick={addCond}>
          <Plus size={12} /> {t('branch.filter.addCondition')}
        </button>
        <button type="button" className="FilterBuilder__AddBtn" onClick={addGroup}>
          <Plus size={12} /> {t('branch.filter.addGroup')}
        </button>
      </div>
    </div>
  );
}

/**
 * FilterBuilder — 중첩 FilterSpec(AND/OR 불린 트리) 편집기.
 * spec/onChange는 controlled. onChange(updater)는 (prevSpec) => nextSpec 함수를 받는다.
 * 필드/op/값 목록은 FIELD_SPECS(backend) 계약과 일치.
 */
export default function FilterBuilder({ spec, onChange, members, labels, epics, taskTypes, workflowStatuses, customFields, availableFields }) {
  const { t } = useTranslation();
  const root = spec && spec.type === 'group' ? spec : emptyGroup();

  // 선택 가능한 필드 목록(브랜치 메타에 맞춰 동적 구성)
  const fieldOptions = useMemo(() => {
    let base = [
      { value: 'status', label: t('branch.filter.field.status') },
      { value: 'status_category', label: t('branch.filter.field.statusCategory') },
      { value: 'priority', label: t('branch.filter.field.priority') },
      { value: 'task_type', label: t('branch.filter.field.taskType') },
      { value: 'label', label: t('branch.filter.field.label') },
      { value: 'epic', label: t('branch.filter.field.epic') },
      { value: 'sprint', label: t('branch.filter.field.sprint') },
      { value: 'assignee', label: t('branch.filter.field.assignee') },
      { value: 'created_by', label: t('branch.filter.field.createdBy') },
      { value: 'due_date', label: t('branch.filter.field.dueDate') },
      { value: 'start_date', label: t('branch.filter.field.startDate') },
      { value: 'created_at', label: t('branch.filter.field.createdAt') },
      { value: 'updated_at', label: t('branch.filter.field.updatedAt') },
      { value: 'text', label: t('branch.filter.field.text') },
      { value: 'has_subtasks', label: t('branch.filter.field.hasSubtasks') },
      { value: 'is_top_level', label: t('branch.filter.field.isTopLevel') },
    ];
    // availableFields 제공 시 클라이언트 payload가 뒷받침하는 필드만 남긴다.
    // (cf:* 커스텀 필드는 customFields에서 파생되므로 항상 유지)
    if (Array.isArray(availableFields)) {
      const allow = new Set(availableFields);
      base = base.filter((f) => allow.has(f.value));
    }
    const cf = (customFields || []).map((f) => ({
      value: `cf:${f.custom_field_id}`, label: f.field_name,
    }));
    return [...base, ...cf];
  }, [customFields, availableFields, t]);

  // onChange를 updater 함수로 래핑(루트 기준 불변 갱신)
  const apply = (updater) => onChange(updater(root));

  return (
    <div className="FilterBuilder">
      <GroupNode
        node={root}
        path={[]}
        onChange={apply}
        fieldOptions={fieldOptions}
        isRoot
        members={members}
        labels={labels}
        epics={epics}
        taskTypes={taskTypes}
        workflowStatuses={workflowStatuses}
        customFields={customFields}
      />
    </div>
  );
}
