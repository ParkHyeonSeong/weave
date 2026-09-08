import { useDateFormat } from '@/hooks/useDateFormat';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { axios } from '@/library/_axios';
import { LayoutGrid } from 'lucide-react';
import BoardColumn from './BoardColumn';
import TaskFilterBar from '../TaskFilterBar';
import useTaskContextMenu from '@/components/Branch/Tasks/taskMenu';
import ContextMenu from '@/components/common/ContextMenu';
import ConfirmModal from '@/components/modal/ConfirmModal';
import ParentPickerPopup from '@/components/Branch/Tasks/ParentPickerPopup';
import { matchesFilters } from '@/library/taskFilters';
import { buildEffectiveSpec } from '@/library/filterSpecAdapter';
import { groupTasks, applySort } from '@/library/taskViewState';
import { emptyGroup } from '@/library/filterBuilderState';
import { useTranslation } from 'react-i18next';

// localStorage 키 — TaskList의 'weave_tasks_{branchId}_filters'와 충돌하지 않도록 board 전용 키.
const boardStorageKey = (branchId) => `weave_board_${branchId}_filters`;

// Set <-> Array 직렬화 (TaskList 패턴 동일)
const setToArray = (s) => [...(s || [])];
const arrayToSet = (a) => new Set(a || []);

// localStorage 안전 읽기 (SSR 대응)
function loadJSON(key, fallback) {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

// 현재 사용자 id — FilterSpec 평가기 $me 해석용 (TaskList와 동일 컨벤션).
function currentUserId() {
  if (typeof window === 'undefined') return null;
  try {
    return JSON.parse(sessionStorage.getItem('profile') || '{}').user_id ?? null;
  } catch {
    return null;
  }
}

export default function BoardView({ branchId, branchKey, taskTypes, workflowStatuses, onSelectTask }) {
  const { t } = useTranslation();
  const { daysUntil, today: personalToday, timeZone } = useDateFormat();
  const taskMenu = useTaskContextMenu({ branchId, onSelectTask });
  const [columns, setColumns] = useState({});
  const [activeSprints, setActiveSprints] = useState([]);
  const [selectedSprintId, setSelectedSprintId] = useState(null); // null = All
  const [members, setMembers] = useState([]);
  const [epics, setEpics] = useState([]);
  const [labels, setLabels] = useState([]);
  const [loading, setLoading] = useState(true);

  // 필터 상태 (localStorage에서 복원)
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUserIds, setSelectedUserIds] = useState(new Set());
  const [filters, setFilters] = useState({
    priorities: new Set(),
    labelIds: new Set(),
    epicIds: new Set(),
    typeKeys: new Set(),
    statusKeys: new Set(),
  });

  // 고급 빌더 spec / 그룹핑(스윔레인) / 다중정렬 (localStorage에서 복원)
  const [filterSpec, setFilterSpec] = useState(emptyGroup());
  const [groupBy, setGroupBy] = useState('none');
  const [multiSort, setMultiSort] = useState([]);

  // task type별 custom field 메타 (고급 빌더 cf 조건용)
  const [customFields, setCustomFields] = useState([]);

  // localStorage 초기화 완료 여부 (마운트 시 불필요한 write 방지)
  const [initialized, setInitialized] = useState(false);

  // localStorage에서 필터/그룹핑/정렬 상태 복원 (branchId 변경 시) — TaskList 패턴 미러
  useEffect(() => {
    const saved = loadJSON(boardStorageKey(branchId), null);
    if (saved) {
      setSearchQuery(saved.searchQuery || '');
      setSelectedUserIds(arrayToSet(saved.selectedUserIds));
      setFilters({
        priorities: arrayToSet(saved.filters?.priorities),
        labelIds: arrayToSet(saved.filters?.labelIds),
        epicIds: arrayToSet(saved.filters?.epicIds),
        typeKeys: arrayToSet(saved.filters?.typeKeys),
        statusKeys: arrayToSet(saved.filters?.statusKeys),
      });
      setFilterSpec(saved.filterSpec && saved.filterSpec.type === 'group' ? saved.filterSpec : emptyGroup());
      setGroupBy(saved.groupBy || 'none');
      setMultiSort(Array.isArray(saved.sort) ? saved.sort : []);
    } else {
      setSearchQuery('');
      setSelectedUserIds(new Set());
      setFilters({
        priorities: new Set(), labelIds: new Set(),
        epicIds: new Set(), typeKeys: new Set(), statusKeys: new Set(),
      });
      setFilterSpec(emptyGroup());
      setGroupBy('none');
      setMultiSort([]);
    }
    setInitialized(true);
  }, [branchId]);

  // 필터/그룹핑/정렬 변경 시 localStorage 저장
  useEffect(() => {
    if (!initialized) return;
    const data = {
      searchQuery,
      selectedUserIds: setToArray(selectedUserIds),
      filters: {
        priorities: setToArray(filters.priorities),
        labelIds: setToArray(filters.labelIds),
        epicIds: setToArray(filters.epicIds),
        typeKeys: setToArray(filters.typeKeys),
        statusKeys: setToArray(filters.statusKeys),
      },
      filterSpec,
      groupBy,
      sort: multiSort,
    };
    localStorage.setItem(boardStorageKey(branchId), JSON.stringify(data));
  }, [branchId, searchQuery, selectedUserIds, filters, filterSpec, groupBy, multiSort, initialized]);

  useEffect(() => {
    fetchActiveSprints();
    fetchOptions();
  }, [branchId]);

  // task:updated 이벤트
  useEffect(() => {
    const handleRefresh = () => fetchActiveSprints();
    window.addEventListener('task:updated', handleRefresh);
    return () => window.removeEventListener('task:updated', handleRefresh);
  }, [branchId, selectedSprintId]); // ← selectedSprintId 추가 (stale closure 방지)

  const fetchActiveSprints = async () => {
    try {
      const res = await axios.get(`/branches/${branchId}/sprints`);
      if (res.data.status) {
        const actives = res.data.sprints.filter((s) => s.status === 'active');
        setActiveSprints(actives);
        if (actives.length > 0) {
          fetchBoard(selectedSprintId);
        } else {
          setColumns({});
          setLoading(false);
        }
      }
    } catch {
      setLoading(false);
    }
  };

  const fetchOptions = async () => {
    try {
      const res = await axios.get(`/branches/${branchId}/members`);
      if (res.data.status) setMembers(res.data.members);
    } catch {}
    try {
      const res = await axios.get(`/branches/${branchId}/epics`);
      if (res.data.status) setEpics(res.data.epics);
    } catch {}
    try {
      const res = await axios.get(`/branches/${branchId}/labels`);
      if (res.data.status) setLabels(res.data.labels);
    } catch {}
    // custom field 메타 — 고급 빌더 cf 조건용 (task type별 엔드포인트 병합, 실패 시 [] 폴백)
    try {
      const typeIds = (taskTypes || []).map((t) => t.type_id).filter((id) => id != null);
      if (typeIds.length === 0) { setCustomFields([]); return; }
      const results = await Promise.all(
        typeIds.map((typeId) =>
          axios
            .get(`/branches/${branchId}/task-types/${typeId}/custom-fields`)
            .then((r) => (r.data?.status ? (r.data.fields || []) : []))
            .catch(() => [])),
      );
      const byId = new Map();
      results.flat().forEach((cf) => {
        if (cf && cf.custom_field_id != null && !byId.has(cf.custom_field_id)) {
          byId.set(cf.custom_field_id, {
            custom_field_id: cf.custom_field_id,
            field_name: cf.field_name,
            field_type: cf.field_type,
            field_options: cf.field_options,
          });
        }
      });
      setCustomFields([...byId.values()]);
    } catch {
      setCustomFields([]);
    }
  };

  const fetchBoard = async (sprintId) => {
    try {
      const params = sprintId ? { sprint_id: sprintId } : {};
      const res = await axios.get(`/branches/${branchId}/tasks/board`, { params });
      if (res.data.status) {
        setColumns(res.data.columns);
      }
    } catch {}
    setLoading(false);
  };

  const handleSprintTabClick = (sprintId) => {
    setSelectedSprintId(sprintId);
    fetchBoard(sprintId);
  };

  const handleStatusChange = async (taskId, newStatus) => {
    try {
      await axios.patch(`/branches/${branchId}/tasks/${taskId}`, { status: newStatus });
      fetchBoard(selectedSprintId);
    } catch {}
  };

  // 필터 토글
  const handleToggleUser = (userId) => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const handleToggleFilter = (category, value) => {
    setFilters((prev) => {
      const next = { ...prev, [category]: new Set(prev[category]) };
      if (next[category].has(value)) next[category].delete(value);
      else next[category].add(value);
      return next;
    });
  };

  const handleClearFilters = () => {
    setFilters({
      priorities: new Set(),
      labelIds: new Set(),
      epicIds: new Set(),
      typeKeys: new Set(),
      statusKeys: new Set(),
    });
  };

  // 레거시 quick-chip + 고급 빌더 spec 합성 → 단일 effectiveSpec (TaskList 패턴 동일).
  const userId = useMemo(() => currentUserId(), []);
  // $today는 **개인 timezone의 오늘**이다 — new Date().toISOString()의 UTC 날짜를 쓰면
  // 뉴욕 저녁에 하루 앞선 날짜가 되어 백엔드 저장 필터의 $today와 갈린다.
  // timeZone이 바뀌면(설정 변경) 다시 계산되도록 의존성에 둔다.
  const today = useMemo(() => personalToday(), [personalToday, timeZone]);
  const effectiveSpec = useMemo(
    () => buildEffectiveSpec({ legacyCtx: { searchQuery, selectedUserIds, filters }, filterSpec }),
    [searchQuery, selectedUserIds, filters, filterSpec],
  );
  const filterCtx = useMemo(
    () => ({ spec: effectiveSpec, userId, today }),
    [effectiveSpec, userId, today],
  );

  // 클라이언트 사이드 필터링 (레거시 chip AND 고급 빌더 spec)
  const filterTasks = (tasks) => tasks.filter((t) => matchesFilters(t, filterCtx));

  // ── 스윔레인(그룹핑) 모드 ───────────────────────────────────────────
  // groupBy 'none'/'status' = 단일 보드(상태 컬럼). 그 외 = 그룹별 가로 스윔레인.
  // (보드에서 'status'는 컬럼 자체가 상태이므로 스윔레인 불필요 → 단일 보드로 취급)
  const swimlaneMode = groupBy !== 'none' && groupBy !== 'status';

  // 버킷 키 → 사람이 읽는 라벨 (브랜치 메타 lookup, null 키는 'Unassigned'/'No epic' 등)
  const groupLabelFor = useCallback((key) => {
    if (key === null || key === undefined) {
      return {
        assignee: t('branch.board.group.unassigned'),
        epic: t('branch.board.group.noEpic'),
        sprint: t('branch.board.group.noSprint'),
        label: t('branch.board.group.noLabel'),
        priority: t('branch.board.group.noPriority'),
      }[groupBy] || t('branch.board.group.none');
    }
    switch (groupBy) {
      case 'assignee': {
        const m = (members || []).find((x) => x.user_id === key);
        return m ? (m.username || m.email) : t('branch.board.group.userFallback', { id: key });
      }
      case 'epic':
        return (epics || []).find((e) => e.epic_id === key)?.epic_name || t('branch.board.group.epicFallback', { id: key });
      case 'sprint':
        return (activeSprints || []).find((s) => s.sprint_id === key)?.sprint_name || t('branch.board.group.sprintFallback', { id: key });
      case 'label':
        return (labels || []).find((l) => l.label_id === key)?.label_name || t('branch.board.group.labelFallback', { id: key });
      case 'priority':
        return { urgent: t('branch.priority.urgent'), high: t('branch.priority.high'), medium: t('branch.priority.medium'), low: t('branch.priority.low') }[key] || String(key);
      default:
        return String(key);
    }
  }, [groupBy, members, epics, labels, activeSprints, t]);

  // 모든 컬럼의 태스크를 평탄화 → 필터 → 그룹 버킷화.
  // 각 버킷은 동일한 상태 컬럼 세트를 갖되 그 버킷 태스크로만 스코프된다.
  const swimlanes = useMemo(() => {
    if (!swimlaneMode) return [];
    const all = Object.values(columns || {}).flat();
    const visible = all.filter((t) => matchesFilters(t, filterCtx));
    // 다중정렬이 설정된 경우에만 적용(빈 키면 applySort가 task_id로 재정렬해 백엔드 sort_order를 파괴).
    const ordered = (multiSort && multiSort.length) ? applySort(visible, multiSort) : visible;
    return groupTasks(ordered, groupBy).map((b) => ({
      key: b.key,
      label: groupLabelFor(b.key),
      tasks: b.tasks,
    }));
  }, [swimlaneMode, columns, filterCtx, groupBy, multiSort, groupLabelFor]);

  if (loading) return <div className="BoardView" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200, color: 'var(--color-text-secondary)', fontSize: 14 }}>{t('common.state.loading')}</div>;

  // active sprint 없는 경우
  if (activeSprints.length === 0) {
    return (
      <div className="BoardView">
        <div className="BoardView__Empty">
          <LayoutGrid size={40} />
          <p className="BoardView__EmptyTitle">{t('branch.board.noActiveSprintTitle')}</p>
          <p className="BoardView__EmptyDesc">
            {t('branch.board.noActiveSprintDesc')}
          </p>
        </div>
      </div>
    );
  }

  // 선택된 sprint의 남은 일수
  const selectedSprint = selectedSprintId
    ? activeSprints.find((s) => s.sprint_id === selectedSprintId)
    : null;

  // end_date는 date-only다. new Date('YYYY-MM-DD')는 UTC 자정 instant라 음수 offset 지역에서
  // 하루 이르게 0/음수가 된다 — 개인 timezone의 오늘과 달력 일수로 센다.
  const getRemainingDays = (sprint) => {
    if (!sprint?.end_date) return null;
    return daysUntil(sprint.end_date);
  };

  return (
    <div className="BoardView">
      {/* Sprint 탭 + 필터 */}
      <div className="BoardView__Header">
        <div className="BoardView__SprintTabs">
          <button
            className={`BoardView__SprintTab ${selectedSprintId === null ? 'BoardView__SprintTab--active' : ''}`}
            onClick={() => handleSprintTabClick(null)}
          >
            {t('branch.board.allSprints')}
          </button>
          {activeSprints.map((sprint) => {
            const days = getRemainingDays(sprint);
            return (
              <button
                key={sprint.sprint_id}
                className={`BoardView__SprintTab ${selectedSprintId === sprint.sprint_id ? 'BoardView__SprintTab--active' : ''}`}
                onClick={() => handleSprintTabClick(sprint.sprint_id)}
              >
                {sprint.sprint_name}
                {days !== null && (
                  <span className={`BoardView__SprintDays ${days < 0 ? 'BoardView__SprintDays--overdue' : ''}`}>
                    {days < 0
                      ? t('branch.board.daysOverdue', { count: Math.abs(days) })
                      : t('branch.board.daysLeft', { count: days })}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <TaskFilterBar
          members={members}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          selectedUserIds={selectedUserIds}
          onToggleUser={handleToggleUser}
          labels={labels}
          epics={epics}
          taskTypes={taskTypes}
          workflowStatuses={workflowStatuses}
          filters={filters}
          onToggleFilter={handleToggleFilter}
          onClearFilters={handleClearFilters}
          filterSpec={filterSpec}
          onFilterSpecChange={setFilterSpec}
          groupBy={groupBy}
          onGroupByChange={setGroupBy}
          sort={multiSort}
          onMultiSortChange={setMultiSort}
          customFields={customFields}
          availableFields={[
            'status', 'priority', 'task_type', 'label', 'assignee', 'text',
            'has_subtasks', 'is_top_level',
          ]}
          groupByOptions={['none', 'status', 'assignee', 'label', 'priority']}
        />
      </div>

      {selectedSprint?.goal && (
        <div className="BoardView__SprintGoal">{selectedSprint.goal}</div>
      )}

      {/* 칸반: 단일 보드(none/status) 또는 그룹별 스윔레인 */}
      {!swimlaneMode ? (
        <div className="BoardView__Columns">
          {(workflowStatuses || []).map((ws) => {
            // 필터 → (다중정렬이 있을 때만) 정렬. 빈 정렬이면 백엔드 sort_order(수동 랭크) 보존.
            const filtered = filterTasks(columns[ws.key] || []);
            const ordered = (multiSort && multiSort.length) ? applySort(filtered, multiSort) : filtered;
            return (
              <BoardColumn
                key={ws.key}
                status={ws.key}
                label={ws.label}
                color={ws.color}
                tasks={ordered}
                taskTypes={taskTypes}
                onCardClick={(task) => onSelectTask(task)}
                onCardContextMenu={taskMenu.openMenu}
                onStatusChange={handleStatusChange}
              />
            );
          })}
        </div>
      ) : (
        <div className="BoardView__Swimlanes">
          {swimlanes.length === 0 && (
            <div className="BoardView__Empty">
              <p className="BoardView__EmptyDesc">{t('branch.board.noTasks')}</p>
            </div>
          )}
          {swimlanes.map((lane) => (
            <div className="BoardView__Swimlane" key={String(lane.key)}>
              <div className="BoardView__SwimlaneHeader">
                <span className="BoardView__SwimlaneLabel">{lane.label}</span>
                <span className="BoardView__SwimlaneCount">{lane.tasks.length}</span>
              </div>
              <div className="BoardView__Columns">
                {(workflowStatuses || []).map((ws) => (
                  <BoardColumn
                    key={ws.key}
                    status={ws.key}
                    label={ws.label}
                    color={ws.color}
                    tasks={lane.tasks.filter((t) => t.status === ws.key)}
                    taskTypes={taskTypes}
                    onCardClick={(task) => onSelectTask(task)}
                    onCardContextMenu={taskMenu.openMenu}
                    onStatusChange={handleStatusChange}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <ContextMenu {...taskMenu.menuProps} />
      <ConfirmModal
        isOpen={!!taskMenu.confirmTask}
        onClose={taskMenu.clearConfirm}
        onConfirm={taskMenu.handleConfirmDelete}
        title={taskMenu.confirmTitle}
        message={taskMenu.confirmMessage}
        confirmLabel={t('common.actions.delete')}
        variant="danger"
      />
      {taskMenu.parentPicker && createPortal(
        // containment(panel-host) 밖으로 탈출: fixed 백드롭이 .BranchDetail에 갇히지 않도록 body에 포탈
        <div className="ParentPickerPopup__Backdrop" onMouseDown={taskMenu.closeParentPicker}>
          <ParentPickerPopup
            branchId={branchId}
            sourceTask={taskMenu.parentPicker.task}
            onPick={taskMenu.handlePickParent}
            onClose={taskMenu.closeParentPicker}
          />
        </div>,
        document.body
      )}
    </div>
  );
}
