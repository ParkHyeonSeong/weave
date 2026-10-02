import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUpRight, Circle, ListTodo } from 'lucide-react';
import { axios } from '@/library/_axios';
import { useUiPrefs } from '@/library/UiPrefsContext';
import { useDateFormat, useWorkspaceDateFormat } from '@/hooks/useDateFormat';
import NavLink from '@/components/common/NavLink';
import RecentItems from './DashboardWidgets/RecentItems';
import StarredItems from './DashboardWidgets/StarredItems';
import ActiveSprints from './DashboardWidgets/ActiveSprints';
import UnreadMessages from './DashboardWidgets/UnreadMessages';

function useHomeData(path) {
  const [state, setState] = useState({ data: null, loading: true, error: false });
  useEffect(() => {
    let alive = true;
    axios.get(path).then(response => {
      if (!response.data.status) throw new Error('Unavailable');
      if (alive) setState({ data: response.data, loading: false, error: false });
    }).catch(() => { if (alive) setState({ data: null, loading: false, error: true }); });
    return () => { alive = false; };
  }, [path]);
  return state;
}

function ScrumWidget({ height }) {
  const { t } = useTranslation();
  const { isHidden } = useUiPrefs();
  const { today, formatDateOnly } = useWorkspaceDateFormat();
  const { data, loading, error } = useHomeData('/scrum/home-cards');
  const date = today();
  const pending = data?.today_pending?.filter(board => !isHidden('scrums', board.board_id)) || [];
  const retro = data?.retro_due?.filter(board => !isHidden('scrums', board.board_id)) || [];
  const board = retro[0] || pending[0];
  const href = board ? `/scrum/${board.board_id}${retro.length ? '?tab=retro' : ''}` : '/scrum';
  const more = [...retro.map(item => ({ ...item, retro: true })), ...pending.map(item => ({ ...item, retro: false }))].slice(1, 1 + Math.max(0, Math.floor((height - 230) / 40)));
  return <div className="Widget HomeScrum">
    <div className="HomeScrum__Weekday">{date ? formatDateOnly(date, { weekday: 'long' }) : t('home.canvas.todayScrum')}</div>
    <div className="HomeScrum__Day">{date ? Number(date.slice(-2)) : '—'}</div>
    <div className="HomeScrum__Title">{t('home.canvas.todayScrum')}</div>
    <p className="HomeScrum__Board">{loading ? t('common.state.loading') : error ? t('home.canvas.dataFailed') : board?.name || t('home.canvas.scrumClear')}</p>
    {more.length > 0 && <div className="HomeScrum__More">{more.map(item => <NavLink key={`${item.board_id}-${item.retro}`} href={`/scrum/${item.board_id}${item.retro ? '?tab=retro' : ''}`}><span>{item.name}</span><small>{t(item.retro ? 'home.scrumCards.writeRetro' : 'home.scrumCards.writeNow')}</small></NavLink>)}</div>}
    <NavLink href={href} className="HomeScrum__Action">{board ? t(retro.length ? 'home.scrumCards.writeRetro' : 'home.scrumCards.writeNow') : t('home.canvas.openScrum')}<ArrowUpRight size={14} /></NavLink>
  </div>;
}

function TasksWidget({ maxItems }) {
  const { t } = useTranslation();
  const { isHidden } = useUiPrefs();
  const { formatDateOnlyShort, isOverdue } = useDateFormat();
  const { data, loading, error } = useHomeData('/my-tasks');
  const tasks = (data?.tasks || []).filter(task => !isHidden('branches', task.branch_id) && !['done', 'cancelled'].includes(task.status_category || task.status))
    .sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'));
  return <div className="Widget HomeTasks">
    <div className="Widget__Header"><ListTodo size={16} /><span className="Widget__Title">{t('home.canvas.myTasks')}</span><NavLink href="/my-tasks" className="HomeWidget__All" aria-label={t('home.canvas.open', { name: t('home.canvas.myTasks') })}><ArrowUpRight size={16} /></NavLink></div>
    <div className="HomeTasks__Summary"><b>{loading || error ? '—' : tasks.length}</b><span>{t('home.canvas.tasksLeft', { count: tasks.length })}</span></div>
    <div className="Widget__Body">
      {loading || error || !tasks.length ? <div className="Widget__Empty">{t(loading ? 'common.state.loading' : error ? 'home.canvas.dataFailed' : 'home.canvas.noTasks')}</div> : tasks.slice(0, maxItems).map(task => <NavLink key={task.task_id} href={`/branch/${task.branch_id}/task/${task.task_id}`} className="HomeTasks__Row">
        <Circle size={13} style={{ color: task.status_color || undefined }} /><span>{task.title}</span>{task.due_date && <small className={isOverdue(task.due_date, task.status_category || task.status) ? 'HomeTasks__Due--overdue' : ''}>{formatDateOnlyShort(task.due_date)}</small>}
      </NavLink>)}
    </div>
  </div>;
}

export default function HomeWidgets({ id, height = 210 }) {
  const { t } = useTranslation();
  const capacity = (header, row, minimum) => Math.max(minimum, Math.floor((height - header) / row));
  switch (id) {
    case 'widget:scrum': return <ScrumWidget height={height} />;
    case 'widget:mytasks': return <TasksWidget maxItems={capacity(110, 29, 3)} />;
    case 'widget:recent': return <RecentItems maxItems={capacity(62, 46, 3)} title={t('home.canvas.continue')} />;
    case 'widget:starred': return <StarredItems maxItems={capacity(62, 46, 3)} />;
    case 'widget:sprints': return <ActiveSprints compact maxItems={capacity(62, 148, 1)} />;
    case 'widget:messages': return <UnreadMessages maxItems={capacity(104, 36, 2)} />;
    default: return null;
  }
}
