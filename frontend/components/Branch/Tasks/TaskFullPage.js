import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'next/router';
import { ArrowLeft, Trash2, ChevronDown, ShieldAlert, Star, Pencil, Copy, ArrowUp } from 'lucide-react';
import useStar from '@/hooks/useStar';
import LabelTagInput from '@/components/common/LabelTagInput';
import { axios } from '@/library/_axios';
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
import { errorText } from '@/library/errorText';
import { orderMembersForPicker } from '@/library/memberOrder';
import { progressFromRows, progressLabel } from '@/library/subtaskProgress';
import Avatar from '@/components/common/Avatar';
import TaskIssueSection from './TaskIssueSection';
import TaskSubtaskSection from './TaskSubtaskSection';
import TaskCommentSection from './TaskCommentSection';
import TaskDependencySection from './TaskDependencySection';
import TaskPageLinkSection from './TaskPageLinkSection';
import TaskGithubRefSection from './TaskGithubRefSection';
import TaskDescriptionEditor from './TaskDescriptionEditor';
import ConfirmModal from '@/components/modal/ConfirmModal';
import ActivityTimeline from '@/components/common/ActivityTimeline';
import { taskDeleteMessage } from '@/library/taskDeleteMessage';
import { buildTaskDescriptionExtensions } from './taskDescriptionExtensions';
import { copyAsMarkdown } from '@/library/copyMarkdown';
import { priorityVar, defaultStatusOptions } from '@/library/themePalette';

// 라벨은 렌더 시 t()로 해석한다(모듈 로드 시점에는 locale이 확정되지 않는다).
const priorityOptions = (t) => [
  { value: 'urgent', label: t('branchTasks.priority.urgent'), color: priorityVar('urgent') },
  { value: 'high', label: t('branchTasks.priority.high'), color: priorityVar('high') },
  { value: 'medium', label: t('branchTasks.priority.medium'), color: priorityVar('medium') },
  { value: 'low', label: t('branchTasks.priority.low'), color: priorityVar('low') },
];

export default function TaskFullPage() {
  const { t } = useTranslation();
  const { formatTimestamp, formatTimestampYMD } = useDateFormat();
  const router = useRouter();
  const { id: branchId, taskId } = router.query;
  const highlightCommentId = router.query.comment_id ? Number(router.query.comment_id) : null;

  const [branch, setBranch] = useState(null);

  const {
    task, loading, error, sprints, epics, members, labels,
    workflowStatuses, taskTypes, customFields,
    refreshTask, updateField, updateSubtaskStatus, updateAssignees, toggleLabel, createLabel, updateLabel, deleteLabel, handleDelete, handleSelectChange,
  } = useTaskDetail(branchId, taskId);

  // 진행도 파생 규칙은 library/subtaskProgress.js progressFromRows의 JSDoc 참조.
  const subtaskProgress = useMemo(
    () => progressFromRows(task?.subtasks, workflowStatuses),
    [task?.subtasks, workflowStatuses],
  );

  const { starred, toggle: toggleStar } = useStar('task', task?.task_id);

  const currentUserId = typeof window !== 'undefined'
    ? (JSON.parse(sessionStorage.getItem('profile') || '{}').user_id ?? null)
    : null;

  const pickerMembers = useMemo(
    () => orderMembersForPicker(members, currentUserId),
    [members, currentUserId],
  );

  // 제목 편집
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState('');

  // 설명 편집
  const [editingDesc, setEditingDesc] = useState(false);

  // 삭제 확인
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // readonly 설명의 ref 칩 하이드레이션 (최신 제목·상태 + 탭 내 변경 이벤트)
  const descRef = useRef(null);
  useRefHydration(descRef, [task?.description, editingDesc], !editingDesc);
  useMathHydration(descRef, [task?.description, editingDesc], !editingDesc);

  useEffect(() => {
    if (!branchId) return;
    const fetchBranch = async () => {
      try {
        const branchRes = await axios.get(`/branches/${branchId}`);
        if (branchRes.data.status) setBranch(branchRes.data.branch);
      } catch {}
    };
    fetchBranch();
  }, [branchId]);

  const saveTitle = () => {
    if (titleValue.trim() && titleValue.trim() !== task.title) {
      updateField('title', titleValue.trim());
    }
    setEditingTitle(false);
  };

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

  const onDelete = async () => {
    setShowDeleteConfirm(false);
    const ok = await handleDelete();
    if (ok) router.push(`/branch/${branchId}`);
  };

  if (!branchId || !taskId) return null;
  if (loading) {
    return <div className="TaskFullPage"><div className="TaskFullPage__Loading">{t('common.state.loading')}</div></div>;
  }
  if (error || !task) {
    // error는 useTaskDetail이 setError(getErrorCode(res.data))로 저장한 코드 문자열
    const msg = errorText(error) ?? t('branchTasks.fullPage.loadFailed');
    return (
      <div className="TaskFullPage">
        <div className="TaskFullPage__Error">
          <ShieldAlert size={32} />
          <p>{msg}</p>
          <button className="TaskFullPage__ErrorBtn" onClick={() => router.back()}>
            {t('common.actions.back')}
          </button>
        </div>
      </div>
    );
  }

  const branchKey = branch?.key || '';
  const typeConfig = (taskTypes || []).find((tt) => tt.type_key === task.task_type);
  const displayId = task.display_id || `${branchKey}-${task.display_number}`;

  return (
    <div className="TaskFullPage">
      {/* 헤더 */}
      <div className="TaskFullPage__Header">
        <div className="TaskFullPage__HeaderLeft">
          <button className="TaskFullPage__BackBtn" onClick={() => router.push(`/branch/${branchId}`)}>
            <ArrowLeft size={16} />
          </button>
          <TaskTypeIcon
            name={typeConfig?.icon || 'CheckSquare'}
            size={16}
            color={typeConfig?.color || '#5E6AD2'}
          />
          <span className="TaskFullPage__DisplayId">{displayId}</span>
          {task.parent && (
            <button
              type="button"
              className="TaskFullPage__ParentCrumb"
              onClick={() => router.push(`/branch/${branchId}/task/${task.parent.task_id}`)}
            >
              <ArrowUp size={12} />
              <span className="TaskFullPage__ParentId">{task.parent.display_id}</span>
              <span className="TaskFullPage__ParentTitle">{task.parent.title}</span>
            </button>
          )}
          <button
            className={`TaskFullPage__StarBtn ${starred ? 'TaskFullPage__StarBtn--active' : ''}`}
            onClick={toggleStar}
            title={starred ? t('branchTasks.star.remove') : t('branchTasks.star.add')}
          >
            <Star size={14} fill={starred ? 'currentColor' : 'none'} />
          </button>
        </div>
        <button className="TaskFullPage__DeleteBtn" onClick={() => setShowDeleteConfirm(true)}>
          <Trash2 size={14} />
          {t('common.actions.delete')}
        </button>
      </div>

      {/* 2단 레이아웃 */}
      <div className="TaskFullPage__Layout">
        {/* 왼쪽: 제목 + 상태 + 설명 + 이슈 */}
        <div className="TaskFullPage__Main">
          {/* 제목 */}
          <div className="TaskFullPage__TitleWrap">
            {editingTitle ? (
              <input
                className="TaskFullPage__TitleInput"
                value={titleValue}
                onChange={(e) => setTitleValue(e.target.value)}
                onBlur={saveTitle}
                onKeyDown={(e) => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') setEditingTitle(false); }}
                autoFocus
              />
            ) : (
              <h1
                className="TaskFullPage__Title"
                onClick={() => { setTitleValue(task.title); setEditingTitle(true); }}
              >
                {task.title}
              </h1>
            )}
          </div>

          {/* 상태 */}
          <div className="TaskFullPage__StatusWrap">
            <CustomSelect
              value={task.status}
              options={workflowStatuses.length > 0
                ? workflowStatuses.map((ws) => ({ value: ws.key, label: ws.label, color: ws.color }))
                : defaultStatusOptions(t)
              }
              onChange={(val) => updateField('status', val)}
            />
            {subtaskProgress?.total > 0 && (
              <span className="TaskFullPage__SubtaskBadge" title={t('branchTasks.subtasks.doneBadgeTitle')}>
                {progressLabel(subtaskProgress)}
              </span>
            )}
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
            onSelectTask={(st) => router.push(`/branch/${branchId}/task/${st.task_id}`)}
            onChanged={refreshTask}
            onStatusChange={updateSubtaskStatus}
          />

          <div className="TaskFullPage__Divider" />

          {/* 설명 */}
          <div className="TaskFullPage__Section">
            <div className="TaskFullPage__SectionLabel">
              {t('branchTasks.detail.description')}
              {!editingDesc && task.description && (
                <>
                  <button className="TaskFullPage__DescEditBtn" onClick={() => setEditingDesc(true)} title={t('branchTasks.detail.editDescription')}>
                    <Pencil size={11} />
                  </button>
                  <button className="TaskFullPage__DescEditBtn" onClick={copyDescMarkdown} title={t('branchTasks.copyAsMarkdown')}>
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
                className={`TaskFullPage__DescText ${!task.description ? 'TaskFullPage__DescText--empty' : ''}`}
                {...(!task.description && { onClick: () => setEditingDesc(true) })}
              >
                {task.description ? (
                  <div
                    ref={descRef}
                    className="TaskDescReadonly"
                    dangerouslySetInnerHTML={{ __html: sanitizeHtml(ensureRenderableHtml(task.description)) }}
                    onClick={(e) => {
                      const ref = e.target.closest('.task-ref');
                      if (ref) {
                        e.stopPropagation();
                        const taskId = ref.dataset.taskId;
                        if (taskId) router.push(`/branch/${branchId}/task/${taskId}`);
                      }
                    }}
                  />
                ) : (
                  t('branchTasks.detail.addDescription')
                )}
              </div>
            )}
          </div>

          <div className="TaskFullPage__Divider" />

          {/* 의존관계 */}
          <TaskDependencySection
            branchId={branchId}
            taskId={task.task_id}
            onSelectTask={(dep) => router.push(`/branch/${branchId}/task/${dep.task_id}`)}
          />

          <div className="TaskFullPage__Divider" />

          {/* 연결된 페이지 */}
          <TaskPageLinkSection branchId={branchId} taskId={task.task_id} />

          <div className="TaskFullPage__Divider" />

          {/* 이슈 */}
          <TaskIssueSection branchId={branchId} taskId={task.task_id} expanded />

          <div className="TaskFullPage__Divider" />

          {/* GitHub PR */}
          <TaskGithubRefSection branchId={branchId} taskId={task.task_id} />

          <div className="TaskFullPage__Divider" />

          {/* 댓글 */}
          <TaskCommentSection
            branchId={branchId}
            taskId={task.task_id}
            members={members}
            currentUserId={currentUserId}
            highlightCommentId={highlightCommentId}
          />

          <div className="TaskFullPage__Divider" />

          {/* 활동 이력 */}
          <ActivityTimeline
            apiUrl={`/branches/${branchId}/tasks/${task.task_id}/activity`}
            expanded
          />
        </div>

        {/* 오른쪽: 세부 사항 */}
        <div className="TaskFullPage__Sidebar">
          <div className="TaskFullPage__SectionLabel">{t('branchTasks.detail.details')}</div>
          <div className="TaskFullPage__Fields">
            <FieldRow label={t('branchTasks.fields.type')}>
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
            </FieldRow>

            <FieldRow label={t('branchTasks.fields.priority')}>
              <CustomSelect
                value={task.priority}
                options={priorityOptions(t)}
                onChange={(val) => handleSelectChange('priority', val)}
                size="sm"
              />
            </FieldRow>

            <FieldRow label={t('branchTasks.fields.sprint')}>
              {task.parent ? (
                <span className="TaskFullPage__Inherited" title={t('branchTasks.inheritedFromParent')}>
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
            </FieldRow>

            <FieldRow label={t('branchTasks.fields.epic')}>
              {task.parent ? (
                <span className="TaskFullPage__Inherited" title={t('branchTasks.inheritedFromParent')}>
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
            </FieldRow>

            <FieldRow label={t('branchTasks.fields.mainAssignee')}>
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
            </FieldRow>

            <FieldRow label={t('branchTasks.fields.subAssignees')}>
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
            </FieldRow>

            <FieldRow label={t('branchTasks.fields.labels')}>
              <LabelTagInput
                assignedLabels={task.labels || []}
                allLabels={labels}
                onToggle={toggleLabel}
                onCreate={createLabel}
                onDelete={deleteLabel}
                onUpdateColor={(labelId, color) => updateLabel(labelId, { color })}
              />
            </FieldRow>

            <FieldRow label={t('branchTasks.fields.startDate')}>
              <DatePicker
                size="sm"
                value={task.start_date || null}
                onChange={(val) => updateField('start_date', val)}
                max={task.due_date || null}
              />
            </FieldRow>

            <FieldRow label={t('branchTasks.fields.dueDate')}>
              <DatePicker
                size="sm"
                value={task.due_date || null}
                onChange={(val) => updateField('due_date', val)}
                min={task.start_date || null}
              />
            </FieldRow>

            {/* 생성자 */}
            <FieldRow label={t('branchTasks.fields.createdBy')}>
              {task.creator ? (
                <span className="TaskFullPage__Creator">
                  <Avatar user={task.creator} size="xs" />
                  <span className="TaskFullPage__CreatorName">{task.creator.username || '—'}</span>
                </span>
              ) : (
                <span className="TaskFullPage__CreatorEmpty">—</span>
              )}
            </FieldRow>

            {/* 생성일 */}
            <FieldRow label={t('branchTasks.fields.created')}>
              <span
                className="TaskFullPage__CreatedAt"
                title={formatTimestamp(task.created_at) || undefined}
              >
                {formatTimestampYMD(task.created_at) || '—'}
              </span>
            </FieldRow>

            {/* 커스텀 필드 */}
            {customFields.map((cf) => (
              <FieldRow key={cf.custom_field_id} label={cf.field_name}>
                <CustomFieldInput
                  field={cf}
                  value={(task.custom_fields || {})[cf.custom_field_id]}
                  onChange={(val) => {
                    const updated = { ...(task.custom_fields || {}), [cf.custom_field_id]: val };
                    updateField('custom_fields', updated);
                  }}
                  className="TaskFullPage__DateInput"
                />
              </FieldRow>
            ))}
          </div>
        </div>
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

function FieldRow({ label, children, align }) {
  return (
    <div className={`TaskFullPage__Row ${align === 'top' ? 'TaskFullPage__Row--top' : ''}`}>
      <span className="TaskFullPage__RowLabel">{label}</span>
      <div className="TaskFullPage__RowValue">{children}</div>
    </div>
  );
}

function CustomFieldInput({ field, value, onChange, className = '' }) {
  const { t } = useTranslation();
  const inputClass = className || 'TaskFullPage__DateInput';
  switch (field.field_type) {
    case 'text':
      return <input className={inputClass} type="text" value={value || ''} onChange={(e) => onChange(e.target.value || null)} placeholder={field.field_name} />;
    case 'number':
      return <input className={inputClass} type="number" value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} />;
    case 'date':
      return <DatePicker size="sm" value={value || null} onChange={onChange} />;
    case 'checkbox':
      return <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />;
    case 'select':
      return (
        <select className={inputClass} value={value || ''} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">{t('branchTasks.selectPlaceholder')}</option>
          {(field.field_options || []).map((opt) => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      );
    case 'url':
      return <input className={inputClass} type="url" value={value || ''} onChange={(e) => onChange(e.target.value || null)} placeholder="https://..." />;
    default:
      return <input className={inputClass} type="text" value={value || ''} onChange={(e) => onChange(e.target.value || null)} />;
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
    <div className="TaskFullPage__SubAssigneeWrap" ref={ref}>
      <button
        type="button"
        className="TaskFullPage__SubAssigneeBtn"
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className={selectedNames.length > 0 ? '' : 'TaskFullPage__Placeholder'}>
          {selectedNames.length > 0 ? selectedNames.join(', ') : t('branchTasks.none')}
        </span>
        <ChevronDown size={12} />
      </button>
      {open && members.length > 0 && (
        <div className="TaskFullPage__SubAssigneeDropdown">
          {members.map((m) => (
            <label key={m.user_id} className="TaskFullPage__SubAssigneeOption">
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
