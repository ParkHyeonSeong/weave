import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUpRight, Circle, ListTodo, X } from 'lucide-react';
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
  const { today, formatDateOnly, formatDateOnlyRange } = useWorkspaceDateFormat();
  const { data, loading, error } = useHomeData('/scrum/home-cards');
  const [dismissed, setDismissed] = useState(() => new Set());
  const date = today();
  const pending = data?.today_pending?.filter(board => !isHidden('scrums', board.board_id)) || [];
  const retro = data?.retro_due?.filter(board => !isHidden('scrums', board.board_id)) || [];
  const actionKey = item => `${item.kind}:${item.board_id}`;
  const actions = [...retro.map(item => ({ ...item, kind: 'retro' })), ...pending.map(item => ({ ...item, kind: 'daily' }))]
    .filter(item => !dismissed.has(actionKey(item)));
  const [primary, ...secondary] = actions;
  const hrefFor = item => `/scrum/${item.board_id}${item.kind === 'retro' ? '?tab=retro' : ''}`;
  const actionLabel = item => t(item.kind === 'retro' ? 'home.scrumCards.writeRetro' : 'home.scrumCards.writeNow');
  const actionText = item => <span className="HomeScrum__ActionText">
    <span className="HomeScrum__ActionName" title={item.name}>{item.name}</span>
    {item.kind === 'retro' && (item.period_start || item.period_end) && <span className="HomeScrum__Period">{formatDateOnlyRange(item.period_start, item.period_end)}</span>}
    <span className="HomeScrum__ActionLabel">{actionLabel(item)}</span>
  </span>;
  const dismissButton = item => <button type="button" className="HomeScrum__Dismiss"
    aria-label={t('home.scrumCards.dismiss', { name: item.name, action: actionLabel(item) })}
    title={t('common.actions.close')}
    onClick={() => setDismissed(current => new Set([...current, actionKey(item)]))}><X size={13} /></button>;
  return <div className="Widget HomeScrum">
    <div className="HomeScrum__Header">
      <div className="HomeScrum__Date"><span className="HomeScrum__Day">{date ? Number(date.slice(-2)) : '—'}</span><span className="HomeScrum__Weekday">{date ? formatDateOnly(date, { weekday: 'long' }) : '—'}</span></div>
      <div className="HomeScrum__Title">{t('home.canvas.todayScrum')}</div>
    </div>
    <div className="Widget__Body HomeScrum__List" tabIndex={0} role="region" aria-label={t('home.canvas.todayScrum')}>
      {loading || error || !primary ? <div className="Widget__Empty">{t(loading ? 'common.state.loading' : error ? 'home.canvas.dataFailed' : 'home.canvas.scrumClear')}</div> : secondary.map(item => <div key={actionKey(item)} className="HomeScrum__Reminder">
        <NavLink href={hrefFor(item)} className="HomeScrum__ReminderLink">{actionText(item)}</NavLink>{dismissButton(item)}
      </div>)}
    </div>
    <div className="HomeScrum__Primary">
      <NavLink href={primary ? hrefFor(primary) : '/scrum'} className="HomeScrum__Action">
        {primary ? actionText(primary) : <span>{t('home.canvas.openScrum')}</span>}{!primary && <ArrowUpRight size={14} />}
      </NavLink>{primary && dismissButton(primary)}
    </div>
  </div>;
}

function TasksWidget() {
  const { t } = useTranslation();
  const { isHidden } = useUiPrefs();
  const { formatDateOnlyShort, isOverdue } = useDateFormat();
  const { data, loading, error } = useHomeData('/my-tasks');
  const visibleTasks = (data?.tasks || []).filter(task => !isHidden('branches', task.branch_id));
  const counts = { todo: 0, in_progress: 0, done: 0, cancelled: 0 };
  visibleTasks.forEach(task => {
    const category = task.status_category || task.status;
    counts[Object.hasOwn(counts, category) ? category : 'todo']++;
  });
  const tasks = visibleTasks.filter(task => !['done', 'cancelled'].includes(task.status_category || task.status))
    .sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'));
  const categories = [['todo', 'todo'], ['in_progress', 'inProgress'], ['done', 'done'], ['cancelled', 'cancelled']];
  return <div className="Widget HomeTasks">
    <div className="Widget__Header"><ListTodo size={16} /><span className="Widget__Title">{t('home.canvas.myTasks')}</span><NavLink href="/my-tasks" className="HomeWidget__All" aria-label={t('home.canvas.open', { name: t('home.canvas.myTasks') })}><ArrowUpRight size={16} /></NavLink></div>
    <div className="HomeTasks__Overview">
      <div className="HomeTasks__Summary"><b>{loading || error ? '—' : tasks.length}</b><span>{t('home.canvas.tasksLeft', { count: tasks.length })}</span></div>
      <div className="HomeTasks__Stats">{categories.map(([category, labelKey]) => {
        const label = t(`home.widgets.myTasks.${labelKey}`), count = loading || error ? '—' : counts[category];
        return <NavLink key={category} href="/my-tasks" className="HomeTasks__Stat" aria-label={`${label}: ${count}`}><b>{count}</b><span>{label}</span></NavLink>;
      })}</div>
    </div>
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
