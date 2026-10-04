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

function ScrumWidget() {
  const { t } = useTranslation();
  const { isHidden } = useUiPrefs();
  const { today, formatDateOnly } = useWorkspaceDateFormat();
  const { data, loading, error } = useHomeData('/scrum/home-cards');
  const date = today();
  const pending = data?.today_pending?.filter(board => !isHidden('scrums', board.board_id)) || [];
  const retro = data?.retro_due?.filter(board => !isHidden('scrums', board.board_id)) || [];
  const actions = [...retro.map(item => ({ ...item, kind: 'retro' })), ...pending.map(item => ({ ...item, kind: 'daily' }))];
  const [primary, ...secondary] = actions;
  const hrefFor = item => `/scrum/${item.board_id}${item.kind === 'retro' ? '?tab=retro' : ''}`;
  const actionLabel = item => t(item.kind === 'retro' ? 'home.scrumCards.writeRetro' : 'home.scrumCards.writeNow');
  return <div className="Widget HomeScrum">
    <div className="HomeScrum__Header">
      <div className="HomeScrum__Date"><span className="HomeScrum__Day">{date ? Number(date.slice(-2)) : '—'}</span><span className="HomeScrum__Weekday">{date ? formatDateOnly(date, { weekday: 'long' }) : '—'}</span></div>
      <div className="HomeScrum__Title">{t('home.canvas.todayScrum')}</div>
    </div>
    <div className="Widget__Body HomeScrum__List" tabIndex={0} role="region" aria-label={t('home.canvas.todayScrum')}>
      {loading || error || !primary ? <div className="Widget__Empty">{t(loading ? 'common.state.loading' : error ? 'home.canvas.dataFailed' : 'home.canvas.scrumClear')}</div> : secondary.map(item => <NavLink key={`${item.board_id}:${item.kind}`} href={hrefFor(item)}><span>{item.name}</span><small>{actionLabel(item)}</small></NavLink>)}
    </div>
    <NavLink href={primary ? hrefFor(primary) : '/scrum'} className="HomeScrum__Action">
      <span className="HomeScrum__ActionText">{primary && <span className="HomeScrum__ActionName">{primary.name}</span>}<span>{primary ? actionLabel(primary) : t('home.canvas.openScrum')}</span></span><ArrowUpRight size={14} />
    </NavLink>
  </div>;
}

function TasksWidget() {
  const { t } = useTranslation();
  const { isHidden } = useUiPrefs();
  const { formatDateOnlyShort, isOverdue } = useDateFormat();
  const { data, loading, error } = useHomeData('/my-tasks');
  const tasks = (data?.tasks || []).filter(task => !isHidden('branches', task.branch_id) && !['done', 'cancelled'].includes(task.status_category || task.status))
    .sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'));
  return <div className="Widget HomeTasks">
    <div className="Widget__Header"><ListTodo size={16} /><span className="Widget__Title">{t('home.canvas.myTasks')}</span><NavLink href="/my-tasks" className="HomeWidget__All" aria-label={t('home.canvas.open', { name: t('home.canvas.myTasks') })}><ArrowUpRight size={16} /></NavLink></div>
    <div className="HomeTasks__Summary"><b>{loading || error ? '—' : tasks.length}</b><span>{t('home.canvas.tasksLeft', { count: tasks.length })}</span></div>
    <div className="Widget__Body" tabIndex={0} role="region" aria-label={t('home.canvas.myTasks')}>
      {loading || error || !tasks.length ? <div className="Widget__Empty">{t(loading ? 'common.state.loading' : error ? 'home.canvas.dataFailed' : 'home.canvas.noTasks')}</div> : tasks.map(task => <NavLink key={task.task_id} href={`/branch/${task.branch_id}/task/${task.task_id}`} className="HomeTasks__Row">
        <Circle size={13} style={{ color: task.status_color || undefined }} /><span>{task.title}</span>{task.due_date && <small className={isOverdue(task.due_date, task.status_category || task.status) ? 'HomeTasks__Due--overdue' : ''}>{formatDateOnlyShort(task.due_date)}</small>}
      </NavLink>)}
    </div>
  </div>;
}

export default function HomeWidgets({ id }) {
  const { t } = useTranslation();
  switch (id) {
    case 'widget:scrum': return <ScrumWidget />;
    case 'widget:mytasks': return <TasksWidget />;
    case 'widget:recent': return <RecentItems scrollable title={t('home.canvas.continue')} />;
    case 'widget:starred': return <StarredItems scrollable />;
    case 'widget:sprints': return <ActiveSprints compact scrollable />;
    case 'widget:messages': return <UnreadMessages scrollable />;
    default: return null;
  }
}
