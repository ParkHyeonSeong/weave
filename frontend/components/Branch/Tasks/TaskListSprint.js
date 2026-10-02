import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, ChevronDown, Plus, Settings, Play, CheckCircle, Filter } from 'lucide-react';
import { axios } from '@/library/_axios';
import { useSortable } from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import TaskListRow from './TaskListRow';
import TaskTypeIcon from '@/components/common/TaskTypeIcon';
import ConfirmModal from '@/components/modal/ConfirmModal';
import { isParentExpanded } from '@/library/subtaskProgress';
import { countMatchedTasks } from '@/library/taskFilters';
import { statusCategoryVar } from '@/library/themePalette';
import { formatSprintRange } from '@/library/formatTime';
import { getError } from '@/library/errorCode';
import { errorText } from '@/library/errorText';

// 상태 줄 범례 — 막대 칠 순서(완료 → 취소됨 → 진행 중)와 같고, 남은 회색 트랙이 할 일이다
const LEGEND = [
  { category: 'done', countKey: 'done', labelKey: 'branch.statusCategory.done' },
  { category: 'cancelled', countKey: 'cancelled', labelKey: 'branch.statusCategory.cancelled' },
  { category: 'in_progress', countKey: 'inProgress', labelKey: 'branch.statusCategory.inProgress' },
  { category: 'todo', countKey: 'todo', labelKey: 'branch.statusCategory.todo' },
];

export default function TaskListSprint({
  sprint, summary, filterActive, branchKey, branchId, taskTypes, workflowStatuses, epics, members, sprints,
  onEditTask, onTaskContextMenu, onEditSprint, onCompleteSprint, isBacklog,
  selectedTaskIds, dragOverContainerId, sortActive,
  collapsed, onToggleCollapse,
  expandedParents, onToggleSubtasks,
}) {
  const { t } = useTranslation();
  const [inlineTitle, setInlineTitle] = useState('');
  const [inlineType, setInlineType] = useState('');
  const [inlineError, setInlineError] = useState('');
  const [showInline, setShowInline] = useState(false);
  const [creating, setCreating] = useState(false);
  const [startError, setStartError] = useState('');
  const [showTypeDropdown, setShowTypeDropdown] = useState(false);
  const [showStartConfirm, setShowStartConfirm] = useState(false);
  const [withSubtasks, setWithSubtasks] = useState(false); // 상태 줄 집계에 하위 포함(기본 꺼짐, 저장 안 함)
  const typeDropdownRef = useRef(null);
  const inlineFormRef = useRef(null);
  const tasks = sprint.tasks || [];
  // 배지 = "자동으로 화면에 드러나는 매칭 항목 수": 직접 매칭 부모 1(하위 접힘 미카운트)
  // + 컨텍스트 부모의 펼쳐진 매칭 하위 수. 필터 비활성 시엔 플래그가 없어 tasks.length 와 동일.
  const matchCount = countMatchedTasks(tasks);
  // 헤더 요약은 필터 전 집계(summary)로 그린다 — 필터 중에도 스프린트 전체 상태를 보여주고, 일치 수는 따로 붙인다.
  // 상태 줄은 활성 스프린트만: 예정 스프린트·백로그 목록은 완료·취소를 내려받지 않아(find_by_branch) 분해가 반쪽이 된다.
  const progress = withSubtasks ? summary.withSubtasks : summary.topLevel;
  const showStatusRow = !isBacklog && sprint.status === 'active' && summary.total > 0 && progress != null;

  const containerId = isBacklog ? 'backlog' : `sprint-${sprint.sprint_id}`;
  const isDragOver = dragOverContainerId === containerId;

  // Sprint 자체의 sortable (백로그 제외)
  const {
    listeners: sprintListeners,
    setNodeRef: setSprintNodeRef,
    transform: sprintTransform,
    transition: sprintTransition,
    isDragging: isSprintDragging,
  } = useSortable({
    id: containerId,
    disabled: isBacklog || sortActive,
  });

  const sprintStyle = {
    transform: CSS.Transform.toString(sprintTransform),
    transition: sprintTransition,
    opacity: isSprintDragging ? 0.4 : 1,
  };

  // 헤더 우측 버튼 위에서 누를 때 드래그가 시작되지 않도록 mousedown/touchstart 전파 차단
  const stopDrag = (e) => e.stopPropagation();

  // Sprint body의 droppable (태스크 드롭 영역)
  const { setNodeRef: setDroppableRef } = useDroppable({
    id: containerId,
  });

  // 타입 드롭다운 외부 클릭 닫기
  useEffect(() => {
    if (!showTypeDropdown) return;
    const handleClick = (e) => {
      if (typeDropdownRef.current && !typeDropdownRef.current.contains(e.target)) {
        setShowTypeDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showTypeDropdown]);

  // inlineType을 이 브랜치에 실제로 존재하는 task type으로 동기화한다.
  // (기본 타입을 직접 교체한 브랜치에서 없는 키로 생성 시도해 조용히 실패하는 것 방지)
  useEffect(() => {
    if (!taskTypes || taskTypes.length === 0) return;
    if (!taskTypes.some((tt) => tt.type_key === inlineType)) {
      setInlineType(taskTypes[0].type_key);
    }
  }, [taskTypes, inlineType]);

  const getStatusLabel = (status) => {
    switch (status) {
      case 'active': return t('branchTasks.sprint.status.active');
      case 'closed': return t('branchTasks.sprint.status.closed');
      case 'future': return t('branchTasks.sprint.status.future');
      default: return '';
    }
  };

  const getStatusClass = (status) => {
    switch (status) {
      case 'active': return 'TaskList__SprintBadge--active';
      case 'closed': return 'TaskList__SprintBadge--closed';
      default: return '';
    }
  };

  const handleInlineCreate = async (e) => {
    e.preventDefault();
    if (!inlineTitle.trim() || creating) return;

    setCreating(true);
    setInlineError('');
    try {
      const res = await axios.post(`/branches/${branchId}/tasks`, {
        title: inlineTitle.trim(),
        sprint_id: isBacklog ? null : (sprint.sprint_id || null),
        task_type: inlineType,
      });
      if (res.data.status) {
        setInlineTitle('');
        window.dispatchEvent(new Event('task:updated'));
      } else {
        const err = getError(res.data);
        // 폴백 문구도 errors.* catalog 한 출처를 본다(errorText가 코드를 못 찾을 때만 도달).
        const msg = errorText(err.code, err.category) ?? {
          INVALID_TASK_TYPE: t('errors.INVALID_TASK_TYPE'),
          INVALID_STATUS: t('errors.INVALID_STATUS'),
          INVALID_ASSIGNEE: t('errors.INVALID_ASSIGNEE'),
          NOT_BRANCH_MEMBER: t('errors.NOT_BRANCH_MEMBER'),
        }[err.code] ?? t('branchTasks.sprint.createTaskFailed');
        setInlineError(msg);
      }
    } catch {
      setInlineError(t('branchTasks.sprint.createTaskFailedRetry'));
    } finally {
      setCreating(false);
    }
  };

  const [subtaskParentId, setSubtaskParentId] = useState(null);
  const [subtaskTitle, setSubtaskTitle] = useState('');
  const [subtaskCreating, setSubtaskCreating] = useState(false);
  const [subtaskError, setSubtaskError] = useState('');

  const handleSubtaskCreate = async (e, parentTask) => {
    e.preventDefault();
    if (!subtaskTitle.trim() || subtaskCreating) return;
    setSubtaskCreating(true);
    setSubtaskError('');
    try {
      const res = await axios.post(`/branches/${branchId}/tasks`, {
        title: subtaskTitle.trim(),
        parent_task_id: parentTask.task_id,
        task_type: inlineType,
      });
      if (res.data.status) {
        setSubtaskTitle('');
        window.dispatchEvent(new Event('task:updated'));
      } else {
        // 컨트롤러 검증 실패는 200 + {status:false} (silent-200 계약). 호출부에서 확인.
        const err = getError(res.data);
        const msg = errorText(err.code, err.category) ?? t('branchTasks.subtasks.createFailed');
        setSubtaskError(msg);
      }
    } catch {
      setSubtaskError(t('branchTasks.subtasks.createFailedRetry'));
    } finally {
      setSubtaskCreating(false);
    }
  };

  const handleStartSprint = async () => {
    setShowStartConfirm(false);
    setStartError('');
    try {
      const res = await axios.post(`/branches/${branchId}/sprints/${sprint.sprint_id}/start`);
      if (res.data.status) {
        window.dispatchEvent(new Event('task:updated'));
      } else {
        const err = getError(res.data);
        // 폴백 문구도 errors.* catalog 한 출처를 본다(errorText가 코드를 못 찾을 때만 도달).
        const msg = errorText(err.code, err.category) ?? {
          SPRINT_NOT_FUTURE: t('errors.SPRINT_NOT_FUTURE'),
          SPRINT_EMPTY: t('errors.SPRINT_EMPTY'),
        }[err.code] ?? t('branchTasks.sprint.startFailed');
        setStartError(msg);
        setTimeout(() => setStartError(''), 3000);
      }
    } catch {
      setStartError(t('branchTasks.sprint.startFailedRetry'));
      setTimeout(() => setStartError(''), 3000);
    }
  };

  const handleInlineKeyDown = (e) => {
    if (e.key === 'Escape') {
      setShowInline(false);
      setInlineTitle('');
      setInlineError('');
    }
  };

  const currentTypeConfig = (taskTypes || []).find((tt) => tt.type_key === inlineType);
  const taskIds = tasks.map((t) => String(t.task_id));

  return (
    <div
      className={`TaskList__Sprint ${isDragOver ? 'TaskList__Sprint--dragOver' : ''}`}
      ref={setSprintNodeRef}
      style={sprintStyle}
    >
      {/* Sprint 헤더 */}
      <div
        className="TaskList__SprintHeader"
        onClick={onToggleCollapse}
        {...(!isBacklog && !sortActive ? sprintListeners : {})}
      >
        <div className="TaskList__SprintLeft">
          {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
          <div className="TaskList__SprintText">
            <div className="TaskList__SprintNameRow">
              <span className="TaskList__SprintName">{sprint.sprint_name}</span>
              {!isBacklog && sprint.status && (
                <span className={`TaskList__SprintBadge ${getStatusClass(sprint.status)}`}>
                  {getStatusLabel(sprint.status)}
                </span>
              )}
              {!isBacklog && (sprint.start_date || sprint.end_date) && (
                <span className="TaskList__SprintDate">
                  {formatSprintRange(sprint.start_date, sprint.end_date)}
                </span>
              )}
              <span className="TaskList__SprintCount">
                {t('branchTasks.sprint.summary.total', { count: summary.total })}
              </span>
              {filterActive && (
                <span className="TaskList__SprintMatch">
                  <Filter size={11} />
                  {t('branchTasks.sprint.summary.matched', { count: matchCount })}
                </span>
              )}
              {startError && <span className="TaskList__SprintError">{startError}</span>}
            </div>
            {!isBacklog && sprint.goal && (
              <div className="TaskList__SprintGoal" title={sprint.goal}>{sprint.goal}</div>
            )}
          </div>
        </div>
        <div
          className="TaskList__SprintRight"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={stopDrag}
          onTouchStart={stopDrag}
        >
          {!isBacklog && sprint.status === 'future' && (
            <button className="TaskList__SprintStartBtn" onClick={() => setShowStartConfirm(true)}>
              <Play size={12} />
              {t('branchTasks.sprint.start')}
            </button>
          )}
          {!isBacklog && sprint.status === 'active' && onCompleteSprint && (
            <button className="TaskList__SprintCompleteBtn" onClick={() => onCompleteSprint(sprint)}>
              <CheckCircle size={12} />
              {t('branchTasks.sprint.complete')}
            </button>
          )}
          {!isBacklog && onEditSprint && (
            <button className="TaskList__SprintAction" onClick={onEditSprint} title={t('branchTasks.sprint.settings')}>
              <Settings size={14} />
            </button>
          )}
        </div>
        {showStatusRow && (
          <div className="TaskList__SprintSummary">
            {/* 장식 — 같은 수가 바로 옆 범례에 글자로 있다 */}
            <div className="TaskList__SprintProgress" aria-hidden="true">
              {progress.segments.map((seg) => (
                <span
                  key={seg.category}
                  className="TaskList__SprintProgressSegment"
                  style={{ width: `${seg.percent}%`, background: statusCategoryVar(seg.category) }}
                />
              ))}
            </div>
            <div className="TaskList__SprintLegend">
              {LEGEND.filter(({ category }) => category !== 'cancelled' || progress.counts.cancelled > 0)
                .map(({ category, countKey, labelKey }) => (
                  <span key={category} className="TaskList__SprintLegendItem">
                    <span
                      className={`TaskList__SprintLegendDot TaskList__SprintLegendDot--${category}`}
                      style={{ color: statusCategoryVar(category) }}
                    />
                    {t(labelKey)}{' '}
                    <span className="TaskList__SprintLegendNum">{progress.counts[countKey]}</span>
                  </span>
                ))}
            </div>
            {summary.subtaskCount > 0 && (
              <button
                type="button"
                className="TaskList__SprintSubtaskToggle"
                aria-pressed={withSubtasks}
                onClick={(e) => { e.stopPropagation(); setWithSubtasks((v) => !v); }}
                onMouseDown={stopDrag}
                onTouchStart={stopDrag}
              >
                <span className="TaskList__SprintSubtaskSwitch" aria-hidden="true" />
                {t('branchTasks.sprint.summary.includeSubtasks', { count: summary.subtaskCount })}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Task 목록 */}
      {!collapsed && (
        <div className="TaskList__SprintBody" ref={setDroppableRef}>
          <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
            {tasks.length === 0 && !showInline && (
              <div className="TaskList__Empty">{t('branchTasks.noTasks')}</div>
            )}
            {tasks.map((task) => {
              const subtasks = task.subtasks || [];
              const visibleSubtasks = task.visibleSubtasks ?? subtasks; // 렌더용(무필터 시 전체)
              const hasSubtasks = subtasks.length > 0;
              const expanded = isParentExpanded(expandedParents, task.task_id);
              return (
                <div className="TaskList__ParentGroup" key={task.task_id}>
                  <TaskListRow
                    task={task}
                    branchId={branchId}
                    taskTypes={taskTypes}
                    workflowStatuses={workflowStatuses}
                    epics={epics}
                    members={members}
                    onClick={(e) => onEditTask(task, e)}
                    onContextMenu={(e) => onTaskContextMenu?.(e, task)}
                    isSelected={selectedTaskIds && selectedTaskIds.has(task.task_id)}
                    expandable={hasSubtasks}
                    expanded={expanded}
                    onToggleExpand={() => onToggleSubtasks?.(task.task_id)}
                    progress={hasSubtasks ? task.subtask_progress : null}
                    contextOnly={task.isContextOnly}
                  />
                  {expanded && (
                    <>
                      {visibleSubtasks.map((sub) => (
                        <TaskListRow
                          key={sub.task_id}
                          task={sub}
                          branchId={branchId}
                          taskTypes={taskTypes}
                          workflowStatuses={workflowStatuses}
                          epics={epics}
                          members={members}
                          onClick={(e) => onEditTask(sub, e)}
                          onContextMenu={(e) => onTaskContextMenu?.(e, sub)}
                          isSelected={selectedTaskIds && selectedTaskIds.has(sub.task_id)}
                          indent
                        />
                      ))}
                      <form
                        className="TaskList__SubtaskAdd"
                        onSubmit={(e) => handleSubtaskCreate(e, task)}
                      >
                        <Plus size={13} />
                        <input
                          className="TaskList__SubtaskAddInput"
                          type="text"
                          placeholder={t('branchTasks.subtasks.addPlaceholder')}
                          value={subtaskParentId === task.task_id ? subtaskTitle : ''}
                          onFocus={() => { setSubtaskParentId(task.task_id); setSubtaskError(''); }}
                          onChange={(e) => { setSubtaskParentId(task.task_id); setSubtaskTitle(e.target.value); }}
                          onKeyDown={(e) => { if (e.key === 'Escape') { setSubtaskTitle(''); setSubtaskParentId(null); } }}
                          disabled={subtaskCreating}
                        />
                      </form>
                      {subtaskParentId === task.task_id && subtaskError && (
                        <div className="TaskList__InlineError">{subtaskError}</div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </SortableContext>

          {/* 인라인 생성 */}
          {showInline && (
            <form className="TaskList__InlineCreate" ref={inlineFormRef} onSubmit={handleInlineCreate}>
              {/* 타입 선택 아이콘 */}
              <div className="TaskList__InlineTypeWrap" ref={typeDropdownRef}>
                <button
                  type="button"
                  className="TaskList__InlineTypeBtn"
                  onClick={() => setShowTypeDropdown((prev) => !prev)}
                  title={currentTypeConfig?.type_name || t('branchTasks.taskTypeFallback')}
                >
                  <TaskTypeIcon
                    name={currentTypeConfig?.icon || 'CheckSquare'}
                    size={14}
                    color={currentTypeConfig?.color || '#5E6AD2'}
                  />
                </button>
                {showTypeDropdown && (
                  <div className="TaskList__InlineTypeDropdown">
                    {(taskTypes || []).map((tt) => (
                      <button
                        key={tt.type_key}
                        type="button"
                        className={`TaskList__InlineTypeOption ${inlineType === tt.type_key ? 'TaskList__InlineTypeOption--selected' : ''}`}
                        onClick={() => { setInlineType(tt.type_key); setShowTypeDropdown(false); setInlineError(''); }}
                      >
                        <TaskTypeIcon name={tt.icon} size={14} color={tt.color} />
                        <span>{tt.type_name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <input
                className="TaskList__InlineInput"
                type="text"
                placeholder={t('branchTasks.sprint.inlinePlaceholder')}
                value={inlineTitle}
                onChange={(e) => setInlineTitle(e.target.value)}
                onKeyDown={handleInlineKeyDown}
                onBlur={(e) => {
                  // 타입 드롭다운 클릭 시 폼 닫히지 않도록
                  if (inlineFormRef.current?.contains(e.relatedTarget)) return;
                  setTimeout(() => {
                    if (!inlineTitle.trim()) setShowInline(false);
                  }, 200);
                }}
                autoFocus
                disabled={creating}
              />
            </form>
          )}
          {showInline && inlineError && (
            <div className="TaskList__InlineError">{inlineError}</div>
          )}

          {/* 만들기 버튼 */}
          {!showInline && (
            <button
              className="TaskList__InlineBtn"
              onClick={() => { setShowInline(true); setInlineError(''); }}
            >
              <Plus size={14} />
              {t('common.actions.create')}
            </button>
          )}
        </div>
      )}
      <ConfirmModal
        isOpen={showStartConfirm}
        onClose={() => setShowStartConfirm(false)}
        onConfirm={handleStartSprint}
        title={t('branchTasks.sprint.start')}
        message={t('branchTasks.sprint.startConfirm', { name: sprint.sprint_name, count: tasks.length })}
        confirmLabel={t('branchTasks.sprint.startAction')}
      />
    </div>
  );
}
