import { useMemo, useState, useRef, useEffect } from 'react';
import { Search, User, X, ArrowUpDown, ArrowUp, ArrowDown, SlidersHorizontal, Plus } from 'lucide-react';
import MultiSelect from '@/components/common/MultiSelect';
import TaskTypeIcon from '@/components/common/TaskTypeIcon';
import Avatar from '@/components/common/Avatar';
import SavedViewSwitcher from '@/components/common/SavedViewSwitcher';
import { isEmptySpec, emptyGroup } from '@/library/filterBuilderState';
import FilterBuilder from './FilterBuilder';
import { priorityVar, chipTintStyle } from '@/library/themePalette';
import { entityBorderStyle, entityTintStyle } from '@/library/entityTint';
import { useTranslation } from 'react-i18next';

const MAX_VISIBLE = 5;

const SORT_OPTIONS = [
  { value: 'priority', labelKey: 'branch2.filters.fields.priority' },
  { value: 'due_date', labelKey: 'branch2.filters.fields.dueDate' },
  { value: 'status', labelKey: 'branch2.filters.fields.status' },
  { value: 'created', labelKey: 'branch2.filters.fields.created' },
];

// 그룹핑 키 (taskViewState.groupTasks의 KEY와 의미 일치)
const GROUP_BY_OPTIONS = [
  { value: 'none', labelKey: 'branch2.filters.noGrouping' },
  { value: 'status', labelKey: 'branch2.filters.fields.status' },
  { value: 'assignee', labelKey: 'branch2.filters.fields.assignee' },
  { value: 'epic', labelKey: 'branch2.filters.fields.epic' },
  { value: 'sprint', labelKey: 'branch2.filters.fields.sprint' },
  { value: 'label', labelKey: 'branch2.filters.fields.label' },
  { value: 'priority', labelKey: 'branch2.filters.fields.priority' },
];

// 다중정렬 키 = SORT_OPTIONS에서 'status' 제외. 다중정렬은 taskViewState.applySort로 평가되는데
// 'status'는 워크플로 순서(sort_order)가 클라이언트 페이로드에 없어 의미 있게 정렬되지 않는다.
// (레거시 단일키 Sort 버튼은 SORT_OPTIONS를 그대로 써 status=워크플로 순서로 올바르게 정렬한다.)
const MULTI_SORT_FIELDS = SORT_OPTIONS.filter((o) => o.value !== 'status');

const PRIORITY_OPTIONS = [
  { value: 'urgent', labelKey: 'branch2.filters.priorityValues.urgent', color: priorityVar('urgent') },
  { value: 'high', labelKey: 'branch2.filters.priorityValues.high', color: priorityVar('high') },
  { value: 'medium', labelKey: 'branch2.filters.priorityValues.medium', color: priorityVar('medium') },
  { value: 'low', labelKey: 'branch2.filters.priorityValues.low', color: priorityVar('low') },
];

export default function TaskFilterBar({
  members, searchQuery, onSearchChange, selectedUserIds, onToggleUser,
  labels = [], epics = [], taskTypes = [], workflowStatuses = [],
  filters = {}, onToggleFilter, onClearFilters,
  sortConfig, onSortChange,
  // 고급 빌더 + 그룹핑 + 다중정렬 (Task 4.4)
  filterSpec, onFilterSpecChange,
  groupBy = 'none', onGroupByChange,
  sort = [], onMultiSortChange,
  customFields = [],
  availableFields,
  groupByOptions,
  // 저장된 뷰 스위처 (Phase 2 — onApplyView 있을 때만 렌더; Board 등 미사용 호출자엔 미노출)
  savedViews = [], activeViewId = null, onApplyView, onSaveView, onUpdateView, onDeleteView,
  pinnedViewIds = [], onTogglePin,
}) {
  const { t } = useTranslation();
  // 라벨은 렌더 시점에 번역한다(모듈 상수는 키만 들고 있다).
  const priorityOptions = useMemo(
    () => PRIORITY_OPTIONS.map((o) => ({ ...o, label: t(o.labelKey) })),
    [t],
  );
  // 호출자가 group-by 옵션을 제한할 수 있다(예: Board는 payload가 epic_id/sprint_id 미포함).
  // 미지정 시 전체 GROUP_BY_OPTIONS. 'none'은 항상 유지(그룹핑 해제 보장).
  const groupOptions = groupByOptions
    ? GROUP_BY_OPTIONS.filter((o) => o.value === 'none' || groupByOptions.includes(o.value))
    : GROUP_BY_OPTIONS;
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const advancedRef = useRef(null);

  // 고급 패널 외부 클릭 닫기
  useEffect(() => {
    if (!advancedOpen) return;
    const handleClick = (e) => {
      if (advancedRef.current && !advancedRef.current.contains(e.target)) setAdvancedOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [advancedOpen]);

  const advancedActive = !isEmptySpec(filterSpec);

  // 외부 클릭 닫기
  useEffect(() => {
    if (!sortOpen) return;
    const handleClick = (e) => {
      if (sortRef.current && !sortRef.current.contains(e.target)) setSortOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [sortOpen]);

  // 멤버 +N 팝오버 외부 클릭 닫기
  useEffect(() => {
    if (!moreOpen) return;
    const handleClick = (e) => {
      if (moreRef.current && !moreRef.current.contains(e.target)) setMoreOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [moreOpen]);
  const activeSortOption = SORT_OPTIONS.find((o) => o.value === sortConfig?.field);
  const visibleMembers = members.slice(0, MAX_VISIBLE);
  const remaining = members.length - MAX_VISIBLE;

  // 활성 필터 총 개수
  const activeCount = useMemo(() => {
    return (filters.priorities?.size || 0)
      + (filters.labelIds?.size || 0)
      + (filters.epicIds?.size || 0)
      + (filters.typeKeys?.size || 0)
      + (filters.statusKeys?.size || 0);
  }, [filters]);

  // 활성 필터 칩 목록
  const activeChips = useMemo(() => {
    const chips = [];
    (filters.priorities || new Set()).forEach((v) => {
      const opt = priorityOptions.find((o) => o.value === v);
      if (opt) chips.push({ category: 'priorities', value: v, label: opt.label, color: opt.color });
    });
    (filters.statusKeys || new Set()).forEach((v) => {
      const ws = workflowStatuses.find((s) => s.key === v);
      if (ws) chips.push({ category: 'statusKeys', value: v, label: ws.label, color: ws.color });
    });
    (filters.typeKeys || new Set()).forEach((v) => {
      const tt = taskTypes.find((ty) => ty.type_key === v);
      if (tt) chips.push({ category: 'typeKeys', value: v, label: tt.type_name });
    });
    (filters.labelIds || new Set()).forEach((v) => {
      const lb = labels.find((l) => l.label_id === v);
      if (lb) chips.push({ category: 'labelIds', value: v, label: lb.label_name, color: lb.color });
    });
    (filters.epicIds || new Set()).forEach((v) => {
      const ep = epics.find((e) => e.epic_id === v);
      if (ep) chips.push({ category: 'epicIds', value: v, label: ep.epic_name, color: ep.color });
    });
    return chips;
  }, [filters, labels, epics, taskTypes, workflowStatuses, priorityOptions]);

  return (
    <div className="TaskFilterBar">
      {/* 저장된 뷰 스위처 (onApplyView 제공 시에만 — Board 등 미사용 호출자엔 미노출) */}
      <SavedViewSwitcher
        savedViews={savedViews}
        activeViewId={activeViewId}
        onApplyView={onApplyView}
        onSaveView={onSaveView}
        onUpdateView={onUpdateView}
        onDeleteView={onDeleteView}
        pinnedViewIds={pinnedViewIds}
        onTogglePin={onTogglePin}
      />

      {/* 검색 */}
      <div className="TaskFilterBar__Search">
        <Search size={14} className="TaskFilterBar__SearchIcon" />
        <input
          className="TaskFilterBar__SearchInput"
          placeholder={t('branch2.filters.searchPlaceholder')}
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>

      {/* 필터 드롭다운들 */}
      {onToggleFilter && (
        <div className="TaskFilterBar__Filters">
          <MultiSelect
            label={t('branch2.filters.fields.priority')}
            selectedValues={filters.priorities || new Set()}
            options={priorityOptions}
            onToggle={(val) => onToggleFilter('priorities', val)}
          />

          {workflowStatuses.length > 0 && (
            <MultiSelect
              label={t('branch2.filters.fields.status')}
              selectedValues={filters.statusKeys || new Set()}
              options={workflowStatuses.map((ws) => ({ value: ws.key, label: ws.label, color: ws.color }))}
              onToggle={(val) => onToggleFilter('statusKeys', val)}
            />
          )}

          {taskTypes.length > 0 && (
            <MultiSelect
              label={t('branch2.filters.fields.type')}
              selectedValues={filters.typeKeys || new Set()}
              options={taskTypes.map((tt) => ({
                value: tt.type_key,
                label: tt.type_name,
                icon: <TaskTypeIcon name={tt.icon} size={12} color={tt.color} />,
              }))}
              onToggle={(val) => onToggleFilter('typeKeys', val)}
            />
          )}

          {labels.length > 0 && (
            <MultiSelect
              label={t('branch2.filters.fields.label')}
              selectedValues={filters.labelIds || new Set()}
              options={labels.map((lb) => ({ value: lb.label_id, label: lb.label_name, color: lb.color }))}
              onToggle={(val) => onToggleFilter('labelIds', val)}
            />
          )}

          {epics.length > 0 && (
            <MultiSelect
              label={t('branch2.filters.fields.epic')}
              selectedValues={filters.epicIds || new Set()}
              options={epics.map((ep) => ({ value: ep.epic_id, label: ep.epic_name, color: ep.color || '#5E6AD2' }))}
              onToggle={(val) => onToggleFilter('epicIds', val)}
            />
          )}

          {activeCount > 0 && (
            <button
              type="button"
              className="TaskFilterBar__ClearAll"
              onClick={onClearFilters}
            >
              <X size={12} />
              {t('branch2.filters.clear')}
            </button>
          )}
        </div>
      )}

      {/* Sort 드롭다운 */}
      {onSortChange && (
        <div className="TaskFilterBar__Sort" ref={sortRef}>
          <button
            type="button"
            className={`TaskFilterBar__SortBtn ${sortConfig?.field ? 'TaskFilterBar__SortBtn--active' : ''}`}
            onClick={() => setSortOpen((prev) => !prev)}
          >
            <ArrowUpDown size={13} />
            {activeSortOption ? t(activeSortOption.labelKey) : t('branch2.filters.sort')}
            {sortConfig?.field && (
              sortConfig.direction === 'asc'
                ? <ArrowUp size={11} />
                : <ArrowDown size={11} />
            )}
          </button>
          {sortConfig?.field && (
            <button
              type="button"
              className="TaskFilterBar__SortClear"
              onClick={() => onSortChange(null)}
              title={t('branch2.filters.clearSort')}
            >
              <X size={12} />
            </button>
          )}
          {sortOpen && (
            <div className="TaskFilterBar__SortDropdown">
              {SORT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`TaskFilterBar__SortOption ${sortConfig?.field === opt.value ? 'TaskFilterBar__SortOption--active' : ''}`}
                  onClick={() => {
                    onSortChange(opt.value);
                    if (sortConfig?.field === opt.value && sortConfig?.direction === 'desc') {
                      setSortOpen(false);
                    }
                  }}
                >
                  <span>{t(opt.labelKey)}</span>
                  {sortConfig?.field === opt.value && (
                    sortConfig.direction === 'asc'
                      ? <ArrowUp size={12} />
                      : <ArrowDown size={12} />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Group by 드롭다운 */}
      {onGroupByChange && (
        <div className="TaskFilterBar__GroupBy">
          <select
            className={`TaskFilterBar__GroupBySelect ${groupBy !== 'none' ? 'TaskFilterBar__GroupBySelect--active' : ''}`}
            value={groupBy}
            onChange={(e) => onGroupByChange(e.target.value)}
            title={t('branch2.filters.groupTasksBy')}
          >
            {groupOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.value === 'none' ? t(o.labelKey) : t('branch2.filters.groupPrefix', { label: t(o.labelKey) })}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* 고급 필터 빌더 토글 + 패널 */}
      {onFilterSpecChange && (
        <div className="TaskFilterBar__Advanced" ref={advancedRef}>
          <button
            type="button"
            className={`TaskFilterBar__AdvancedBtn ${advancedActive ? 'TaskFilterBar__AdvancedBtn--active' : ''}`}
            onClick={() => setAdvancedOpen((prev) => !prev)}
          >
            <SlidersHorizontal size={13} />
            {t('branch2.filters.advanced')}
          </button>
          {advancedOpen && (
            <div className="TaskFilterBar__AdvancedPanel">
              <div className="TaskFilterBar__AdvancedHeader">
                <span className="TaskFilterBar__AdvancedTitle">{t('branch2.filters.advanced')}</span>
                {advancedActive && (
                  <button
                    type="button"
                    className="TaskFilterBar__AdvancedClear"
                    onClick={() => onFilterSpecChange(emptyGroup())}
                  >
                    <X size={12} />
                    {t('branch2.filters.reset')}
                  </button>
                )}
              </div>
              <FilterBuilder
                spec={filterSpec}
                onChange={onFilterSpecChange}
                members={members}
                labels={labels}
                epics={epics}
                taskTypes={taskTypes}
                workflowStatuses={workflowStatuses}
                customFields={customFields}
                availableFields={availableFields}
              />

              {/* 다중키 정렬 (그룹핑/플랫 정렬용) */}
              {onMultiSortChange && (
                <div className="TaskFilterBar__MultiSort">
                  <div className="TaskFilterBar__MultiSortTitle">{t('branch2.filters.multiSort')}</div>
                  {sort.map((s, i) => (
                    <div key={i} className="TaskFilterBar__MultiSortRow">
                      <select
                        className="TaskFilterBar__MultiSortField"
                        value={s.field}
                        onChange={(e) => {
                          const next = sort.map((x, j) => (j === i ? { ...x, field: e.target.value } : x));
                          onMultiSortChange(next);
                        }}
                      >
                        {MULTI_SORT_FIELDS.map((f) => (
                          <option key={f.value} value={f.value}>{t(f.labelKey)}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="TaskFilterBar__MultiSortDir"
                        onClick={() => {
                          const next = sort.map((x, j) => (j === i ? { ...x, dir: x.dir === 'desc' ? 'asc' : 'desc' } : x));
                          onMultiSortChange(next);
                        }}
                        title={s.dir === 'desc' ? t('branch2.filters.descending') : t('branch2.filters.ascending')}
                      >
                        {s.dir === 'desc' ? <ArrowDown size={12} /> : <ArrowUp size={12} />}
                      </button>
                      <button
                        type="button"
                        className="TaskFilterBar__MultiSortRemove"
                        onClick={() => onMultiSortChange(sort.filter((_, j) => j !== i))}
                        title={t('branch2.filters.removeSortKey')}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="TaskFilterBar__MultiSortAdd"
                    onClick={() => {
                      const used = new Set(sort.map((s) => s.field));
                      const nextField = (MULTI_SORT_FIELDS.find((f) => !used.has(f.value)) || MULTI_SORT_FIELDS[0]).value;
                      onMultiSortChange([...sort, { field: nextField, dir: 'asc' }]);
                    }}
                  >
                    <Plus size={12} />
                    {t('branch2.filters.addSortKey')}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 활성 필터 칩 */}
      {activeChips.length > 0 && (
        <div className="TaskFilterBar__ActiveFilters">
          {activeChips.map((chip) => {
            // ⚠️ 20개 저장색 소비 지점 중 **이 표면만 색 도메인이 둘**이다(S7 계획 Task 3 호출표 9·10행
            //    = 하이브리드 계약). 그래서 여기만 두 메커니즘을 명시적으로 분기한다.
            //      ① DB 저장색 원시 #RRGGBB (statusKeys·labelIds·epicIds)
            //         → entityTint 경로. 두 테마 값을 --et-*로 내리고 다크 스코프 SCSS가 고른다.
            //      ② priorityVar()가 내는 토큰 참조 var(--color-*) (priorities 4종) + 그 밖의 지원 밖 색
            //         → 기존 --chip-color + taskList.scss color-mix(8.235294%) 경로를 그대로 유지한다.
            // ⛔ ②를 entityTintStyle의 passthrough 결과로 렌더하지 마라 — 색 문자열에 접미가 붙어
            //    `var(--color-error)15`가 되고, var()를 포함한 선언은 계산값 시점에 문법 검사를 받아
            //    무효(IACVT)가 된다. background-color는 비상속이라 transparent로 떨어져 틴트가 통째로
            //    사라진다(library/themePalette.js:52-65 · styles/components/branch/taskList.scss:691-697).
            //    그래서 alpha:'15'는 이 표면에서 **렌더되지 않는다** — 레거시 접미 기록으로만 남긴다.
            const storedTint = entityTintStyle(chip.color, { from: 8, alpha: '15' });
            const storedBorder = entityBorderStyle(chip.color);
            // 판정은 객체 truthiness가 아니라 --et-on 하나뿐이다(passthrough도 객체를 돌려주기 때문).
            const isStoredHex = !!storedTint?.['--et-on'];
            // blank 판정도 단일 기준이다. ⛔ `chip.color ?` truthiness로 재지 마라 —
            // 공백만 있는 문자열('  ', '\t\n')과 비문자열(42)은 entityTintStyle이 blank로
            // 돌려주는데 truthiness는 true라, --tinted 클래스와 무효 선언 `--chip-color:'  '`가 붙는다.
            const hasStoredColor = storedTint !== undefined;
            return (
              <span
                key={`${chip.category}-${chip.value}`}
                className={`TaskFilterBar__ActiveChip${isStoredHex
                  ? ' EntityTint EntityBorder'
                  : (hasStoredColor ? ' TaskFilterBar__ActiveChip--tinted' : '')}`}
                style={isStoredHex
                  ? { ...storedTint, ...storedBorder }
                  : (hasStoredColor ? chipTintStyle(chip.color) : undefined)}
              >
                {chip.label}
                <button
                  type="button"
                  className={`TaskFilterBar__ActiveChipRemove${isStoredHex ? ' EntityInk' : ''}`}
                  onClick={() => onToggleFilter(chip.category, chip.value)}
                  // 이 버튼의 배경은 페이지 표면이 아니라 **칩의 틴트**다. 커스텀 프로퍼티는 상속되므로
                  // 부모가 내려놓은 --et-fg를 그대로 쓴다. 부모가 passthrough면 변수가 없어 치환 실패
                  // (=initial)이므로 그때는 오늘처럼 원 색을 그대로 쓴다.
                  style={hasStoredColor ? { color: isStoredHex ? 'var(--et-fg)' : chip.color } : {}}
                >
                  <X size={10} />
                </button>
              </span>
            );
          })}
        </div>
      )}

      {/* 멤버 아바타 필터 */}
      <div className="TaskFilterBar__Members">
        <button
          type="button"
          className={`TaskFilterBar__Unassigned ${selectedUserIds.has(0) ? 'TaskFilterBar__Unassigned--selected' : ''}`}
          title={t('branch2.filters.unassigned')}
          onClick={() => onToggleUser(0)}
        >
          <User size={14} />
        </button>

        {visibleMembers.map((m) => (
          <button
            key={m.user_id}
            type="button"
            className={`TaskFilterBar__AvatarBtn ${selectedUserIds.has(m.user_id) ? 'TaskFilterBar__AvatarBtn--selected' : ''}`}
            title={m.username || m.email}
            onClick={() => onToggleUser(m.user_id)}
          >
            <Avatar user={m} size="sm" />
          </button>
        ))}

        {remaining > 0 && (
          <div className="TaskFilterBar__More" ref={moreRef}>
            <button
              type="button"
              className="TaskFilterBar__MoreBtn"
              onClick={() => setMoreOpen((prev) => !prev)}
              title={t('branch2.filters.moreMembers')}
            >
              +{remaining}
            </button>
            {moreOpen && (
              <div className="TaskFilterBar__MoreMenu">
                {members.slice(MAX_VISIBLE).map((m) => (
                  <button
                    key={m.user_id}
                    type="button"
                    className={`TaskFilterBar__MoreItem ${selectedUserIds.has(m.user_id) ? 'TaskFilterBar__MoreItem--selected' : ''}`}
                    onClick={() => onToggleUser(m.user_id)}
                  >
                    <Avatar user={m} size="sm" />
                    <span className="TaskFilterBar__MoreItemName">{m.username || m.email}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
