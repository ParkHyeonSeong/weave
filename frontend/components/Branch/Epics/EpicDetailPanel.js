import { useState, useEffect } from 'react';
import { axios } from '@/library/_axios';
import { X, Trash2 } from 'lucide-react';
import CustomSelect from '@/components/common/CustomSelect';
import DatePicker from '@/components/common/DatePicker';
import TaskTypeIcon from '@/components/common/TaskTypeIcon';
import { statusCategoryVar, DEFAULT_STATUS_FALLBACK } from '@/library/themePalette';
import { useTranslation } from 'react-i18next';

const COLORS = ['#5E6AD2', '#2563EB', '#DC2626', '#16A34A', '#F59E0B', '#8B5CF6', '#EC4899', '#06B6D4'];

const STATUS_COLORS = {
  todo:        statusCategoryVar('todo'),
  in_progress: statusCategoryVar('in_progress'),
  done:        statusCategoryVar('done'),
  cancelled:   statusCategoryVar('cancelled'),
};

export default function EpicDetailPanel({ branchId, workflowStatuses = [], epicSummary, onClose, onSelectTask }) {
  const { t } = useTranslation();
  const [epic, setEpic] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  // 호스트가 현재 브랜치 status를 못 넘기는 경우(브랜치 이동 후 잔존한 cross-branch 패널)
  // 이 에픽의 브랜치 status를 직접 받아 쓴다. prop이 있으면 prop 우선(TaskDetailPanel과 동일).
  const [selfStatuses, setSelfStatuses] = useState([]);
  const statuses = (workflowStatuses && workflowStatuses.length > 0) ? workflowStatuses : selfStatuses;

  // 제목 편집
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState('');

  // 설명 편집
  const [editingDesc, setEditingDesc] = useState(false);
  const [descValue, setDescValue] = useState('');

  useEffect(() => {
    if (!epicSummary) return;
    fetchEpic();
    // branchId도 의존성에 포함 — 호스트가 브랜치를 옮겨 같은 epic_id를 다른 브랜치로
    // 조회하게 되는 경우 재조회하도록(현재는 key remount로도 방어되나 명시)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epicSummary?.epic_id, branchId]);

  const fetchEpic = async () => {
    setLoading(true);
    try {
      // 이 에픽의 브랜치 status를 항상 함께 조회한다. prop은 동일 브랜치일 때만 들어오고
      // 브랜치 이동 후 잔존하면 사라지므로(마운트 후엔 refetch 안 됨), selfStatuses를 늘 채워
      // statuses 폴백이 비지 않게 한다. prop이 있으면 statuses에서 prop 우선.
      // status는 보조 메타데이터(폴백용)라 실패해도 epic/tasks 렌더는 살린다.
      // Promise.all이면 wsRes 한 건의 reject로 epic/tasks까지 catch로 빠지므로 allSettled로 분리.
      const [epicRes, taskRes, wsRes] = await Promise.allSettled([
        axios.get(`/branches/${branchId}/epics`),
        axios.get(`/branches/${branchId}/epics/${epicSummary.epic_id}/tasks`),
        axios.get(`/branches/${branchId}/workflow-statuses`),
      ]);
      if (epicRes.status === 'fulfilled' && epicRes.value.data.status) {
        const found = epicRes.value.data.epics.find((e) => e.epic_id === epicSummary.epic_id);
        if (found) setEpic(found);
      }
      if (taskRes.status === 'fulfilled' && taskRes.value.data.status) setTasks(taskRes.value.data.tasks);
      if (wsRes.status === 'fulfilled' && wsRes.value.data.status) setSelfStatuses(wsRes.value.data.statuses);
    } catch {}
    setLoading(false);
  };

  const updateField = async (field, value) => {
    try {
      const payload = { [field]: value };
      const res = await axios.patch(`/branches/${branchId}/epics/${epic.epic_id}`, payload);
      if (res.data.status) {
        await fetchEpic();
        window.dispatchEvent(new Event('epic:updated'));
      }
    } catch {}
  };

  const saveTitle = () => {
    if (titleValue.trim() && titleValue.trim() !== epic.epic_name) {
      updateField('epic_name', titleValue.trim());
    }
    setEditingTitle(false);
  };

  const saveDesc = () => {
    const val = descValue.trim() || null;
    if (val !== (epic.description || null)) {
      updateField('description', val);
    }
    setEditingDesc(false);
  };

  const handleDelete = async () => {
    try {
      const res = await axios.delete(`/branches/${branchId}/epics/${epic.epic_id}`);
      if (res.data.status) {
        window.dispatchEvent(new Event('epic:updated'));
        onClose();
      }
    } catch {}
  };

  // 태스크 클릭 -> 태스크탭 + 상세패널 열기. 에픽 태스크는 이 에픽(=branchId)의 브랜치 소속이라,
  // 호스트가 브랜치를 옮긴 뒤에도 현재 브랜치가 아닌 이 브랜치로 조회하도록 branch_id를 박는다.
  const handleTaskClick = (task) => {
    if (onSelectTask) onSelectTask({ ...task, branch_id: task.branch_id ?? branchId });
  };

  if (loading || !epic) {
    return (
      <div className="TaskDetailPanel">
        <div className="TaskDetailPanel__Header">
          <div />
          <button className="TaskDetailPanel__CloseBtn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
      </div>
    );
  }

  // 워크플로우 상태 정보 매핑
  const getStatusInfo = (statusKey) => {
    const ws = statuses.find((w) => w.key === statusKey);
    if (ws) return { label: ws.label, color: ws.color };
    return { label: statusKey, color: STATUS_COLORS[statusKey] || '#9CA3AF' };
  };

  return (
    <div className="TaskDetailPanel">
      {/* 헤더 */}
      <div className="TaskDetailPanel__Header">
        <div className="TaskDetailPanel__HeaderLeft">
          <span
            style={{
              width: 10, height: 10, borderRadius: '50%',
              backgroundColor: epic.color || '#5E6AD2', flexShrink: 0,
            }}
          />
          <span className="TaskDetailPanel__Id">{t('branch.epicDetail.badge')}</span>
        </div>
        <button className="TaskDetailPanel__CloseBtn" onClick={onClose}>
          <X size={16} />
        </button>
      </div>

      <div className="TaskDetailPanel__Body">
        {/* 제목 */}
        <div className="TaskDetailPanel__TitleWrap">
          {editingTitle ? (
            <input
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
              onClick={() => { setTitleValue(epic.epic_name); setEditingTitle(true); }}
            >
              {epic.epic_name}
            </h2>
          )}
        </div>

        {/* 상태 */}
        <div className="TaskDetailPanel__StatusWrap">
          <CustomSelect
            value={epic.status}
            options={statuses.length > 0
              ? statuses.map((ws) => ({ value: ws.key, label: ws.label, color: ws.color }))
              : DEFAULT_STATUS_FALLBACK
            }
            onChange={(val) => updateField('status', val)}
          />
        </div>

        {/* 설명 */}
        <div className="TaskDetailPanel__Section">
          <div className="TaskDetailPanel__SectionLabel">{t('branchTasks.detail.description')}</div>
          {editingDesc ? (
            <textarea
              className="TaskDetailPanel__DescInput"
              value={descValue}
              onChange={(e) => setDescValue(e.target.value)}
              onBlur={saveDesc}
              onKeyDown={(e) => { if (e.key === 'Escape') setEditingDesc(false); }}
              autoFocus
              rows={4}
            />
          ) : (
            <div
              className={`TaskDetailPanel__DescText ${!epic.description ? 'TaskDetailPanel__DescText--empty' : ''}`}
              onClick={() => { setDescValue(epic.description || ''); setEditingDesc(true); }}
            >
              {epic.description || t('branchTasks.detail.addDescription')}
            </div>
          )}
        </div>

        <div className="TaskDetailPanel__Divider" />

        {/* 세부 사항 */}
        <div className="TaskDetailPanel__Section">
          <div className="TaskDetailPanel__SectionLabel">{t('branchTasks.detail.details')}</div>
          <div className="TaskDetailPanel__Fields">
            {/* 색상 */}
            <div className="TaskDetailPanel__Row">
              <span className="TaskDetailPanel__RowLabel">{t('modal.fields.color')}</span>
              <div className="TaskDetailPanel__RowValue">
                <div style={{ display: 'flex', gap: 4 }}>
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      style={{
                        width: 20, height: 20, borderRadius: '50%', backgroundColor: c,
                        border: epic.color === c ? '2px solid var(--color-text)' : '2px solid transparent',
                        cursor: 'pointer', transition: 'transform 150ms ease',
                      }}
                      onClick={() => updateField('color', c)}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* 시작일 */}
            <div className="TaskDetailPanel__Row">
              <span className="TaskDetailPanel__RowLabel">{t('branchTasks.fields.startDate')}</span>
              <div className="TaskDetailPanel__RowValue">
                <DatePicker
                  size="sm"
                  value={epic.start_date || null}
                  onChange={(val) => updateField('start_date', val)}
                  max={epic.due_date || null}
                />
              </div>
            </div>

            {/* 마감일 */}
            <div className="TaskDetailPanel__Row">
              <span className="TaskDetailPanel__RowLabel">{t('branchTasks.fields.dueDate')}</span>
              <div className="TaskDetailPanel__RowValue">
                <DatePicker
                  size="sm"
                  value={epic.due_date || null}
                  onChange={(val) => updateField('due_date', val)}
                  min={epic.start_date || null}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="TaskDetailPanel__Divider" />

        {/* 태스크 목록 */}
        <div className="TaskDetailPanel__Section">
          <div className="TaskDetailPanel__SectionLabel">{t('branch.epicDetail.tasksCount', { count: tasks.length })}</div>
          <div className="EpicTaskList">
            {tasks.length === 0 ? (
              <div className="EpicTaskList__Empty">{t('branch.epics.noTasksInEpic')}</div>
            ) : (
              tasks.map((task) => {
                const si = getStatusInfo(task.status);
                return (
                  <div key={task.task_id} className="EpicTaskList__Item" onClick={() => handleTaskClick(task)}>
                    <span className="EpicTaskList__StatusDot" style={{ backgroundColor: si.color }} />
                    <TaskTypeIcon type={task.task_type} size={14} />
                    <span className="EpicTaskList__Id">{task.display_id}</span>
                    <span className="EpicTaskList__Title">{task.title}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="TaskDetailPanel__Divider" />

        <button className="TaskDetailPanel__DeleteBtn" onClick={handleDelete}>
          <Trash2 size={14} />
          {t('branch.epicDetail.deleteEpic')}
        </button>
      </div>
    </div>
  );
}
