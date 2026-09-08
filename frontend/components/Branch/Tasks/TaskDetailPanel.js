import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'next/router';
import { X, Maximize2, Trash2, ChevronDown, Star, Pencil, Copy, ArrowUp } from 'lucide-react';
import useStar from '@/hooks/useStar';
import LabelTagInput from '@/components/common/LabelTagInput';
import CustomSelect from '@/components/common/CustomSelect';
import DatePicker from '@/components/common/DatePicker';
import TaskTypeIcon from '@/components/common/TaskTypeIcon';
import useTaskDetail from '@/hooks/useTaskDetail';
import { sanitizeHtml } from '@/library/sanitize';
import { ensureRenderableHtml } from '@/library/ensureHtml';
import { useDateFormat } from '@/hooks/useDateFormat';
import { selectableEpics } from '@/library/epics';
import { useRefHydration } from '@/library/refHydration';
import { useMathHydration } from '@/library/mathRender';
import { orderMembersForPicker } from '@/library/memberOrder';
import { progressFromRows, progressLabel } from '@/library/subtaskProgress';
import Avatar from '@/components/common/Avatar';
import TaskIssueSection from './TaskIssueSection';
import TaskGithubRefSection from './TaskGithubRefSection';
import TaskSubtaskSection from './TaskSubtaskSection';
import TaskDependencySection from './TaskDependencySection';
import TaskPageLinkSection from './TaskPageLinkSection';
import TaskDescriptionEditor from './TaskDescriptionEditor';
import TaskCommentSection from './TaskCommentSection';
import ConfirmModal from '@/components/modal/ConfirmModal';
import ActivityTimeline from '@/components/common/ActivityTimeline';
import NavLink from '@/components/common/NavLink';
import { taskDeleteMessage } from '@/library/taskDeleteMessage';
import { buildTaskDescriptionExtensions } from './taskDescriptionExtensions';
import { copyAsMarkdown } from '@/library/copyMarkdown';
import { priorityVar, DEFAULT_STATUS_FALLBACK } from '@/library/themePalette';

// 라벨은 렌더 시 t()로 해석한다(모듈 로드 시점에는 locale이 확정되지 않는다).
const priorityOptions = (t) => [
  { value: 'urgent', label: t('branchTasks.priority.urgent'), color: priorityVar('urgent') },
  { value: 'high', label: t('branchTasks.priority.high'), color: priorityVar('high') },
  { value: 'medium', label: t('branchTasks.priority.medium'), color: priorityVar('medium') },
  { value: 'low', label: t('branchTasks.priority.low'), color: priorityVar('low') },
];

export default function TaskDetailPanel({ branchId, branchKey, taskTypes: externalTaskTypes, workflowStatuses: externalStatuses, taskSummary, onClose, onSelectTask }) {
  const { t } = useTranslation();
  const { formatTimestamp, formatTimestampYMD } = useDateFormat();
  const router = useRouter();
  const highlightCommentId = router.query.comment_id ? Number(router.query.comment_id) : null;
  const {
    task, loading, error, sprints, epics, members, labels,
    workflowStatuses: hookStatuses, taskTypes: hookTaskTypes, customFields,
    refreshTask, updateField, updateSubtaskStatus, updateAssignees, toggleLabel, createLabel, updateLabel, deleteLabel, handleDelete, handleSelectChange,
  } = useTaskDetail(branchId, taskSummary?.task_id);

  const workflowStatuses = (externalStatuses && externalStatuses.length > 0) ? externalStatuses : hookStatuses;
  const taskTypes = (externalTaskTypes && externalTaskTypes.length > 0) ? externalTaskTypes : hookTaskTypes;

  // 진행도 파생 규칙은 library/subtaskProgress.js progressFromRows의 JSDoc 참조.
  const subtaskProgress = useMemo(
    () => progressFromRows(task?.subtasks, workflowStatuses),
    [task?.subtasks, workflowStatuses],
  );

  // 패널 내부 체이닝(부모 크럼·하위태스크·의존성·설명 칩) 선택 시 branch_id를 보강한다.
  // 칩이 cross-branch면 자기 branch_id를 싣고, 없으면(부모/의존성=동일 브랜치) 이 패널의 branchId로.
  // 호스트가 브랜치를 옮긴 뒤에도 체이닝이 현재 브랜치가 아닌 이 태스크의 브랜치를 따라가게 한다.
  const selectChainedTask = useCallback(
    (chained) => onSelectTask?.({ ...chained, branch_id: chained.branch_id ?? branchId }),
    [onSelectTask, branchId],
  );

  const { starred, toggle: toggleStar } = useStar('task', task?.task_id);

  const currentUserId = typeof window !== 'undefined'
    ? (JSON.parse(sessionStorage.getItem('profile') || '{}').user_id ?? null)
    : null;

  // Main Assignee 피커 전용 순서: 본인 → 이름순(WEAVE-44).
  // members 원본은 Sub 다중 선택기·enrich 등 다른 용도라 그대로 둔다.
  const pickerMembers = useMemo(
    () => orderMembersForPicker(members, currentUserId),
    [members, currentUserId],
  );

  // 제목 편집
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState('');
  const titleRef = useRef(null);

  // 설명 편집
  const [editingDesc, setEditingDesc] = useState(false);

  // 삭제 확인
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // readonly 설명의 ref 칩 하이드레이션 (최신 제목·상태 + 탭 내 변경 이벤트)
  const descRef = useRef(null);
  useRefHydration(descRef, [task?.description, editingDesc], !editingDesc);
  useMathHydration(descRef, [task?.description, editingDesc], !editingDesc);

  // 제목 저장
  const saveTitle = () => {
    if (titleValue.trim() && titleValue.trim() !== task.title) {
      updateField('title', titleValue.trim());
    }
    setEditingTitle(false);
  };

  // 설명 저장
  const saveDesc = useCallback((html) => {
    if (html !== (task?.description || null)) {
      updateField('description', html);
    }
    setEditingDesc(false);
  }, [task?.description, updateField]);

  // 설명을 markdown으로 클립보드 복사 (읽기 뷰 headless 변환 — 전부 클라이언트 사이드)
  const copyDescMarkdown = useCallback(() => {
    if (!task?.description) return;
    copyAsMarkdown(task.description, buildTaskDescriptionExtensions());
  }, [task?.description]);

  // 삭제
  const onDelete = async () => {
    setShowDeleteConfirm(false);
    const ok = await handleDelete();
    if (ok) onClose();
  };

  if (error || loading || !task) {
    return (
      <div className="TaskDetailPanel">
        <div className="TaskDetailPanel__Header">
          <div />
          <button className="TaskDetailPanel__CloseBtn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        {error && <div className="TaskDetailPanel__ErrorState">{t('branchTasks.detail.errorState')}</div>}
      </div>
    );
  }

  const typeConfig = (taskTypes || []).find((tt) => tt.type_key === task.task_type);
  const displayId = task.display_id
    || (branchKey ? `${branchKey}-${task.display_number}` : `#${task.display_number}`);

  return (
    <div className="TaskDetailPanel">
      {/* 헤더 */}
      <div className="TaskDetailPanel__Header">
        <div className="TaskDetailPanel__HeaderLeft">
          <TaskTypeIcon
            name={typeConfig?.icon || 'CheckSquare'}
            size={14}
            color={typeConfig?.color || '#5E6AD2'}
          />
          <span className="TaskDetailPanel__Id">{displayId}</span>
        </div>
        <div className="TaskDetailPanel__HeaderRight">
          <button
            className={`TaskDetailPanel__StarBtn ${starred ? 'TaskDetailPanel__StarBtn--active' : ''}`}
            onClick={toggleStar}
            title={starred ? t('branchTasks.star.remove') : t('branchTasks.star.add')}
          >
            <Star size={14} fill={starred ? 'currentColor' : 'none'} />
          </button>
          <NavLink
            href={`/branch/${branchId}/task/${task.task_id}`}
            className="TaskDetailPanel__ExpandBtn"
            title={t('branchTasks.openFullPage')}
          >
            <Maximize2 size={14} />
          </NavLink>
          <button className="TaskDetailPanel__CloseBtn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="TaskDetailPanel__Body">
        {task?.parent && (
          <NavLink
            href={`/branch/${branchId}/task/${task.parent.task_id}`}
            className="TaskDetailPanel__ParentCrumb"
            onClick={(e) => { if (onSelectTask) { e.preventDefault(); selectChainedTask({ task_id: task.parent.task_id }); } }}
          >
            <ArrowUp size={12} />
            <span className="TaskDetailPanel__ParentId">{task.parent.display_id}</span>
            <span className="TaskDetailPanel__ParentTitle">{task.parent.title}</span>
          </NavLink>
        )}

        {/* 제목 + 상태 */}
        <div className="TaskDetailPanel__TitleWrap">
          {editingTitle ? (
            <input
              ref={titleRef}
              className="TaskDetailPanel__TitleInput"
              value={titleValue}
              onChange={(e) => setTitleValue(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') setEditingTitle(false); }}
              autoFocus
            />
          ) : (
            <h2
              className="TaskDetailPanel__Title"
              onClick={() => { setTitleValue(task.title); setEditingTitle(true); }}
            >
              {task.title}
            </h2>
          )}
          <div className="TaskDetailPanel__StatusWrap">
            <CustomSelect
              value={task.status}
              options={workflowStatuses.length > 0
                ? workflowStatuses.map((ws) => ({ value: ws.key, label: ws.label, color: ws.color }))
                : DEFAULT_STATUS_FALLBACK}
              onChange={(val) => updateField('status', val)}
            />
            {subtaskProgress?.total > 0 && (
              <span className="TaskDetailPanel__SubtaskBadge" title={t('branchTasks.subtasks.doneBadgeTitle')}>
                {progressLabel(subtaskProgress)}
              </span>
            )}
          </div>
        </div>

        {/* 하위태스크 — 제목/상태 바로 아래. 긴 설명을 지나 스크롤하지 않고 바로 체크하기 위해서다. */}
        <TaskSubtaskSection
          key={`${branchId}:${task.task_id}`}
          branchId={branchId}
          taskId={task.task_id}
          subtasks={task.subtasks || []}
          progress={subtaskProgress}
          workflowStatuses={workflowStatuses}
          taskTypes={taskTypes}
          defaultTaskType={task.task_type}
          onSelectTask={selectChainedTask}
          onChanged={refreshTask}
          onStatusChange={updateSubtaskStatus}
        />

        <div className="TaskDetailPanel__Divider" />

        {/* 설명 */}
        <div className="TaskDetailPanel__Section">
          <div className="TaskDetailPanel__SectionLabel">
            {t('branchTasks.detail.description')}
            {!editingDesc && task.description && (
              <>
                <button className="TaskDetailPanel__DescEditBtn" onClick={() => setEditingDesc(true)} title={t('branchTasks.detail.editDescription')}>
                  <Pencil size={11} />
                </button>
                <button className="TaskDetailPanel__DescEditBtn" onClick={copyDescMarkdown} title={t('branchTasks.copyAsMarkdown')}>
                  <Copy size={11} />
                </button>
              </>
            )}
          </div>
          {editingDesc ? (
            <TaskDescriptionEditor
              content={task.description}
              onSave={saveDesc}
              branchId={branchId}
            />
          ) : (
            <div
              className={`TaskDetailPanel__DescText ${!task.description ? 'TaskDetailPanel__DescText--empty' : ''}`}
              {...(!task.description && { onClick: () => setEditingDesc(true) })}
            >
              {task.description ? (
                <div
                  ref={descRef}
                  className="TaskDescReadonly"
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(ensureRenderableHtml(task.description)) }}
                  onClick={(e) => {
                    // task-ref 클릭 → 해당 task로 이동
                    const ref = e.target.closest('.task-ref');
                    if (ref && onSelectTask) {
                      e.stopPropagation();
                      const taskId = ref.dataset.taskId;
                      // cross-branch 칩 체이닝을 위해 칩의 branch_id도 함께 전달
                      const refBranchId = ref.dataset.branchId;
                      if (taskId) {
                        selectChainedTask({
                          task_id: Number(taskId),
                          branch_id: refBranchId ? Number(refBranchId) : undefined,
                        });
                      }
                    }
                  }}
                />
              ) : (
                t('branchTasks.detail.addDescription')
              )}
            </div>
          )}
        </div>

        <div className="TaskDetailPanel__Divider" />

        {/* 세부 사항 */}
        <div className="TaskDetailPanel__Section">
          <div className="TaskDetailPanel__SectionLabel">{t('branchTasks.detail.details')}</div>
          <div className="TaskDetailPanel__Fields">
            {/* 타입 */}
            <DetailRow label={t('branchTasks.fields.type')}>
              <CustomSelect
                value={task.task_type}
                options={(taskTypes || []).map((tt) => ({
                  value: tt.type_key,
                  label: tt.type_name,
                  icon: <TaskTypeIcon name={tt.icon} size={12} color={tt.color} />,
                }))}
                onChange={(val) => handleSelectChange('task_type', val)}
                size="sm"
              />
            </DetailRow>

            {/* 우선순위 */}
            <DetailRow label={t('branchTasks.fields.priority')}>
              <CustomSelect
                value={task.priority}
                options={priorityOptions(t)}
                onChange={(val) => handleSelectChange('priority', val)}
                size="sm"
              />
            </DetailRow>

            {/* Sprint */}
            <DetailRow label={t('branchTasks.fields.sprint')}>
              {task.parent ? (
                <span className="TaskDetailPanel__Inherited" title={t('branchTasks.inheritedFromParent')}>
                  {task.parent.sprint_name || t('branchTasks.backlog')}
                </span>
              ) : (
                <CustomSelect
                  value={task.sprint_id || ''}
                  options={[
                    { value: '', label: t('branchTasks.backlog') },
                    ...sprints.map((s) => ({ value: s.sprint_id, label: s.sprint_name })),
                  ]}
                  onChange={(val) => handleSelectChange('sprint_id', val)}
                  size="sm"
                />
              )}
            </DetailRow>

            {/* Epic */}
            <DetailRow label={t('branchTasks.fields.epic')}>
              {task.parent ? (
                <span className="TaskDetailPanel__Inherited" title={t('branchTasks.inheritedFromParent')}>
                  {task.parent.epic_name || t('branchTasks.none')}
                </span>
              ) : (
                <CustomSelect
                  value={task.epic_id || ''}
                  options={[
                    { value: '', label: t('branchTasks.none') },
                    ...selectableEpics(epics, task.epic_id).map((ep) => ({
                      value: ep.epic_id,
                      label: ep.epic_name,
                      color: ep.color || '#5E6AD2',
                    })),
                  ]}
                  onChange={(val) => handleSelectChange('epic_id', val)}
                  size="sm"
                />
              )}
            </DetailRow>

            {/* 메인 담당자 */}
            <DetailRow label={t('branchTasks.fields.mainAssignee')}>
              <CustomSelect
                value={(task.assignees || []).find((a) => a.role === 'main')?.user_id || ''}
                options={[
                  { value: '', label: t('branchTasks.unassigned') },
                  ...pickerMembers.map((m) => ({ value: m.user_id, label: m.username })),
                ]}
                onChange={(val) => {
                  const mainId = val === '' ? null : Number(val);
                  const currentSubs = (task.assignees || []).filter((a) => a.role === 'sub').map((a) => a.user_id);
                  updateAssignees(mainId, currentSubs);
                }}
                size="sm"
              />
            </DetailRow>

            {/* 서브 담당자 */}
            <DetailRow label={t('branchTasks.fields.subAssignees')}>
              <SubAssigneeDropdown
                members={members.filter((m) => {
                  const mainId = (task.assignees || []).find((a) => a.role === 'main')?.user_id;
                  return m.user_id !== mainId;
                })}
                selectedIds={(task.assignees || []).filter((a) => a.role === 'sub').map((a) => a.user_id)}
                onChange={(newSubs) => {
                  const mainId = (task.assignees || []).find((a) => a.role === 'main')?.user_id || null;
                  updateAssignees(mainId, newSubs);
                }}
              />
            </DetailRow>

            {/* 라벨 */}
            <DetailRow label={t('branchTasks.fields.labels')}>
              <LabelTagInput
                assignedLabels={task.labels || []}
                allLabels={labels}
                onToggle={toggleLabel}
                onCreate={createLabel}
                onDelete={deleteLabel}
                onUpdateColor={(labelId, color) => updateLabel(labelId, { color })}
              />
            </DetailRow>

            {/* 시작일 */}
            <DetailRow label={t('branchTasks.fields.startDate')}>
              <DatePicker
                size="sm"
                value={task.start_date || null}
                onChange={(val) => updateField('start_date', val)}
                max={task.due_date || null}
              />
            </DetailRow>

            {/* 마감일 */}
            <DetailRow label={t('branchTasks.fields.dueDate')}>
              <DatePicker
                size="sm"
                value={task.due_date || null}
                onChange={(val) => updateField('due_date', val)}
                min={task.start_date || null}
              />
            </DetailRow>

            {/* 생성자 */}
            <DetailRow label={t('branchTasks.fields.createdBy')}>
              {task.creator ? (
                <span className="TaskDetailPanel__Creator">
                  <Avatar user={task.creator} size="xs" />
                  <span className="TaskDetailPanel__CreatorName">{task.creator.username || '—'}</span>
                </span>
              ) : (
                <span className="TaskDetailPanel__CreatorEmpty">—</span>
              )}
            </DetailRow>

            {/* 생성일 */}
            <DetailRow label={t('branchTasks.fields.created')}>
              <span
                className="TaskDetailPanel__CreatedAt"
                title={formatTimestamp(task.created_at) || undefined}
              >
                {formatTimestampYMD(task.created_at) || '—'}
              </span>
            </DetailRow>
          </div>
        </div>

        {/* 커스텀 필드 */}
        {customFields.length > 0 && (
          <>
            <div className="TaskDetailPanel__Divider" />
            <div className="TaskDetailPanel__Section">
              <div className="TaskDetailPanel__SectionLabel">{t('branchTasks.detail.customFields')}</div>
              <div className="TaskDetailPanel__Fields">
                {customFields.map((cf) => (
                  <DetailRow key={cf.custom_field_id} label={cf.field_name}>
                    <CustomFieldInput
                      field={cf}
                      value={(task.custom_fields || {})[cf.custom_field_id]}
                      onChange={(val) => {
                        const updated = { ...(task.custom_fields || {}), [cf.custom_field_id]: val };
                        updateField('custom_fields', updated);
                      }}
                    />
                  </DetailRow>
                ))}
              </div>
            </div>
          </>
        )}

        <div className="TaskDetailPanel__Divider" />

        {/* 의존관계 섹션 */}
        <TaskDependencySection
          branchId={branchId}
          taskId={task.task_id}
          onSelectTask={selectChainedTask}
        />

        <div className="TaskDetailPanel__Divider" />

        {/* 연결된 페이지 섹션 */}
        <TaskPageLinkSection branchId={branchId} taskId={task.task_id} />

        <div className="TaskDetailPanel__Divider" />

        {/* 이슈 섹션 */}
        <TaskIssueSection branchId={branchId} taskId={task.task_id} />

        <div className="TaskDetailPanel__Divider" />

        {/* GitHub PR 섹션 */}
        <TaskGithubRefSection branchId={branchId} taskId={task.task_id} />

        <div className="TaskDetailPanel__Divider" />

        {/* 댓글 */}
        <TaskCommentSection
          branchId={branchId}
          taskId={task.task_id}
          members={members}
          currentUserId={currentUserId}
          highlightCommentId={highlightCommentId}
        />

        <div className="TaskDetailPanel__Divider" />

        {/* 활동 이력 */}
        <ActivityTimeline
          apiUrl={`/branches/${branchId}/tasks/${task.task_id}/activity`}
        />

        <div className="TaskDetailPanel__Divider" />

        {/* 삭제 */}
        <button className="TaskDetailPanel__DeleteBtn" onClick={() => setShowDeleteConfirm(true)}>
          <Trash2 size={14} />
          {t('branchTasks.detail.deleteTask')}
        </button>
      </div>

      <ConfirmModal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={onDelete}
        title={t('branchTasks.deleteTaskTitle')}
        message={taskDeleteMessage(task, {
          prefix: t('branchTasks.deleteTaskConfirm', { target: `${displayId} - ${task.title}` }),
          t,
        })}
        confirmLabel={t('common.actions.delete')}
        variant="danger"
      />
    </div>
  );
}

function DetailRow({ label, children, align }) {
  return (
    <div className={`TaskDetailPanel__Row ${align === 'top' ? 'TaskDetailPanel__Row--top' : ''}`}>
      <span className="TaskDetailPanel__RowLabel">{label}</span>
      <div className="TaskDetailPanel__RowValue">{children}</div>
    </div>
  );
}

function CustomFieldInput({ field, value, onChange }) {
  const { t } = useTranslation();
  switch (field.field_type) {
    case 'text':
      return (
        <input
          className="TaskDetailPanel__DateInput"
          type="text"
          value={value || ''}
          onChange={(e) => onChange(e.target.value || null)}
          placeholder={field.field_name}
        />
      );
    case 'number':
      return (
        <input
          className="TaskDetailPanel__DateInput"
          type="number"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
        />
      );
    case 'date':
      return (
        <DatePicker
          size="sm"
          value={value || null}
          onChange={onChange}
        />
      );
    case 'checkbox':
      return (
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
        />
      );
    case 'select':
      return (
        <select
          className="TaskDetailPanel__DateInput"
          value={value || ''}
          onChange={(e) => onChange(e.target.value || null)}
        >
          <option value="">{t('branchTasks.selectPlaceholder')}</option>
          {(field.field_options || []).map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      );
    case 'url':
      return (
        <input
          className="TaskDetailPanel__DateInput"
          type="url"
          value={value || ''}
          onChange={(e) => onChange(e.target.value || null)}
          placeholder="https://..."
        />
      );
    default:
      return (
        <input
          className="TaskDetailPanel__DateInput"
          type="text"
          value={value || ''}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );
  }
}

function SubAssigneeDropdown({ members, selectedIds, onChange }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const toggle = (userId) => {
    const newIds = selectedIds.includes(userId)
      ? selectedIds.filter((id) => id !== userId)
      : [...selectedIds, userId];
    onChange(newIds);
  };

  const selectedNames = members
    .filter((m) => selectedIds.includes(m.user_id))
    .map((m) => m.username);

  return (
    <div className="TaskDetailPanel__SubAssigneeWrap" ref={ref}>
      <button
        type="button"
        className="TaskDetailPanel__SubAssigneeBtn"
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className={selectedNames.length > 0 ? '' : 'TaskDetailPanel__SubAssigneePlaceholder'}>
          {selectedNames.length > 0 ? selectedNames.join(', ') : t('branchTasks.none')}
        </span>
        <ChevronDown size={12} />
      </button>
      {open && members.length > 0 && (
        <div className="TaskDetailPanel__SubAssigneeDropdown">
          {members.map((m) => (
            <label key={m.user_id} className="TaskDetailPanel__SubAssigneeOption">
              <input
                type="checkbox"
                checked={selectedIds.includes(m.user_id)}
                onChange={() => toggle(m.user_id)}
              />
              <span>{m.username}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
