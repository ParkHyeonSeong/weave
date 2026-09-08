import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { axios } from '@/library/_axios';
import { Plus } from 'lucide-react';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import TaskListSprint from './TaskListSprint';
import SprintModal from '@/components/modal/SprintModal';
import CompleteSprintModal from '@/components/modal/CompleteSprintModal';
import TaskFilterBar from '../TaskFilterBar';
import TaskListRow from './TaskListRow';
import useTaskContextMenu from './taskMenu';
import { matchesFilters, filterTaskTree } from '@/library/taskFilters';
import { buildEffectiveSpec } from '@/library/filterSpecAdapter';
import { groupTasks, applySort } from '@/library/taskViewState';
import { emptyGroup, isEmptySpec } from '@/library/filterBuilderState';
import { toSavedPayload, applySavedView } from '@/library/savedViewState';
import { useUiPrefs } from '@/library/UiPrefsContext';
import ContextMenu from '@/components/common/ContextMenu';
import ConfirmModal from '@/components/modal/ConfirmModal';
import ParentPickerPopup from './ParentPickerPopup';
import { useDateFormat } from '@/hooks/useDateFormat';

// localStorage 키 헬퍼
const storageKey = (branchId, type) => `weave_tasks_${branchId}_${type}`;

// Set <-> Array 변환
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

// 우선순위 정렬용 가중치
const PRIORITY_WEIGHT = { urgent: 0, high: 1, medium: 2, low: 3 };

// 레거시 quick-chip 필터의 빈 상태(매 호출 새 Set). 초기화/복원/뷰적용에서 공유해 카테고리 추가 시 단일 수정.
const emptyFilters = () => ({
  priorities: new Set(), labelIds: new Set(), epicIds: new Set(),
  typeKeys: new Set(), statusKeys: new Set(),
});

// 현재 사용자 id — 코드베이스 공통 패턴(TaskDetailPanel.js 등): sessionStorage 'profile'.
// FilterSpec 평가기의 $me 의미 해석(assignee=$me 등)에 쓰인다.
function currentUserId() {
  if (typeof window === 'undefined') return null;
  try {
    return JSON.parse(sessionStorage.getItem('profile') || '{}').user_id ?? null;
  } catch {
    return null;
  }
}

export default function TaskList({ branchId, branchKey, taskTypes, workflowStatuses, onSelectTask, applyViewId = null, onViewApplied }) {
  const { t } = useTranslation();
  const { prefs, setPinnedViews } = useUiPrefs();
  const { today: personalToday, timeZone } = useDateFormat();
  const [sprints, setSprints] = useState([]);
  const [backlogTasks, setBacklogTasks] = useState([]);
  const [epics, setEpics] = useState([]);
  const [members, setMembers] = useState([]);
  const [labels, setLabels] = useState([]);
  const [loading, setLoading] = useState(true);

  // 필터 상태 (localStorage에서 복원)
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUserIds, setSelectedUserIds] = useState(new Set());
  const [filters, setFilters] = useState(emptyFilters());

  // 정렬 상태 (localStorage에서 복원)
  const [sortConfig, setSortConfig] = useState({ field: null, direction: 'asc' });

  // 고급 빌더 spec / 그룹핑 / 다중정렬 (localStorage에서 복원) — Task 4.4
  const [filterSpec, setFilterSpec] = useState(emptyGroup());
  const [groupBy, setGroupBy] = useState('none');
  const [multiSort, setMultiSort] = useState([]);

  // 저장된 뷰 (Phase 2)
  const [savedViews, setSavedViews] = useState([]);
  const [activeViewId, setActiveViewId] = useState(null);
  const [viewError, setViewError] = useState(null);

  // task type별 custom field 메타 (고급 빌더 cf 조건용)
  const [customFields, setCustomFields] = useState([]);

  // 스프린트 접힘 상태 (localStorage에서 복원)
  const [collapsedSprints, setCollapsedSprints] = useState(new Set());

  // 하위태스크 펼침 상태 (per-branch localStorage, sprint-collapse와 동일 패턴)
  const [expandedSubtaskParents, setExpandedSubtaskParents] = useState(new Set());

  // localStorage 초기화 완료 여부 (마운트 시 불필요한 write 방지)
  const [initialized, setInitialized] = useState(false);

  // 모달 상태
  const [sprintModal, setSprintModal] = useState({ open: false, sprint: null });
  const [completeSprint, setCompleteSprint] = useState(null);

  // DnD 상태
  const [activeId, setActiveId] = useState(null);
  const [activeType, setActiveType] = useState(null); // 'sprint' | 'task'
  const [selectedTaskIds, setSelectedTaskIds] = useState(new Set());
  const [dragOverContainerId, setDragOverContainerId] = useState(null);

  const sortActive = sortConfig.field !== null;

  const taskMenu = useTaskContextMenu({ branchId, onSelectTask });

  // 행 전체가 드래그 핸들이므로 입력별로 센서를 분리한다.
  // - 마우스: 5px 이동해야 드래그 시작 → 단순 클릭(태스크 열기)과 구분
  // - 터치: 길게 눌러야 드래그 → 빠른 스와이프는 리스트 스크롤로 보존
  // 키보드 센서는 두지 않는다: 행이 포커스 가능한 activator(tabIndex)를 갖지 않아
  // (행 내부 버튼/셀렉트와의 a11y 충돌을 피하려 attributes 미적용) 키보드 DnD를 시작할 수 없다.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  // localStorage에서 필터/정렬/접힘 상태 복원 (branchId 변경 시)
  useEffect(() => {
    // 필터 복원 (고급 빌더 spec·그룹핑·다중정렬은 동일 'filters' 네임스페이스에 함께 보관)
    const saved = loadJSON(storageKey(branchId, 'filters'), null);
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
      setFilters(emptyFilters());
      setFilterSpec(emptyGroup());
      setGroupBy('none');
      setMultiSort([]);
    }

    // 정렬 복원
    const savedSort = loadJSON(storageKey(branchId, 'sort'), { field: null, direction: 'asc' });
    setSortConfig(savedSort);

    // 접힘 복원
    const savedCollapsed = loadJSON(storageKey(branchId, 'collapsed'), []);
    setCollapsedSprints(new Set(savedCollapsed));

    // 하위태스크 펼침 복원
    const savedExpanded = loadJSON(storageKey(branchId, 'subtasks_expanded'), []);
    setExpandedSubtaskParents(new Set(savedExpanded));

    setInitialized(true);
  }, [branchId]);

  // 필터 변경 시 localStorage 저장 (고급 빌더 spec·그룹핑·다중정렬 포함)
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
    localStorage.setItem(storageKey(branchId, 'filters'), JSON.stringify(data));
  }, [branchId, searchQuery, selectedUserIds, filters, filterSpec, groupBy, multiSort, initialized]);

  // 정렬 변경 시 localStorage 저장
  useEffect(() => {
    if (!initialized) return;
    localStorage.setItem(storageKey(branchId, 'sort'), JSON.stringify(sortConfig));
  }, [branchId, sortConfig, initialized]);

  // 접힘 변경 시 localStorage 저장
  useEffect(() => {
    if (!initialized) return;
    localStorage.setItem(storageKey(branchId, 'collapsed'), JSON.stringify(setToArray(collapsedSprints)));
  }, [branchId, collapsedSprints, initialized]);

  // 하위태스크 펼침 변경 시 localStorage 저장
  useEffect(() => {
    if (!initialized) return;
    localStorage.setItem(
      storageKey(branchId, 'subtasks_expanded'),
      JSON.stringify(setToArray(expandedSubtaskParents)),
    );
  }, [branchId, expandedSubtaskParents, initialized]);

  useEffect(() => {
    fetchData();
    fetchOptions();
  }, [branchId]);

  useEffect(() => {
    const handleRefresh = () => fetchData();
    window.addEventListener('task:updated', handleRefresh);
    return () => window.removeEventListener('task:updated', handleRefresh);
  }, [branchId]);

  // 커스텀 필드 메타 fetch — cf는 task type별 엔드포인트라 type을 순회해 병합한다.
  // branchId/taskTypes 변경 시에만 재요청(typeIds 시그니처 캐시). 실패 시 [] 폴백(차단 없음).
  const cfCacheKey = useRef(null);
  useEffect(() => {
    const typeIds = (taskTypes || []).map((t) => t.type_id).filter((id) => id != null);
    const sig = `${branchId}:${typeIds.join(',')}`;
    if (cfCacheKey.current === sig) return; // 동일 시그니처면 재요청 생략
    cfCacheKey.current = sig;

    if (typeIds.length === 0) { setCustomFields([]); return; }

    let cancelled = false;
    (async () => {
      try {
        const results = await Promise.all(
          typeIds.map((typeId) =>
            axios
              .get(`/branches/${branchId}/task-types/${typeId}/custom-fields`)
              .then((res) => (res.data?.status ? (res.data.fields || []) : []))
              .catch((err) => {
                console.warn(`custom-fields fetch 실패 (type ${typeId})`, err);
                return [];
              })),
        );
        if (cancelled) return;
        // custom_field_id로 dedupe 병합
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
      } catch (err) {
        if (cancelled) return;
        console.warn('custom-fields 병합 실패 — cf 옵션 비활성화', err);
        setCustomFields([]);
      }
    })();
    return () => { cancelled = true; };
  }, [branchId, taskTypes]);

  const fetchOptions = async () => {
    try {
      const epicRes = await axios.get(`/branches/${branchId}/epics`);
      if (epicRes.data.status) setEpics(epicRes.data.epics);
    } catch {}
    try {
      const memberRes = await axios.get(`/branches/${branchId}/members`);
      if (memberRes.data.status) setMembers(memberRes.data.members);
    } catch {}
    try {
      const labelRes = await axios.get(`/branches/${branchId}/labels`);
      if (labelRes.data.status) setLabels(labelRes.data.labels);
    } catch {}
  };

  const fetchData = async () => {
    try {
      const sprintRes = await axios.get(`/branches/${branchId}/sprints`);
      const sprintList = sprintRes.data.status
        ? sprintRes.data.sprints.filter((s) => s.status !== 'closed')
        : [];

      const sprintsWithTasks = await Promise.all(
        sprintList.map(async (sprint) => {
          const taskRes = await axios.get(`/branches/${branchId}/tasks`, {
            params: { sprint_id: sprint.sprint_id },
          });
          return {
            ...sprint,
            tasks: taskRes.data.status ? taskRes.data.tasks : [],
          };
        })
      );

      const backlogRes = await axios.get(`/branches/${branchId}/tasks`);
      const backlog = backlogRes.data.status ? backlogRes.data.tasks : [];

      setSprints(sprintsWithTasks);
      setBacklogTasks(backlog);
    } catch {
      // 에러 무시
    } finally {
      setLoading(false);
    }
  };

  // 필터
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
    setFilters(emptyFilters());
  };

  // ── 저장된 뷰 (Phase 2) ───────────────────────────────────────────────
  const loadSavedViews = useCallback(async () => {
    try {
      const res = await axios.get('/saved-views', { params: { scope_branch_id: branchId } });
      setSavedViews(res.data?.status ? (res.data.views || []) : []);
    } catch {
      setSavedViews([]);
    }
  }, [branchId]);

  useEffect(() => { loadSavedViews(); }, [loadSavedViews]);

  const handleApplyView = (viewId) => {
    const view = savedViews.find((v) => v.view_id === viewId);
    if (!view) return;
    const r = applySavedView(view);
    setFilterSpec(r.filterSpec);
    setGroupBy(r.groupBy);
    setMultiSort(r.multiSort);
    setSortConfig(r.sortConfig);
    // 뷰는 합성된 단일 spec으로 완전 표현 → 레거시 quick-chip 초기화(이중 필터 방지)
    setSearchQuery('');
    setSelectedUserIds(new Set());
    setFilters(emptyFilters());
    setActiveViewId(viewId);
    setViewError(null);
  };

  // 저장/수정 payload: 현재 레거시 quick-chip + 고급 spec을 단일 filter_spec으로 합성.
  // sortConfig(평면 단일정렬)도 전달 → 평면 뷰의 정렬이 저장된다(리뷰 P1).
  const buildViewPayload = () =>
    toSavedPayload({ legacyCtx: { searchQuery, selectedUserIds, filters }, filterSpec, groupBy, multiSort, sortConfig });

  const handleSaveView = async (name) => {
    try {
      const res = await axios.post('/saved-views', { name, scope_branch_id: branchId, ...buildViewPayload(), visibility: 'private' });
      if (res.data?.status) {
        await loadSavedViews();
        setActiveViewId(res.data.view_id);
        setViewError(null);
        window.dispatchEvent(new Event('saved-views:changed'));  // 사이드바 핀 목록 갱신
      } else {
        setViewError(t('branchTasks.views.saveError'));
      }
    } catch {
      setViewError(t('branchTasks.views.saveError'));
    }
  };

  const handleUpdateView = async (viewId) => {
    try {
      const res = await axios.patch(`/saved-views/${viewId}`, buildViewPayload());
      if (res.data?.status) { await loadSavedViews(); setViewError(null); }
      else setViewError(t('branchTasks.views.updateError'));
    } catch {
      setViewError(t('branchTasks.views.updateError'));
    }
  };

  const handleDeleteView = async (viewId) => {
    try {
      const res = await axios.delete(`/saved-views/${viewId}`);
      if (res.data?.status) {
        await loadSavedViews();
        if (activeViewId === viewId) setActiveViewId(null);
        setViewError(null);
        window.dispatchEvent(new Event('saved-views:changed'));  // 사이드바 핀 목록 갱신
      } else {
        setViewError(t('branchTasks.views.deleteError'));
      }
    } catch {
      setViewError(t('branchTasks.views.deleteError'));
    }
  };

  // 사이드바 핀 (per-user, 브랜치별 네임스페이스)
  const pinKey = String(branchId);
  const pinnedViewIds = prefs.saved_view_pins?.[pinKey] || [];
  const handleTogglePin = (viewId) => {
    const next = pinnedViewIds.includes(viewId)
      ? pinnedViewIds.filter((x) => x !== viewId)
      : [...pinnedViewIds, viewId];
    setPinnedViews(pinKey, next);
  };

  // ?view= 딥링크: savedViews 로드 완료 후 1회만 적용한 뒤 onViewApplied로 부모가 applyViewId를 비운다.
  // (탭 전환 시 TaskList가 언마운트/재마운트되는데, 부모가 안 비우면 재마운트마다 뷰가 사용자 필터를 덮어씀)
  const appliedViewRef = useRef(null);
  useEffect(() => {
    if (!applyViewId) { appliedViewRef.current = null; return; } // 부모가 비우면 같은 핀 재클릭 위해 리셋
    if (appliedViewRef.current === applyViewId) return;          // savedViews 갱신으로 effect 재실행돼도 1회만
    if (!savedViews.some((v) => v.view_id === applyViewId)) return; // 아직 로드 전 → savedViews 갱신 시 재시도
    appliedViewRef.current = applyViewId;
    handleApplyView(applyViewId);
    onViewApplied?.();
  }, [applyViewId, savedViews]); // eslint-disable-line react-hooks/exhaustive-deps

  const advancedActive = !isEmptySpec(filterSpec);

  const isFilterActive =
    searchQuery.length > 0 || selectedUserIds.size > 0 ||
    filters.priorities.size > 0 || filters.labelIds.size > 0 ||
    filters.epicIds.size > 0 || filters.typeKeys.size > 0 || filters.statusKeys.size > 0 ||
    advancedActive;

  // 레거시 quick-chip + 고급 빌더 spec 합성 → 단일 effectiveSpec.
  // filterCtx.spec 분기(taskFilters.js)로 평가하므로 filters.priorities 직접 접근 없음.
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

  const filterTasks = (tasks) => {
    if (!isFilterActive) return tasks;
    return filterTaskTree(tasks, filterCtx);
  };

  // 정렬
  const sortTasks = useCallback((tasks) => {
    if (!sortConfig.field) return tasks;
    const { field, direction } = sortConfig;
    const dir = direction === 'asc' ? 1 : -1;

    // workflow status sort_order 매핑
    const statusOrderMap = {};
    (workflowStatuses || []).forEach((ws, i) => {
      statusOrderMap[ws.key] = i;
    });

    return [...tasks].sort((a, b) => {
      let cmp = 0;
      switch (field) {
        case 'priority':
          cmp = (PRIORITY_WEIGHT[a.priority] ?? 4) - (PRIORITY_WEIGHT[b.priority] ?? 4);
          break;
        case 'due_date': {
          // date-only는 0패딩 ISO라 문자열 비교가 곧 날짜순 — instant로 파싱하지 않는다.
          // 마감 없음은 맨 뒤.
          const da = a.due_date ? String(a.due_date).slice(0, 10) : '9999-99-99';
          const db = b.due_date ? String(b.due_date).slice(0, 10) : '9999-99-99';
          cmp = da < db ? -1 : da > db ? 1 : 0;
          break;
        }
        case 'status':
          cmp = (statusOrderMap[a.status] ?? 999) - (statusOrderMap[b.status] ?? 999);
          break;
        case 'created':
          cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
          break;
        default:
          break;
      }
      return cmp * dir;
    });
  }, [sortConfig, workflowStatuses]);

  // 필터 + 정렬 적용 (순수: visibleSubtasks 붙이고 정렬만)
  const applyFilterAndSort = (tasks) => sortTasks(filterTasks(tasks));

  // 주의: countMatchedTasks(@/library/taskFilters)는 "컨텍스트 부모만 자동 펼침"을 전제로 배지 수를 센다.
  // 아래 로직(직접 매칭 부모는 펼치지 않음)을 바꾸면 배지와 화면 행 수가 desync 되므로 함께 수정할 것.

  // 필터 active 동안 "부모는 불일치, 하위만 일치"인 부모 id 집합
  const autoExpandedParents = useMemo(() => {
    if (!isFilterActive) return new Set();
    const all = [...sprints.flatMap((s) => s.tasks || []), ...backlogTasks];
    const ids = new Set();
    all.forEach((t) => {
      if (matchesFilters(t, filterCtx)) return;               // 부모 직접 매칭 → 자동펼침 불필요
      if ((t.subtasks || []).some((sub) => matchesFilters(sub, filterCtx))) ids.add(t.task_id);
    });
    return ids;
  }, [isFilterActive, sprints, backlogTasks, filterCtx]); // eslint-disable-line react-hooks/exhaustive-deps

  // 렌더용 = 수동 ∪ 자동 (필터 끄면 자동=빈 set → 원래 수동 펼침 상태 복원)
  const effectiveExpandedParents = useMemo(
    () => new Set([...expandedSubtaskParents, ...autoExpandedParents]),
    [expandedSubtaskParents, autoExpandedParents],
  );

  // 정렬 변경 핸들러 (null=해제, 3-state: null -> asc -> desc -> null)
  const handleSortChange = (field) => {
    if (field === null) {
      setSortConfig({ field: null, direction: 'asc' });
      return;
    }
    setSortConfig((prev) => {
      if (prev.field !== field) return { field, direction: 'asc' };
      if (prev.direction === 'asc') return { field, direction: 'desc' };
      return { field: null, direction: 'asc' };
    });
  };

  // 스프린트 접힘 토글
  const handleToggleCollapse = useCallback((sprintKey) => {
    setCollapsedSprints((prev) => {
      const next = new Set(prev);
      if (next.has(sprintKey)) next.delete(sprintKey);
      else next.add(sprintKey);
      return next;
    });
  }, []);

  // 하위태스크 펼침 토글 (parent task_id 기준)
  const handleToggleSubtasks = useCallback((parentTaskId) => {
    setExpandedSubtaskParents((prev) => {
      const next = new Set(prev);
      if (next.has(parentTaskId)) next.delete(parentTaskId);
      else next.add(parentTaskId);
      return next;
    });
  }, []);

  // 태스크 선택 핸들러
  const handleTaskClick = useCallback((task, e) => {
    if (e.metaKey || e.ctrlKey) {
      // Cmd/Ctrl+Click: 다중 선택 토글
      setSelectedTaskIds((prev) => {
        const next = new Set(prev);
        if (next.has(task.task_id)) next.delete(task.task_id);
        else next.add(task.task_id);
        return next;
      });
    } else {
      // 일반 클릭: 선택 초기화 + 패널 열기
      setSelectedTaskIds(new Set([task.task_id]));
      onSelectTask(task);
    }
  }, [onSelectTask]);

  // 모든 태스크의 컨테이너 매핑 (task_id → containerId)
  const getContainerId = (taskId) => {
    for (const sprint of sprints) {
      if ((sprint.tasks || []).some((t) => t.task_id === taskId)) {
        return `sprint-${sprint.sprint_id}`;
      }
    }
    if (backlogTasks.some((t) => t.task_id === taskId)) {
      return 'backlog';
    }
    return null;
  };

  // 활성 태스크 데이터 찾기
  const findTask = (taskId) => {
    for (const sprint of sprints) {
      const found = (sprint.tasks || []).find((t) => t.task_id === taskId);
      if (found) return found;
    }
    return backlogTasks.find((t) => t.task_id === taskId);
  };

  // DnD 핸들러
  const handleDragStart = (event) => {
    if (sortActive) return; // 정렬 중에는 드래그 비활성
    const { active } = event;
    const id = active.id;

    if (String(id).startsWith('sprint-')) {
      setActiveType('sprint');
      setActiveId(id);
    } else {
      setActiveType('task');
      setActiveId(id);
      // 드래그 시작한 태스크가 선택 목록에 없으면 단일 선택으로 전환
      const taskId = Number(id);
      if (!selectedTaskIds.has(taskId)) {
        setSelectedTaskIds(new Set([taskId]));
      }
    }
  };

  const handleDragOver = (event) => {
    const { over } = event;
    if (!over || activeType !== 'task') {
      setDragOverContainerId(null);
      return;
    }

    // over가 컨테이너인지 태스크인지 판별
    const overId = String(over.id);
    if (overId.startsWith('sprint-') || overId === 'backlog') {
      setDragOverContainerId(overId);
    } else {
      // over가 태스크 → 해당 태스크의 컨테이너 표시
      setDragOverContainerId(getContainerId(Number(overId)));
    }
  };

  const handleDragEnd = async (event) => {
    const { active, over } = event;
    setActiveId(null);
    setActiveType(null);
    setDragOverContainerId(null);

    if (!over || active.id === over.id) return;

    if (String(active.id).startsWith('sprint-')) {
      // 스프린트 순서 변경
      const oldIndex = sprints.findIndex((s) => `sprint-${s.sprint_id}` === active.id);
      const newIndex = sprints.findIndex((s) => `sprint-${s.sprint_id}` === over.id);
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;

      const reordered = arrayMove(sprints, oldIndex, newIndex);
      setSprints(reordered);

      try {
        await axios.post(`/branches/${branchId}/sprints/reorder`, {
          sprint_ids: reordered.map((s) => s.sprint_id),
        });
      } catch {
        fetchData(); // 실패 시 원복
      }
    } else {
      // 태스크 이동/순서 변경
      const draggedTaskId = Number(active.id);
      // Cmd/Ctrl 선택엔 하위태스크도 섞일 수 있는데, 하위는 컨테이너 위치가
      // 없으므로(sprint는 부모 파생, 드래그 비활성 v1 정책) 배치에서 제외한다.
      const movingIds = (selectedTaskIds.has(draggedTaskId)
        ? [...selectedTaskIds]
        : [draggedTaskId]
      ).filter((id) => topLevelIds.has(id));
      if (movingIds.length === 0) return;

      // 대상 컨테이너와 위치 결정
      const overId = String(over.id);
      let targetSprintId = null;
      let afterTaskId = null;

      if (overId === 'backlog') {
        targetSprintId = null;
        afterTaskId = null;
      } else if (overId.startsWith('sprint-')) {
        targetSprintId = Number(overId.replace('sprint-', ''));
        afterTaskId = null;
      } else {
        // over가 태스크
        const overTaskId = Number(overId);
        const overContainer = getContainerId(overTaskId);
        // 컨테이너를 못 찾는 태스크(예: 하위태스크) 위 드롭은 무시한다.
        // 현재 하위태스크는 non-droppable이라 도달 불가하지만, 향후 하위 드래그를 켤 때
        // overContainer=null이 백로그 최상단으로 잘못 이동하는 것을 막는 방어 가드.
        if (!overContainer) return;
        if (overContainer === 'backlog') {
          targetSprintId = null;
        } else {
          targetSprintId = Number(overContainer.replace('sprint-', ''));
        }
        afterTaskId = overTaskId;
      }

      const movingIdSet = new Set(movingIds);
      const movingTasks = movingIds.map((id) => findTask(id)).filter(Boolean);

      // 소스 컨테이너 판별
      const sourceContainer = getContainerId(draggedTaskId);

      // 같은 컨테이너 내 단일 태스크 재정렬 → arrayMove 사용
      const isSameContainer =
        afterTaskId !== null &&
        movingIds.length === 1 &&
        sourceContainer === (targetSprintId !== null ? `sprint-${targetSprintId}` : 'backlog');

      if (isSameContainer) {
        if (sourceContainer === 'backlog') {
          const oldIdx = backlogTasks.findIndex((t) => t.task_id === draggedTaskId);
          const newIdx = backlogTasks.findIndex((t) => t.task_id === afterTaskId);
          if (oldIdx === -1 || newIdx === -1 || oldIdx === newIdx) return;
          const reordered = arrayMove(backlogTasks, oldIdx, newIdx);
          setBacklogTasks(reordered);

          // afterTaskId = 새 위치 바로 앞 태스크 (서버에 전달)
          const finalIdx = reordered.findIndex((t) => t.task_id === draggedTaskId);
          const serverAfter = finalIdx > 0 ? reordered[finalIdx - 1].task_id : null;

          try {
            await axios.post(`/branches/${branchId}/tasks/reorder`, {
              task_ids: movingIds,
              sprint_id: null,
              after_task_id: serverAfter,
            });
          } catch {
            fetchData();
          }
        } else {
          const sprintId = Number(sourceContainer.replace('sprint-', ''));
          const newSprints = sprints.map((s) => {
            if (s.sprint_id !== sprintId) return s;
            const tasks = [...(s.tasks || [])];
            const oldIdx = tasks.findIndex((t) => t.task_id === draggedTaskId);
            const newIdx = tasks.findIndex((t) => t.task_id === afterTaskId);
            if (oldIdx === -1 || newIdx === -1 || oldIdx === newIdx) return s;
            return { ...s, tasks: arrayMove(tasks, oldIdx, newIdx) };
          });
          setSprints(newSprints);

          const sprint = newSprints.find((s) => s.sprint_id === sprintId);
          const reordered = sprint?.tasks || [];
          const finalIdx = reordered.findIndex((t) => t.task_id === draggedTaskId);
          const serverAfter = finalIdx > 0 ? reordered[finalIdx - 1].task_id : null;

          try {
            await axios.post(`/branches/${branchId}/tasks/reorder`, {
              task_ids: movingIds,
              sprint_id: sprintId,
              after_task_id: serverAfter,
            });
          } catch {
            fetchData();
          }
        }
        return;
      }

      // 크로스 컨테이너 이동 또는 다중 태스크 이동
      const newSprints = sprints.map((s) => ({
        ...s,
        tasks: (s.tasks || []).filter((t) => !movingIdSet.has(t.task_id)),
      }));
      let newBacklog = backlogTasks.filter((t) => !movingIdSet.has(t.task_id));

      if (targetSprintId === null) {
        if (afterTaskId !== null) {
          const idx = newBacklog.findIndex((t) => t.task_id === afterTaskId);
          if (idx !== -1) {
            newBacklog.splice(idx + 1, 0, ...movingTasks);
          } else {
            newBacklog = [...movingTasks, ...newBacklog];
          }
        } else {
          newBacklog = [...movingTasks, ...newBacklog];
        }
      } else {
        const sprintIdx = newSprints.findIndex((s) => s.sprint_id === targetSprintId);
        if (sprintIdx !== -1) {
          const tasks = newSprints[sprintIdx].tasks;
          if (afterTaskId !== null) {
            const idx = tasks.findIndex((t) => t.task_id === afterTaskId);
            if (idx !== -1) {
              tasks.splice(idx + 1, 0, ...movingTasks);
            } else {
              tasks.unshift(...movingTasks);
            }
          } else {
            tasks.unshift(...movingTasks);
          }
        }
      }

      setSprints(newSprints);
      setBacklogTasks(newBacklog);

      try {
        await axios.post(`/branches/${branchId}/tasks/reorder`, {
          task_ids: movingIds,
          sprint_id: targetSprintId,
          after_task_id: afterTaskId,
        });
      } catch {
        fetchData();
      }
    }
  };

  // 최상위 task id 집합 — 드래그 배치·배지에서 하위태스크 제외용
  const topLevelIds = useMemo(
    () => new Set(
      [...sprints.flatMap((s) => s.tasks || []), ...backlogTasks].map((t) => t.task_id)
    ),
    [sprints, backlogTasks]
  );

  // 드래그 중 프리뷰 데이터 — 배지 수는 실제 이동 대상 수와 일치
  // (선택에 하위가 섞여도 이동에서 제외되고, 선택 밖 행 드래그는 1개만 이동)
  const activeTask = activeId && activeType === 'task' ? findTask(Number(activeId)) : null;
  const dragCount = useMemo(() => {
    if (activeType !== 'task' || !activeId) return 0;
    const draggedTaskId = Number(activeId);
    const ids = selectedTaskIds.has(draggedTaskId) ? [...selectedTaskIds] : [draggedTaskId];
    return Math.max(ids.filter((id) => topLevelIds.has(id)).length, 1);
  }, [activeType, activeId, selectedTaskIds, topLevelIds]);

  // ── 그룹핑 모드 (groupBy !== 'none') ──────────────────────────────
  // 스프린트 섹션·DnD를 숨기고, 모든 태스크(부모+하위)를 평탄화→필터→다중정렬→버킷화한다.
  const grouping = groupBy !== 'none';

  // 버킷 키 → 사람이 읽는 라벨 (메타 lookup)
  const groupLabelFor = useCallback((key) => {
    // sprint 그룹의 null 버킷 = 백로그(sprint_id 없음)
    if ((key === null || key === undefined) && groupBy === 'sprint') return t('branchTasks.backlog');
    if (key === null || key === undefined) return t('branchTasks.groups.none');
    switch (groupBy) {
      case 'status':
        return (workflowStatuses || []).find((w) => w.key === key)?.label || String(key);
      case 'priority':
        return {
          urgent: t('branchTasks.priority.urgent'),
          high: t('branchTasks.priority.high'),
          medium: t('branchTasks.priority.medium'),
          low: t('branchTasks.priority.low'),
        }[key] || String(key);
      case 'assignee': {
        const m = (members || []).find((x) => x.user_id === key);
        return m ? (m.username || m.email) : t('branchTasks.groups.userFallback', { id: key });
      }
      case 'epic':
        return (epics || []).find((e) => e.epic_id === key)?.epic_name
          || t('branchTasks.groups.epicFallback', { id: key });
      case 'sprint': {
        const sp = sprints.find((s) => s.sprint_id === key);
        return sp ? sp.sprint_name : t('branchTasks.backlog');
      }
      case 'label': {
        const lb = (labels || []).find((l) => l.label_id === key);
        return lb ? lb.label_name : t('branchTasks.groups.labelFallback', { id: key });
      }
      default:
        return String(key);
    }
  }, [groupBy, workflowStatuses, members, epics, sprints, labels, t]);

  const groupedBuckets = useMemo(() => {
    if (!grouping) return [];
    // 부모 + 하위 모두 포함해 평탄화 (그룹핑은 트리 무시한 평면 뷰)
    const flat = [];
    [...sprints.flatMap((s) => s.tasks || []), ...backlogTasks].forEach((t) => {
      flat.push(t);
      (t.subtasks || []).forEach((sub) => flat.push(sub));
    });
    const visible = isFilterActive ? flat.filter((t) => matchesFilters(t, filterCtx)) : flat;
    const sorted = applySort(visible, multiSort);
    return groupTasks(sorted, groupBy).map((b) => ({ ...b, label: groupLabelFor(b.key) }));
  }, [grouping, sprints, backlogTasks, isFilterActive, filterCtx, multiSort, groupBy, groupLabelFor]);

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200, color: 'var(--color-text-secondary)', fontSize: 14 }}>{t('common.state.loading')}</div>;

  const sprintIds = sprints.map((s) => `sprint-${s.sprint_id}`);

  return (
    <div className="TaskList">
      {/* 상단 필터 + 액션 */}
      <div className="TaskList__Actions">
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
          // 두 정렬 컨트롤을 모드 배타적으로: 기본 뷰(groupBy==='none')는 적용되는 레거시 단일키 Sort만,
          // 그룹핑 뷰는 적용되는 다중키 Sort만 노출한다(핸들러 prop 부재 시 TaskFilterBar가 컨트롤 미렌더).
          sortConfig={grouping ? undefined : sortConfig}
          onSortChange={grouping ? undefined : handleSortChange}
          filterSpec={filterSpec}
          onFilterSpecChange={setFilterSpec}
          groupBy={groupBy}
          onGroupByChange={setGroupBy}
          sort={multiSort}
          onMultiSortChange={grouping ? setMultiSort : undefined}
          customFields={customFields}
          availableFields={[
            'status', 'priority', 'task_type', 'label', 'epic', 'sprint',
            'assignee', 'due_date', 'start_date', 'created_at', 'text',
            'has_subtasks', 'is_top_level',
          ]}
          savedViews={savedViews}
          activeViewId={activeViewId}
          onApplyView={handleApplyView}
          onSaveView={handleSaveView}
          onUpdateView={handleUpdateView}
          onDeleteView={handleDeleteView}
          pinnedViewIds={pinnedViewIds}
          onTogglePin={handleTogglePin}
        />
        <button className="TaskList__SprintBtn" onClick={() => setSprintModal({ open: true, sprint: null })}>
          <Plus size={14} />
          {t('branchTasks.sprint.create')}
        </button>
      </div>
      {viewError && (
        <div className="TaskList__ViewError" role="alert">{viewError}</div>
      )}

      {grouping ? (
        /* 그룹핑 모드: 스프린트 섹션·DnD 숨김, 플랫 버킷 렌더 */
        <div className="TaskList__Groups">
          {groupedBuckets.every((b) => b.tasks.length === 0) && (
            <div className="TaskList__Empty">{t('branchTasks.noTasks')}</div>
          )}
          {groupedBuckets.map((bucket) => (
            <div className="TaskList__Group" key={String(bucket.key)}>
              <div className="TaskList__GroupHeader">
                <span className="TaskList__GroupLabel">{bucket.label}</span>
                <span className="TaskList__SprintCount">{bucket.tasks.length}</span>
              </div>
              <div className="TaskList__GroupBody">
                {bucket.tasks.map((task) => (
                  <TaskListRow
                    key={task.task_id}
                    task={task}
                    branchId={branchId}
                    taskTypes={taskTypes}
                    workflowStatuses={workflowStatuses}
                    epics={epics}
                    members={members}
                    onClick={(e) => handleTaskClick(task, e)}
                    onContextMenu={(e) => taskMenu.openMenu?.(e, task)}
                    isSelected={selectedTaskIds.has(task.task_id)}
                    isOverlay
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
      <DndContext
        sensors={sortActive ? [] : sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        {/* Sprint 섹션들 (sortable) */}
        <SortableContext items={sprintIds} strategy={verticalListSortingStrategy}>
          {sprints.map((sprint) => (
            <TaskListSprint
              key={sprint.sprint_id}
              sprint={{ ...sprint, tasks: applyFilterAndSort(sprint.tasks) }}
              branchId={branchId}
              branchKey={branchKey}
              taskTypes={taskTypes}
              workflowStatuses={workflowStatuses}
              epics={epics}
              members={members}
              sprints={sprints}
              onEditTask={handleTaskClick}
              onTaskContextMenu={taskMenu.openMenu}
              onEditSprint={() => setSprintModal({ open: true, sprint })}
              onCompleteSprint={(s) => setCompleteSprint(s)}
              selectedTaskIds={selectedTaskIds}
              dragOverContainerId={dragOverContainerId}
              sortActive={sortActive}
              collapsed={collapsedSprints.has(sprint.sprint_id)}
              onToggleCollapse={() => handleToggleCollapse(sprint.sprint_id)}
              expandedParents={effectiveExpandedParents}
              onToggleSubtasks={handleToggleSubtasks}
            />
          ))}
        </SortableContext>

        {/* Backlog 섹션 (sortable 아님, droppable만) */}
        <TaskListSprint
          sprint={{ sprint_name: t('branchTasks.backlog'), status: 'backlog', tasks: applyFilterAndSort(backlogTasks) }}
          branchId={branchId}
          branchKey={branchKey}
          taskTypes={taskTypes}
          workflowStatuses={workflowStatuses}
          epics={epics}
          members={members}
          onEditTask={handleTaskClick}
          onTaskContextMenu={taskMenu.openMenu}
          isBacklog
          selectedTaskIds={selectedTaskIds}
          dragOverContainerId={dragOverContainerId}
          sortActive={sortActive}
          collapsed={collapsedSprints.has('backlog')}
          onToggleCollapse={() => handleToggleCollapse('backlog')}
          expandedParents={effectiveExpandedParents}
          onToggleSubtasks={handleToggleSubtasks}
        />

        {/* 드래그 오버레이 */}
        <DragOverlay dropAnimation={null}>
          {activeTask && (
            <div className="TaskList__DragOverlay">
              <TaskListRow
                task={activeTask}
                branchId={branchId}
                taskTypes={taskTypes}
                workflowStatuses={workflowStatuses}
                epics={epics}
                members={members}
                isOverlay
              />
              {dragCount > 1 && (
                <div className="TaskList__DragBadge">{dragCount}</div>
              )}
            </div>
          )}
        </DragOverlay>
      </DndContext>
      )}

      {/* Sprint 모달 */}
      {sprintModal.open && (
        <SprintModal
          branchId={branchId}
          sprint={sprintModal.sprint}
          onClose={() => setSprintModal({ open: false, sprint: null })}
        />
      )}

      {/* Complete Sprint 모달 */}
      {completeSprint && (
        <CompleteSprintModal
          branchId={branchId}
          sprint={completeSprint}
          sprints={sprints.filter((s) => s.sprint_id !== completeSprint.sprint_id && (s.status === 'future' || s.status === 'active'))}
          onClose={() => setCompleteSprint(null)}
        />
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
