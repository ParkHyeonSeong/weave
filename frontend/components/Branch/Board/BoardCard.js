import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar, CheckSquare, ChevronRight } from 'lucide-react';
import TaskTypeIcon from '@/components/common/TaskTypeIcon';
import Avatar from '@/components/common/Avatar';
import { useDateFormat } from '@/hooks/useDateFormat';
import { ddayBadge } from '@/library/dueBadge';
import { entityTintStyle } from '@/library/entityTint';
import { progressLabel, progressPercent } from '@/library/subtaskProgress';
import { priorityInkVar, tokenVar, FALLBACK_TOKEN } from '@/library/themePalette';

// 기본값인 medium까지 모든 카드에 붙으면 소음이라, 기본에서 벗어난 우선순위만 보여준다
const SHOWN_PRIORITIES = new Set(['urgent', 'high', 'low']);

export default function BoardCard({ task, taskTypes, workflowStatuses, epics, onClick, onContextMenu, onSubtaskClick }) {
  const { t } = useTranslation();
  const { today, formatDateOnlyShort } = useDateFormat();
  const [subtasksOpen, setSubtasksOpen] = useState(false);
  const typeConfig = (taskTypes || []).find((tt) => tt.type_key === task.task_type);
  const subtasks = task.subtasks || [];
  const labels = task.labels || [];
  const assignees = task.assignees || [];
  const mainAssignee = assignees.find((a) => a.role === 'main');
  const subCount = assignees.filter((a) => a.role === 'sub').length;
  const hasAssignee = assignees.length > 0;
  // total은 취소된 하위태스크를 뺀 수 — 0이면 목록 화면·상세 섹션처럼 진행도 줄을 숨긴다
  const progress = task.subtask_progress;
  const progressText = progressLabel(progress);

  // 하위태스크 상태 점 — 색은 브랜치 workflow_status.color가 authority(TaskSubtaskSection과 같은 규칙)
  const statusColor = (key) => workflowStatuses.find((ws) => ws.key === key)?.color || tokenVar(FALLBACK_TOKEN);

  // 에픽 칩 — 이름·색은 보드가 불러 둔 브랜치 에픽 목록에서 찾는다(목록 행의 에픽 칸과 같은 출처)
  const epic = (epics || []).find((e) => e.epic_id === task.epic_id);
  // 마감 칩 — D-day는 개인 시간대의 오늘 기준(ddayBadge). 지남=빨강, 이틀 이내=주황.
  // 완료·취소된 태스크는 My Tasks의 연체 표시(isOverdue)처럼 경고하지 않고 날짜만 보인다
  const dueDate = formatDateOnlyShort(task.due_date);
  const due = dueDate ? ddayBadge(task.due_date, today()) : null;
  const statusCategory = workflowStatuses.find((ws) => ws.key === task.status)?.category;
  const isClosed = statusCategory === 'done' || statusCategory === 'cancelled';
  const dueTone = due && !isClosed && (due.cls === 'over' || due.cls === 'soon') ? due.cls : 'calm';

  const handleDragStart = (e) => {
    e.dataTransfer.setData('text/plain', String(task.task_id));
    e.dataTransfer.effectAllowed = 'move';
  };

  // 하위태스크 영역의 클릭·우클릭은 카드(부모 태스크 열기·부모 메뉴)로 번지지 않게 이 경계에서 막는다
  // — 하위태스크 줄에서 부모 메뉴의 '삭제'가 뜨면 부모를 지우게 된다
  const stopAtBlock = (e) => e.stopPropagation();
  // 이 영역에서 시작한 드래그는 부모 카드 드래그가 아니다. 브라우저는 누른 지점에서 가장 가까운
  // draggable 조상을 원천으로 고르므로(제목이면 카드 자체) stopPropagation만으로는 못 막는다 —
  // 영역을 draggable로 두어 원천을 가로챈 뒤 취소한다. 사진(<img>, 기본 draggable)의 dragstart도 여기서 멈춘다.
  const cancelDragAtBlock = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div
      className="BoardCard"
      onClick={onClick}
      onContextMenu={onContextMenu}
      draggable
      onDragStart={handleDragStart}
    >
      <div className="BoardCard__Top">
        <span className="BoardCard__TypeIcon">
          <TaskTypeIcon
            name={typeConfig?.icon || 'CheckSquare'}
            size={13}
            color={typeConfig?.color || '#5E6AD2'}
          />
        </span>
        <span className="BoardCard__Id">{task.display_id}</span>
        {SHOWN_PRIORITIES.has(task.priority) && (
          <span className="BoardCard__Priority" style={{ color: priorityInkVar(task.priority) }}>
            {t(`branchTasks.priority.${task.priority}`)}
          </span>
        )}
      </div>

      <div className="BoardCard__Title">{task.title}</div>

      {/* 하위태스크: 진행도 줄을 누르면 목록을 펼친다. 상태 변경은 하위태스크를 눌러 연 패널에서 한다 */}
      {progress?.total > 0 && (
        <div
          className="BoardCard__SubtaskBlock"
          draggable
          onDragStart={cancelDragAtBlock}
          onClick={stopAtBlock}
          onContextMenu={stopAtBlock}
        >
          <button
            type="button"
            className="BoardCard__Progress"
            aria-expanded={subtasksOpen}
            aria-label={t('branch.board.subtasksToggle', { progress: progressText })}
            onClick={() => setSubtasksOpen((open) => !open)}
          >
            <ChevronRight
              size={12}
              className={`BoardCard__Chevron${subtasksOpen ? ' BoardCard__Chevron--open' : ''}`}
            />
            <CheckSquare size={12} className="BoardCard__ProgressIcon" />
            <span className="BoardCard__ProgressText">{progressText}</span>
            <span className="BoardCard__ProgressBar">
              <span className="BoardCard__ProgressFill" style={{ width: `${progressPercent(progress)}%` }} />
            </span>
          </button>

          {subtasksOpen && (
            <ul className="BoardCard__Subtasks">
              {subtasks.map((st) => {
                const stMain = (st.assignees || []).find((a) => a.role === 'main');
                return (
                  <li key={st.task_id}>
                    <button
                      type="button"
                      className="BoardCard__Subtask"
                      aria-label={t('branchTasks.subtasks.openAria', { id: st.display_id, title: st.title })}
                      onClick={() => onSubtaskClick(st)}
                    >
                      <span
                        className="BoardCard__SubtaskDot"
                        style={{ backgroundColor: statusColor(st.status) }}
                        aria-hidden="true"
                      />
                      <span className="BoardCard__SubtaskId">{st.display_id}</span>
                      <span className="BoardCard__SubtaskTitle">{st.title}</span>
                      {stMain && <Avatar user={stMain} size={16} />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* 에픽(왼쪽) + 마감(오른쪽) 한 줄 — 둘 다 없으면 줄을 만들지 않는다 */}
      {(epic || dueDate) && (
        <div className="BoardCard__Meta">
          {epic && (
            <span className="BoardCard__Epic" title={epic.epic_name}>
              <span
                className="BoardCard__EpicDot"
                style={{ backgroundColor: epic.color || tokenVar(FALLBACK_TOKEN) }}
                aria-hidden="true"
              />
              <span className="BoardCard__EpicName">{epic.epic_name}</span>
            </span>
          )}
          {dueDate && (
            <span
              className={`BoardCard__Due BoardCard__Due--${dueTone}`}
              title={t('branch.board.dueTitle', { date: dueDate })}
            >
              <Calendar size={11} aria-hidden="true" />
              <span className="BoardCard__DueDate">{dueDate}</span>
              {dueTone !== 'calm' && <span className="BoardCard__DueDday">{due.text}</span>}
            </span>
          )}
        </div>
      )}

      {/* 하단: 라벨(왼쪽) + 담당자(오른쪽) 한 줄 */}
      {(labels.length > 0 || hasAssignee) && (
        <div className="BoardCard__Footer">
          {labels.length > 0 && (
            <div className="BoardCard__Labels">
              {labels.map((label) => {
                const tint = entityTintStyle(label.color, { alpha: '20' });
                return (
                  <span
                    key={label.label_id}
                    className={`BoardCard__Label${tint?.['--et-on'] ? ' EntityTint' : ''}`}
                    style={tint}
                    title={label.label_name}
                  >
                    {label.label_name}
                  </span>
                );
              })}
            </div>
          )}
          {hasAssignee && (
            <div className="BoardCard__Assignees">
              {mainAssignee && <Avatar user={mainAssignee} size={22} />}
              {subCount > 0 && <span className="BoardCard__SubCount">+{subCount}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
