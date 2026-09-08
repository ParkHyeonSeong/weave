import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { axios } from '@/library/_axios';
import { Circle, Loader, CheckCircle2, XCircle, ListTodo } from 'lucide-react';
import NavLink from '@/components/common/NavLink';

export default function TaskSummary() {
  const { t } = useTranslation();
  const [counts, setCounts] = useState({ todo: 0, in_progress: 0, done: 0, cancelled: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTasks();
  }, []);

  const fetchTasks = async () => {
    try {
      const res = await axios.get('/my-tasks');
      if (res.data.status) {
        const tasks = res.data.tasks;
        // category 기반 집계: task에 status_category가 있으면 사용, 없으면 status 기반 fallback
        const catCounts = { todo: 0, in_progress: 0, done: 0, cancelled: 0 };
        tasks.forEach((t) => {
          const cat = t.status_category || t.status;
          if (cat === 'done') catCounts.done++;
          else if (cat === 'cancelled') catCounts.cancelled++;
          else if (cat === 'in_progress') catCounts.in_progress++;
          else catCounts.todo++;
        });
        setCounts(catCounts);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  };



  if (loading) {
    return (
      <div className="Widget">
        <div className="Widget__Header">
          <ListTodo size={16} />
          <span className="Widget__Title">{t('home.widgets.myTasks.title')}</span>
        </div>
        <div className="Widget__Body">
          <div className="Widget__Empty">{t('common.state.loading')}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="Widget">
      <div className="Widget__Header">
        <ListTodo size={16} />
        <span className="Widget__Title">{t('home.widgets.myTasks.title')}</span>
      </div>
      <div className="Widget__Body">
        <div className="TaskSummary__Stats">
          <NavLink href="/my-tasks" className="TaskSummary__Stat">
            <Circle size={18} color="var(--color-text-secondary)" />
            <span className="TaskSummary__StatCount">{counts.todo}</span>
            <span className="TaskSummary__StatLabel">{t('home.widgets.myTasks.todo')}</span>
          </NavLink>
          <NavLink href="/my-tasks" className="TaskSummary__Stat">
            <Loader size={18} color="var(--color-status-in-progress)" />
            <span className="TaskSummary__StatCount">{counts.in_progress}</span>
            <span className="TaskSummary__StatLabel">{t('home.widgets.myTasks.inProgress')}</span>
          </NavLink>
          <NavLink href="/my-tasks" className="TaskSummary__Stat">
            <CheckCircle2 size={18} color="var(--color-success)" />
            <span className="TaskSummary__StatCount">{counts.done}</span>
            <span className="TaskSummary__StatLabel">{t('home.widgets.myTasks.done')}</span>
          </NavLink>
          <NavLink href="/my-tasks" className="TaskSummary__Stat">
            <XCircle size={18} color="var(--color-error)" />
            <span className="TaskSummary__StatCount">{counts.cancelled}</span>
            <span className="TaskSummary__StatLabel">{t('home.widgets.myTasks.cancelled')}</span>
          </NavLink>
        </div>
      </div>
    </div>
  );
}
