import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { axios } from '@/library/_axios';

const STATUS_COLORS = {
  todo: '#9CA3AF',
  in_progress: '#2563EB',
  done: '#16A34A',
};

export default function TaskDependencySection({ branchId, taskId, onSelectTask }) {
  const { t } = useTranslation();
  const [deps, setDeps] = useState([]);

  useEffect(() => {
    if (!branchId || !taskId) return;
    const fetchDeps = async () => {
      try {
        const res = await axios.get(`/branches/${branchId}/dependencies/task/${taskId}`);
        if (res.data.status) setDeps(res.data.dependencies);
      } catch {}
    };
    fetchDeps();
  }, [branchId, taskId]);

  if (deps.length === 0) return null;

  const getArrow = (dep) => {
    if (dep.dep_type === 'relates_to') return '--';
    return dep.direction === 'outgoing' ? '->' : '<-';
  };

  return (
    <div className="TaskDependencySection">
      <div className="TaskDependencySection__Title">{t('branchTasks.dependencies.title')}</div>
      <div className="TaskDependencySection__List">
        {deps.map((dep) => (
          <button
            key={dep.dependency_id}
            className="TaskDependencySection__Item"
            onClick={() => onSelectTask?.({ task_id: dep.task_id, title: dep.title })}
          >
            <span className="TaskDependencySection__Arrow">{getArrow(dep)}</span>
            <span className="TaskDependencySection__DisplayId">{dep.display_id}</span>
            <span className="TaskDependencySection__TaskTitle">{dep.title}</span>
            <span
              className="TaskDependencySection__StatusDot"
              style={{ backgroundColor: STATUS_COLORS[dep.status] || '#9CA3AF' }}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
