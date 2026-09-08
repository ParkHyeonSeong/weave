import { useState, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { User, MessageCircle, ChevronRight, ChevronDown } from 'lucide-react';
import { axios } from '@/library/_axios';
import { selectableEpics } from '@/library/epics';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useDateFormat } from '@/hooks/useDateFormat';
import CustomSelect from '@/components/common/CustomSelect';
import DropdownPortal from '@/components/common/DropdownPortal';
import TaskTypeIcon from '@/components/common/TaskTypeIcon';
import Avatar from '@/components/common/Avatar';
import { progressLabel, progressPercent } from '@/library/subtaskProgress';
import { priorityVar, defaultStatusOptions } from '@/library/themePalette';
import { entityTintStyle } from '@/library/entityTint';
import { orderMembersForPicker } from '@/library/memberOrder';

// 라벨은 렌더 시 t()로 해석한다(모듈 로드 시점에는 locale이 확정되지 않는다).
const buildPriorityOptions = (t) => [
  { value: 'urgent', label: t('branchTasks.priority.urgent'), color: priorityVar('urgent') },
  { value: 'high', label: t('branchTasks.priority.high'), color: priorityVar('high') },
  { value: 'medium', label: t('branchTasks.priority.medium'), color: priorityVar('medium') },
  { value: 'low', label: t('branchTasks.priority.low'), color: priorityVar('low') },
];

// 현재 사용자 id — 코드베이스 공통 패턴(TaskList.js:63 등): sessionStorage 'profile'.
// 담당자 드롭다운에서 본인을 맨 위로 올리는 데만 쓴다(WEAVE-44).
function currentUserId() {
  if (typeof window === 'undefined') return null;
  try {
    return JSON.parse(sessionStorage.getItem('profile') || '{}').user_id ?? null;
  } catch {
    return null;
  }
}

export default function TaskListRow({ task, branchId, taskTypes, workflowStatuses, epics, members, onClick, onContextMenu, isSelected, isOverlay, indent, expandable, expanded, onToggleExpand, progress, contextOnly }) {
  const { t } = useTranslation();
  const priorityOptions = useMemo(() => buildPriorityOptions(t), [t]);
  const statusOptions = (workflowStatuses && workflowStatuses.length > 0)
    ? workflowStatuses.map((ws) => ({ value: ws.key, label: ws.label, color: ws.color }))
    : defaultStatusOptions(t);
  const typeConfig = (taskTypes || []).find((tt) => tt.type_key === task.task_type);
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const assigneeRef = useRef(null); // 트리거
  const assigneeDropdownRef = useRef(null); // 포털된 드롭다운

  // 행 전체를 드래그 핸들로 사용. 하위태스크(indent)·오버레이는 드래그 비활성(v1 정책).
  const draggable = !isOverlay && !indent;

  // attributes(role=button·tabIndex)는 행 내부 버튼/셀렉트와 중첩되면 a11y를 해쳐 적용하지 않고,
  // 포인터 listeners만 행에 붙여 "행 전체 드래그"를 구현한다.
  const {
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: String(task.task_id),
    disabled: !draggable,
  });

  // 행 내부 인터랙티브 컨트롤(셰브론·셀렉트·담당자) 위에서 누르면 드래그가 시작되지 않도록
  // mousedown/touchstart 전파를 막는다. (MouseSensor/TouchSensor는 click보다 이른 이벤트에서 활성화)
  const stopDrag = (e) => e.stopPropagation();

  // 평상시 opacity 는 클래스(TaskListRow--context / --dragging)가 결정하도록 inline 에서 제거.
  // 드래그 중에는 dnd-kit 동작 일관성을 위해 inline 0.3 을 우선 적용한다.
  const style = isOverlay ? {} : {
    transform: CSS.Transform.toString(transform),
    transition,
    ...(isDragging ? { opacity: 0.3 } : {}),
  };

  // ⚠️ new Date('YYYY-MM-DD')를 쓰지 않는다 — UTC 자정 instant로 파싱돼 음수 offset
  // 지역(미주)에서 하루 전으로 렌더된다. due_date는 달력 날짜라 timezone 변환 대상이 아니다.
  const { formatDateOnlyShort } = useDateFormat();
  const formatDate = (dateStr) => formatDateOnlyShort(dateStr);

  useEffect(() => {
    if (!assigneeOpen) return;
    const handleClick = (e) => {
      if (assigneeRef.current?.contains(e.target)) return;
      if (assigneeDropdownRef.current?.contains(e.target)) return; // 포털 내부 클릭은 외부 아님
      setAssigneeOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [assigneeOpen]);

  const handleFieldChange = async (field, value) => {
    try {
      await axios.patch(`/branches/${branchId}/tasks/${task.task_id}`, { [field]: value });
      window.dispatchEvent(new Event('task:updated'));
    } catch {}
  };

  const epicOptions = [
    { value: '', label: t('branchTasks.none'), color: 'var(--color-text-secondary)' },
    ...selectableEpics(epics, task.epic_id).map((e) => ({
      value: String(e.epic_id),
      label: e.epic_name,
      color: e.color || '#5E6AD2',
    })),
  ];

  const myUserId = useMemo(() => currentUserId(), []);
  const memberList = useMemo(() => orderMembersForPicker(members, myUserId), [members, myUserId]);
  const hasEpic = !!task.epic_id;

  return (
    <div
      className={`TaskListRow ${isSelected ? 'TaskListRow--selected' : ''} ${isDragging ? 'TaskListRow--dragging' : ''} ${indent ? 'TaskListRow--subtask' : ''} ${contextOnly ? 'TaskListRow--context' : ''}`}
      ref={setNodeRef}
      style={style}
      onClick={onClick}
      onContextMenu={onContextMenu}
      {...(draggable ? listeners : {})}
    >
      {/* 타입 아이콘 */}
      <span className="TaskListRow__TypeIcon">
        <TaskTypeIcon
          name={typeConfig?.icon || 'CheckSquare'}
          size={14}
          color={typeConfig?.color || '#5E6AD2'}
        />
      </span>

      {/* Display ID */}
      <span className="TaskListRow__Id">{task.display_id}</span>

      {/* 제목 + 이슈 카운트 */}
      <div className="TaskListRow__TitleWrap">
        <span className="TaskListRow__Title">{task.title}</span>
        {expandable && (
          <button
            type="button"
            className="TaskListRow__Chevron"
            onMouseDown={stopDrag}
            onTouchStart={stopDrag}
            onClick={(e) => { e.stopPropagation(); onToggleExpand?.(); }}
            title={expanded ? t('branchTasks.row.collapseSubtasks') : t('branchTasks.row.expandSubtasks')}
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        )}
        {contextOnly && (
          <span
            className="TaskListRow__ContextTag"
            title={t('branchTasks.row.contextTagTitle')}
          >
            {t('branchTasks.row.contextTag')}
          </span>
        )}
        {progress && progress.total > 0 && (
          <span className="TaskListRow__Badge" title={t('branchTasks.row.progressTitle')}>
            {progressLabel(progress)}
          </span>
        )}
        {task.issue_count > 0 && (
          <span className="TaskListRow__Issues">
            +{task.issue_count}
            <MessageCircle size={12} />
          </span>
        )}
        {expandable && expanded && progress && progress.total > 0 && (
          <span className="TaskListRow__Progress">
            <span
              className="TaskListRow__ProgressFill"
              style={{ width: `${progressPercent(progress)}%` }}
            />
          </span>
        )}
      </div>

      {/* 라벨 */}
      <div className="TaskListRow__Labels">
        {(task.labels || []).map((label) => {
          // 행 상태마다 배지 부모가 다르다: 정상·hover는 목록 표면(default),
          // selected(primary-subtle 워시)·subtask(--color-surface-raised)는 행 자신의 배경이다.
          // 두 벌을 같이 실어 보내고 storedColor.scss가 행 상태로 고른다 — 정상 행 외관은 불변.
          const tint = entityTintStyle(label.color, { alpha: '20', raisedSurface: 'task-list-raised' });
          return (
            <span
              key={label.label_id}
              className={`TaskListRow__Label${tint?.['--et-on'] ? ' EntityTint' : ''}`}
              style={tint}
            >
              {label.label_name}
            </span>
          );
        })}
      </div>

      {/* 에픽 — 하위태스크는 부모에서 파생(자기 값 없음)이라 편집기를 숨긴다.
          indent prop이 아닌 parent_task_id 기준: 그룹핑 평면 뷰도 커버 */}
      {task.parent_task_id != null ? (
        <div className="TaskListRow__Cell TaskListRow__Cell--epic" />
      ) : (
        <div className={`TaskListRow__Cell TaskListRow__Cell--epic ${hasEpic ? '' : 'TaskListRow__Cell--hoverOnly'}`} onClick={stopDrag} onMouseDown={stopDrag} onTouchStart={stopDrag}>
          <CustomSelect
            value={hasEpic ? String(task.epic_id) : ''}
            options={epicOptions}
            onChange={(val) => handleFieldChange('epic_id', val ? Number(val) : null)}
            size="sm"
            hideArrow
            placeholder={t('branchTasks.row.epicPlaceholder')}
            className={`TaskListRow__Epic ${hasEpic ? '' : 'TaskListRow__Epic--empty'}`}
          />
        </div>
      )}

      {/* 상태 */}
      <div className="TaskListRow__Cell TaskListRow__Cell--status" onClick={stopDrag} onMouseDown={stopDrag} onTouchStart={stopDrag}>
        <CustomSelect
          value={task.status}
          options={statusOptions}
          onChange={(val) => handleFieldChange('status', val)}
          size="sm"
          hideArrow
          className={`TaskListRow__Status TaskListRow__Status--${task.status}`}
        />
      </div>

      {/* 마감일 */}
      <span className="TaskListRow__Cell TaskListRow__Cell--dueDate">
        <span className="TaskListRow__DueDate">
          {task.due_date ? formatDate(task.due_date) : '-'}
        </span>
      </span>

      {/* 우선순위 */}
      <div className="TaskListRow__Cell TaskListRow__Cell--priority" onClick={stopDrag} onMouseDown={stopDrag} onTouchStart={stopDrag}>
        <CustomSelect
          value={task.priority || 'low'}
          options={priorityOptions}
          onChange={(val) => handleFieldChange('priority', val)}
          size="sm"
          hideArrow
          className={`TaskListRow__Priority TaskListRow__Priority--${task.priority || 'low'}`}
        />
      </div>

      {/* 담당자 */}
      <div
        className="TaskListRow__AssigneeWrap"
        ref={assigneeRef}
        onClick={stopDrag}
        onMouseDown={stopDrag}
        onTouchStart={stopDrag}
      >
        {(() => {
          const mainAssignee = (task.assignees || []).find((a) => a.role === 'main');
          const subCount = (task.assignees || []).filter((a) => a.role === 'sub').length;
          return (
            <>
              <button
                type="button"
                className={`TaskListRow__Assignee ${!mainAssignee ? 'TaskListRow__Assignee--empty' : ''}`}
                title={mainAssignee?.username || t('branchTasks.unassigned')}
                onClick={() => setAssigneeOpen((prev) => !prev)}
              >
                {mainAssignee
                  ? <Avatar user={mainAssignee} size={24} title={mainAssignee.username} />
                  : <User size={12} />
                }
              </button>
              {subCount > 0 && (
                <span className="TaskListRow__SubCount">+{subCount}</span>
              )}
            </>
          );
        })()}

        <DropdownPortal anchorRef={assigneeRef} open={assigneeOpen} align="right" dropdownRef={assigneeDropdownRef}>
          <div className="TaskListRow__AssigneeDropdown">
            <button
              type="button"
              className={`TaskListRow__AssigneeOption ${!(task.assignees || []).find((a) => a.role === 'main') ? 'TaskListRow__AssigneeOption--selected' : ''}`}
              onClick={() => {
                const currentSubs = (task.assignees || []).filter((a) => a.role === 'sub').map((a) => a.user_id);
                handleFieldChange('assignees', { main: null, sub: currentSubs });
                setAssigneeOpen(false);
              }}
            >
              <span className="TaskListRow__AssigneeAvatar TaskListRow__AssigneeAvatar--empty">
                <User size={14} />
              </span>
              <span>{t('branchTasks.unassigned')}</span>
            </button>

            {memberList.map((m) => {
              const isMain = (task.assignees || []).some((a) => a.role === 'main' && a.user_id === m.user_id);
              return (
                <button
                  key={m.user_id}
                  type="button"
                  className={`TaskListRow__AssigneeOption ${isMain ? 'TaskListRow__AssigneeOption--selected' : ''}`}
                  onClick={() => {
                    const currentSubs = (task.assignees || []).filter((a) => a.role === 'sub' && a.user_id !== m.user_id).map((a) => a.user_id);
                    handleFieldChange('assignees', { main: m.user_id, sub: currentSubs });
                    setAssigneeOpen(false);
                  }}
                >
                  <Avatar user={m} size={24} />
                  <span>{m.username}</span>
                </button>
              );
            })}
          </div>
        </DropdownPortal>
      </div>
    </div>
  );
}
