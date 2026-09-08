import { useState, useEffect } from 'react';
import { axios } from '@/library/_axios';
import { Archive } from 'lucide-react';
import TaskTypeIcon from '@/components/common/TaskTypeIcon';
import Avatar from '@/components/common/Avatar';
import TaskFilterBar from '../TaskFilterBar';
import { entityTintStyle } from '@/library/entityTint';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useTranslation } from 'react-i18next';

export default function ArchiveList({ branchId, branchKey, taskTypes, workflowStatuses, onSelectTask }) {
  const { t } = useTranslation();
  const { formatTimestamp } = useDateFormat();
  const [tasks, setTasks] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);

  // 필터 상태
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUserIds, setSelectedUserIds] = useState(new Set());

  useEffect(() => {
    fetchArchive();
    fetchMembers();
  }, [branchId]);

  useEffect(() => {
    const handleRefresh = () => fetchArchive();
    window.addEventListener('task:updated', handleRefresh);
    return () => window.removeEventListener('task:updated', handleRefresh);
  }, [branchId]);

  const fetchArchive = async () => {
    try {
      const res = await axios.get(`/branches/${branchId}/tasks/archive`);
      if (res.data.status) setTasks(res.data.tasks);
    } catch {}
    setLoading(false);
  };

  const fetchMembers = async () => {
    try {
      const res = await axios.get(`/branches/${branchId}/members`);
      if (res.data.status) setMembers(res.data.members);
    } catch {}
  };

  const handleToggleUser = (userId) => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const filterTasks = (list) => list.filter((t) => {
    if (searchQuery && !t.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (selectedUserIds.size > 0) {
      const taskUserIds = (t.assignees || []).map((a) => a.user_id);
      if (selectedUserIds.has(0) && taskUserIds.length === 0) return true;
      if (!taskUserIds.some((uid) => selectedUserIds.has(uid))) return false;
    }
    return true;
  });

  // 아카이브 시각은 timestamp다 — 개인 timezone의 달력 날짜로 표시한다.
  const formatDate = (iso) => (iso ? formatTimestamp(iso, {
    year: 'numeric', month: '2-digit', day: '2-digit',
  }) : '');

  if (loading) return null;

  const filtered = filterTasks(tasks);

  if (tasks.length === 0) {
    return (
      <div className="ArchiveList">
        <div className="ArchiveList__Empty">
          <Archive size={40} />
          <p className="ArchiveList__EmptyTitle">{t('branch.archive.emptyTitle')}</p>
          <p className="ArchiveList__EmptyDesc">
            {t('branch.archive.emptyDesc')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="ArchiveList">
      <div className="ArchiveList__Actions">
        <TaskFilterBar
          members={members}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          selectedUserIds={selectedUserIds}
          onToggleUser={handleToggleUser}
        />
        <span className="ArchiveList__Count">{t('branch.archive.taskCount', { count: filtered.length })}</span>
      </div>

      <div className="ArchiveList__Table">
        {filtered.map((task) => {
          const typeConfig = (taskTypes || []).find((t) => t.type_key === task.task_type);
          const mainAssignee = (task.assignees || []).find((a) => a.role === 'main');
          return (
            <div
              key={task.task_id}
              className="ArchiveList__Row"
              onClick={() => onSelectTask(task)}
            >
              <span className="ArchiveList__TypeIcon">
                <TaskTypeIcon
                  name={typeConfig?.icon || 'CheckSquare'}
                  size={14}
                  color={typeConfig?.color || '#5E6AD2'}
                />
              </span>
              <span className="ArchiveList__Id">{task.display_id}</span>
              <span className="ArchiveList__Title">{task.title}</span>
              <div className="ArchiveList__Labels">
                {(task.labels || []).map((label) => {
                  const tint = entityTintStyle(label.color, { alpha: '20' });
                  return (
                    <span
                      key={label.label_id}
                      className={`ArchiveList__Label${tint?.['--et-on'] ? ' EntityTint' : ''}`}
                      style={tint}
                    >
                      {label.label_name}
                    </span>
                  );
                })}
              </div>
              {task.sprint_name && (
                <span className="ArchiveList__Sprint">{task.sprint_name}</span>
              )}
              <span className="ArchiveList__Date">{formatDate(task.updated_at || task.created_at)}</span>
              {mainAssignee && (
                <Avatar user={mainAssignee} size={22} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
