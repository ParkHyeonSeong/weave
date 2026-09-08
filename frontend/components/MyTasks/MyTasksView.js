import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckSquare, Inbox, SlidersHorizontal, X } from 'lucide-react';
import { axios } from '@/library/_axios';
import CustomSelect from '@/components/common/CustomSelect';
import TaskTypeIcon from '@/components/common/TaskTypeIcon';
import EntityIcon from '@/components/common/EntityIcon';
import NavLink from '@/components/common/NavLink';
import FilterBuilder from '@/components/Branch/FilterBuilder';
import SavedViewSwitcher from '@/components/common/SavedViewSwitcher';
import { emptyGroup, isEmptySpec } from '@/library/filterBuilderState';
import { applySavedView } from '@/library/savedViewState';
import { priorityVar } from '@/library/themePalette';
import { entityTintStyle } from '@/library/entityTint';
import { useDateFormat } from '@/hooks/useDateFormat';

// 라벨은 카탈로그 키로만 두고 렌더 시점에 t()로 푼다(모듈 상수는 언어 전환을 못 따라간다).
const STATUS_CATEGORY_OPTIONS = [
  { value: 'todo', labelKey: 'account.myTasks.statusCategory.todo' },
  { value: 'in_progress', labelKey: 'account.myTasks.statusCategory.inProgress' },
  { value: 'done', labelKey: 'account.myTasks.statusCategory.done' },
  { value: 'cancelled', labelKey: 'account.myTasks.statusCategory.cancelled' },
];

const PRIORITY_OPTIONS = [
  { value: 'urgent', labelKey: 'account.myTasks.priority.urgent', color: priorityVar('urgent') },
  { value: 'high', labelKey: 'account.myTasks.priority.high', color: priorityVar('high') },
  { value: 'medium', labelKey: 'account.myTasks.priority.medium', color: priorityVar('medium') },
  { value: 'low', labelKey: 'account.myTasks.priority.low', color: priorityVar('low') },
];

const sortOptions = [
  { value: 'updated', labelKey: 'account.myTasks.sort.updated' },
  { value: 'created', labelKey: 'account.myTasks.sort.created' },
  { value: 'priority', labelKey: 'account.myTasks.sort.priority' },
  { value: 'due_date', labelKey: 'account.myTasks.sort.dueDate' },
];

// 고급 빌더가 제공하는 필드 — 크로스브랜치 안전한 글로벌 필드만.
// (status/label/epic/sprint/task_type/created_by/assignee/cf:* 는 브랜치 스코프라 제외)
const ADVANCED_FIELDS = [
  'priority', 'status_category', 'due_date', 'start_date',
  'created_at', 'updated_at', 'text', 'has_subtasks', 'is_top_level',
];

// 빈 옵션 목록(고급 필드는 브랜치 옵션 목록이 필요 없음)
const EMPTY_OPTS = [];

// 기본 sort_by 값 → 쿼리 엔드포인트의 [{field, dir}] 매핑.
// _ORDERABLE(filter_builder.py)와 일치: updated→updated_at, created→created_at.
// 시간 정렬은 최신순(desc), priority/due_date는 오름차순(가장 급한/임박한 것 먼저).
const SORT_TO_QUERY = {
  updated: [{ field: 'updated_at', dir: 'desc' }],
  created: [{ field: 'created_at', dir: 'desc' }],
  priority: [{ field: 'priority', dir: 'asc' }],
  due_date: [{ field: 'due_date', dir: 'asc' }],
};

// 저장된 뷰의 sort([{field,dir}]) → sort_by 값 역매핑(적용 시 복원). 매칭 없으면 기본 'updated'.
const sortByFromQuery = (sort) => {
  const first = (sort || [])[0];
  if (!first) return 'updated';
  const hit = Object.entries(SORT_TO_QUERY).find(
    ([, v]) => v[0].field === first.field && v[0].dir === first.dir);
  return hit ? hit[0] : 'updated';
};

export default function MyTasksView() {
  const { t } = useTranslation();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    status: '', priority: '', branch_id: '', sort_by: 'updated',
  });

  // 고급 필터 빌더 + 크로스브랜치 스코프 (서버 폴백)
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [filterSpec, setFilterSpec] = useState(emptyGroup());
  const [scope, setScope] = useState('my'); // 'my' = 나에게 배정된 태스크 / 'all' = 내 멤버 브랜치 전체
  const [serverTotal, setServerTotal] = useState(null); // 서버 모드일 때 total
  const [filterError, setFilterError] = useState(null); // 서버 모드 spec 거부 시 인라인 메시지

  // 저장된 개인 뷰(scope_branch_id NULL) — 스위처
  const [savedViews, setSavedViews] = useState([]);
  const [activeViewId, setActiveViewId] = useState(null);
  const [viewError, setViewError] = useState(null);

  // 고급 spec이 비어있지 않거나 scope='all'이면 서버 쿼리 모드.
  const advancedActive = !isEmptySpec(filterSpec);
  const serverMode = advancedActive || scope === 'all';

  const loadSavedViews = useCallback(async () => {
    try {
      const res = await axios.get('/saved-views'); // 파라미터 없음 = 개인(전역) 뷰
      setSavedViews(res.data?.status ? (res.data.views || []) : []);
    } catch {
      setSavedViews([]);
    }
  }, []);
  useEffect(() => { loadSavedViews(); }, [loadSavedViews]);

  // 저장/수정 payload: 화면에 "실제 적용되는" 필터만 단일 filter_spec으로 합성한다.
  // 기본 드롭다운(status_category/priority)은 기본 모드에서만 조회에 적용되고 serverMode에선
  // 적용도 안 되며 숨겨지므로(조회는 filterSpec만 전송) — !serverMode일 때만 합성해 화면과 일치시킨다(리뷰 P1).
  // serverMode에선 filterSpec(advancedActive)만 담는다. branch_id는 브랜치 전용이라 미포함(적용 시 초기화).
  // scope(my/all)는 saved_view.scope 컬럼에 저장 → 적용 시 복원.
  const buildViewPayload = () => {
    const cond = (field, value) => ({ type: 'cond', field, op: 'eq', value, negate: false });
    const children = [];
    if (!serverMode) {
      if (filters.status) children.push(cond('status_category', filters.status));
      if (filters.priority) children.push(cond('priority', filters.priority));
    } else if (advancedActive) {
      children.push(filterSpec);
    }
    const filter_spec = children.length === 1
      ? children[0]
      : { type: 'group', op: 'AND', negate: false, children };
    return { filter_spec, group_by: null, sort: SORT_TO_QUERY[filters.sort_by] || [], scope };
  };

  const handleApplyView = (viewId) => {
    const view = savedViews.find((v) => v.view_id === viewId);
    if (!view) return;
    const applied = applySavedView(view); // cond 루트 안전 정규화 포함
    setFilterSpec(applied.filterSpec);
    setScope(view.scope === 'all' ? 'all' : 'my'); // 뷰 scope 복원(없으면 'my' 기본)
    // 기본 quick 필터(status/priority/branch_id)는 비운다 — 뷰의 filter_spec이 단일 소스(이중 필터 방지).
    setFilters((prev) => ({ ...prev, status: '', priority: '', branch_id: '', sort_by: sortByFromQuery(view.sort) }));
    setActiveViewId(viewId);
    setViewError(null);
  };

  const handleSaveView = async (name) => {
    try {
      const res = await axios.post('/saved-views', { name, scope_branch_id: null, ...buildViewPayload(), visibility: 'private' });
      if (res.data?.status) { await loadSavedViews(); setActiveViewId(res.data.view_id); setViewError(null); }
      else setViewError(t('account.myTasks.saveViewFailed'));
    } catch {
      setViewError(t('account.myTasks.saveViewFailed'));
    }
  };

  const handleUpdateView = async (viewId) => {
    try {
      const res = await axios.patch(`/saved-views/${viewId}`, buildViewPayload());
      if (res.data?.status) { await loadSavedViews(); setViewError(null); }
      else setViewError(t('account.myTasks.updateViewFailed'));
    } catch {
      setViewError(t('account.myTasks.updateViewFailed'));
    }
  };

  const handleDeleteView = async (viewId) => {
    try {
      const res = await axios.delete(`/saved-views/${viewId}`);
      if (res.data?.status) {
        await loadSavedViews();
        if (activeViewId === viewId) setActiveViewId(null);
        setViewError(null);
      } else {
        setViewError(t('account.myTasks.deleteViewFailed'));
      }
    } catch {
      setViewError(t('account.myTasks.deleteViewFailed'));
    }
  };

  const fetchTasks = useCallback(async () => {
    // 서버 쿼리 모드: 고급 spec 또는 크로스브랜치 scope → /tasks/query
    if (serverMode) {
      setServerTotal(null); // 기본 모드와 대칭 — 실패/빈 응답이 stale count를 못 보이게
      try {
        const res = await axios.post('/tasks/query', {
          filter: advancedActive ? filterSpec : null,
          scope,
          sort: SORT_TO_QUERY[filters.sort_by] || [],
          limit: 200,
          offset: 0,
        });
        if (res.data.status) {
          setTasks(res.data.items || []);
          setServerTotal(res.data.total ?? (res.data.items || []).length);
          setFilterError(null);
        } else {
          // 백엔드가 spec을 거부({status:False, message:'INVALID_FILTER'}) — 침묵 금지
          setTasks([]);
          setServerTotal(0);
          setFilterError(t('account.myTasks.filterFailed'));
        }
      } catch {
        setTasks([]);
        setServerTotal(0);
        setFilterError(t('account.myTasks.filterFailed'));
      }
      setLoading(false);
      return;
    }

    // 기본 모드: 기존 /my-tasks 경로 (변경 없음)
    setServerTotal(null);
    setFilterError(null);
    const params = { sort_by: filters.sort_by };
    if (filters.status) params.status_category = filters.status;
    if (filters.priority) params.priority = filters.priority;
    if (filters.branch_id) params.branch_id = filters.branch_id;

    try {
      const res = await axios.get('/my-tasks', { params });
      if (res.data.status) setTasks(res.data.tasks);
    } catch {}
    setLoading(false);
  }, [filters, serverMode, advancedActive, filterSpec, scope, t]);

  useEffect(() => {
    setLoading(true);
    fetchTasks();
  }, [fetchTasks]);

  useEffect(() => {
    const handler = () => fetchTasks();
    window.addEventListener('task:updated', handler);
    return () => window.removeEventListener('task:updated', handler);
  }, [fetchTasks]);

  // 응답 데이터에서 브랜치 목록 추출 (branch_id 있는 항목만 — 쿼리 items는 branch_id 미포함)
  const branches = [...new Map(
    tasks
      .filter((t) => t.branch_id != null)
      .map((t) => [t.branch_id, { branch_id: t.branch_id, branch_name: t.branch_name, branch_key: t.branch_key }])
  ).values()];

  const updateFilter = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="MyTasks">
      <div className="MyTasks__Header">
        <CheckSquare size={20} className="MyTasks__HeaderIcon" />
        <h2 className="MyTasks__Title">{t('account.myTasks.title')}</h2>
        {!loading && (
          <span className="MyTasks__Count">
            {serverMode && serverTotal != null ? serverTotal : tasks.length}
          </span>
        )}
      </div>

      {/* 필터 바 */}
      <div className="MyTasks__FilterBar">
        {/* 저장된 개인 뷰 스위처 */}
        <SavedViewSwitcher
          savedViews={savedViews}
          activeViewId={activeViewId}
          onApplyView={handleApplyView}
          onSaveView={handleSaveView}
          onUpdateView={handleUpdateView}
          onDeleteView={handleDeleteView}
        />

        {/* 서버 모드(고급 spec 또는 scope='all')에서는 /tasks/query가 기본 status/priority/branch_id를
            적용하지 않으므로, 적용도 안 되면서 활성처럼 보이는 기본 드롭다운을 숨긴다.
            Sort는 SORT_TO_QUERY로 서버 모드에서도 적용되므로 항상 노출한다. */}
        {!serverMode && (
          <>
            <select
              className="MyTasks__Filter"
              value={filters.status}
              onChange={(e) => updateFilter('status', e.target.value)}
            >
              <option value="">{t('account.myTasks.allStatus')}</option>
              {STATUS_CATEGORY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{t(o.labelKey)}</option>
              ))}
            </select>

            <select
              className="MyTasks__Filter"
              value={filters.priority}
              onChange={(e) => updateFilter('priority', e.target.value)}
            >
              <option value="">{t('account.myTasks.allPriority')}</option>
              {PRIORITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{t(o.labelKey)}</option>
              ))}
            </select>

            <select
              className="MyTasks__Filter"
              value={filters.branch_id}
              onChange={(e) => updateFilter('branch_id', e.target.value)}
            >
              <option value="">{t('account.myTasks.allBranches')}</option>
              {branches.map((b) => (
                <option key={b.branch_id} value={b.branch_id}>{b.branch_name}</option>
              ))}
            </select>
          </>
        )}

        <select
          className="MyTasks__Filter MyTasks__Filter--sort"
          value={filters.sort_by}
          onChange={(e) => updateFilter('sort_by', e.target.value)}
        >
          {sortOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {t('account.myTasks.sortOption', { label: t(o.labelKey) })}
            </option>
          ))}
        </select>

        {/* 고급 필터 토글 */}
        <button
          type="button"
          className={`MyTasks__AdvancedBtn ${advancedActive || scope === 'all' ? 'MyTasks__AdvancedBtn--active' : ''}`}
          onClick={() => setAdvancedOpen((prev) => !prev)}
        >
          <SlidersHorizontal size={13} />
          {t('account.myTasks.advancedFilter')}
        </button>
      </div>

      {viewError && (
        <div className="MyTasks__FilterError" role="alert">{viewError}</div>
      )}

      {/* 고급 필터 패널 (크로스브랜치 서버 폴백) */}
      {advancedOpen && (
        <div className="MyTasks__AdvancedPanel">
          <div className="MyTasks__AdvancedHeader">
            <span className="MyTasks__AdvancedTitle">{t('account.myTasks.advancedFilter')}</span>

            {/* 스코프 토글: 내 태스크 vs 전체 브랜치 */}
            <div className="MyTasks__ScopeToggle">
              <button
                type="button"
                className={`MyTasks__ScopeBtn ${scope === 'my' ? 'MyTasks__ScopeBtn--active' : ''}`}
                onClick={() => setScope('my')}
              >{t('account.myTasks.scopeMy')}</button>
              <button
                type="button"
                className={`MyTasks__ScopeBtn ${scope === 'all' ? 'MyTasks__ScopeBtn--active' : ''}`}
                onClick={() => setScope('all')}
              >{t('account.myTasks.scopeAll')}</button>
            </div>

            {advancedActive && (
              <button
                type="button"
                className="MyTasks__AdvancedClear"
                onClick={() => setFilterSpec(emptyGroup())}
              >
                <X size={12} />
                {t('account.myTasks.reset')}
              </button>
            )}
          </div>

          <FilterBuilder
            spec={filterSpec}
            onChange={setFilterSpec}
            members={EMPTY_OPTS}
            labels={EMPTY_OPTS}
            epics={EMPTY_OPTS}
            taskTypes={EMPTY_OPTS}
            workflowStatuses={EMPTY_OPTS}
            customFields={EMPTY_OPTS}
            availableFields={ADVANCED_FIELDS}
          />

          {filterError && (
            <div className="MyTasks__FilterError" role="alert">{filterError}</div>
          )}
        </div>
      )}

      {/* 테이블 */}
      <div className="MyTasks__Table">
        <div className="MyTasks__TableHeader">
          <span />
          <span>{t('account.myTasks.columns.id')}</span>
          <span>{t('account.myTasks.columns.title')}</span>
          <span />
          <span>{t('account.myTasks.columns.branch')}</span>
          <span>{t('account.myTasks.columns.status')}</span>
          <span>{t('account.myTasks.columns.due')}</span>
          <span>{t('account.myTasks.columns.priority')}</span>
        </div>

        {loading ? (
          <div className="MyTasks__Empty">{t('common.state.loading')}</div>
        ) : tasks.length === 0 ? (
          <div className="MyTasks__Empty">
            <Inbox size={32} className="MyTasks__EmptyIcon" />
            <p>{t('account.myTasks.empty')}</p>
          </div>
        ) : (
          tasks.map((task) => (
            <MyTasksRow key={task.task_id} task={task} onRefresh={fetchTasks} />
          ))
        )}
      </div>
    </div>
  );
}

// -- Row --
function MyTasksRow({ task, onRefresh }) {
  const { t } = useTranslation();
  // /tasks/query items는 branch_id를 돌려주지 않는다(branch_key/branch_name만).
  // branch_id 없으면 상세/브랜치 링크·인라인 PATCH가 /branch/undefined로 깨지므로
  // 해당 인터랙션만 비활성화하고 행 자체는 그대로 렌더(non-crashing).
  const hasBranch = task.branch_id != null;

  const handleFieldChange = async (field, value) => {
    if (!hasBranch) return;
    try {
      await axios.patch(`/branches/${task.branch_id}/tasks/${task.task_id}`, { [field]: value });
      window.dispatchEvent(new Event('task:updated'));
    } catch {}
  };

  // date-only는 timezone 변환하지 않는다(new Date(dateStr)는 UTC 자정으로 파싱된다).
  const { formatDateOnlyShort, isOverdue: overdueFor } = useDateFormat();
  const formatDate = (dateStr) => formatDateOnlyShort(dateStr) || '-';

  const category = task.status_category || task.status;
  // 연체는 **개인 timezone의 오늘**과 due_date를 문자열로 비교한다. due today는 그 사용자의
  // 하루가 끝나기 전까지 연체가 아니다. 저장하지 않는 viewer별 파생 표시다.
  const isOverdue = overdueFor(task.due_date, category);

  return (
    <div className="MyTasksRow">
      {/* 행 전체를 덮는 오버레이 링크(stretched link): 가운데/ctrl/우클릭 새 탭 지원.
          내부 인터랙티브(브랜치 링크·셀렉트)는 z-index로 이 위에 떠서 각자 동작한다. */}
      {hasBranch && (
        <NavLink
          className="MyTasksRow__Overlay"
          href={`/branch/${task.branch_id}/task/${task.task_id}`}
          aria-label={task.title}
        />
      )}

      {/* 타입 아이콘 */}
      <span className="MyTasksRow__TypeIcon">
        <TaskTypeIcon name="CheckSquare" size={14} color="var(--color-primary)" />
      </span>

      {/* Display ID */}
      <span className="MyTasksRow__Id">{task.display_id}</span>

      {/* 제목 */}
      <span className="MyTasksRow__Title">{task.title}</span>

      {/* 라벨 */}
      <div className="MyTasksRow__Labels">
        {(task.labels || []).map((label) => {
          const tint = entityTintStyle(label.color, { alpha: '20' });
          return (
            <span
              key={label.label_id}
              className={`MyTasksRow__Label${tint?.['--et-on'] ? ' EntityTint' : ''}`}
              style={tint}
            >
              {label.label_name}
            </span>
          );
        })}
      </div>

      {/* 브랜치 (오버레이 위 별도 링크) — branch_id 없으면(쿼리 items) 비링크 표시 */}
      {hasBranch ? (
        <NavLink
          className="MyTasksRow__Branch"
          href={`/branch/${task.branch_id}`}
          onClick={(e) => e.stopPropagation()}
        >
          <EntityIcon
            icon={task.branch_icon}
            color={task.branch_color}
            size={14}
            entityType="branch"
          />
          {task.branch_key}
        </NavLink>
      ) : (
        <span className="MyTasksRow__Branch">
          <EntityIcon
            icon={task.branch_icon}
            color={task.branch_color}
            size={14}
            entityType="branch"
          />
          {task.branch_key}
        </span>
      )}

      {/* 상태 */}
      <div className="MyTasksRow__Cell" onClick={(e) => e.stopPropagation()}>
        {(() => {
          // 저장색이 없거나 지원 밖이면 EntityTint를 붙이지 않는다 —
          // MyTasksRow__Status--<category> 클래스가 주는 배경·글자색이 유일한 소스로 남아야 한다.
          const tint = entityTintStyle(task.status_color, { alpha: '20' });
          return (
            <span
              className={`MyTasksRow__Status MyTasksRow__Status--${category}${tint?.['--et-on'] ? ' EntityTint' : ''}`}
              style={tint}
            >
              {task.status_label || task.status}
            </span>
          );
        })()}
      </div>

      {/* 마감일 */}
      <span className={`MyTasksRow__DueDate ${isOverdue ? 'MyTasksRow__DueDate--overdue' : ''}`}>
        {formatDate(task.due_date)}
      </span>

      {/* 우선순위 (인라인 변경) */}
      <div className="MyTasksRow__Cell" onClick={(e) => e.stopPropagation()}>
        <CustomSelect
          value={task.priority || 'low'}
          options={PRIORITY_OPTIONS.map((o) => ({ ...o, label: t(o.labelKey) }))}
          onChange={(val) => handleFieldChange('priority', val)}
          size="sm"
          hideArrow
          className={`MyTasksRow__Priority MyTasksRow__Priority--${task.priority || 'low'}`}
        />
      </div>
    </div>
  );
}
