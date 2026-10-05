// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));
const router = vi.hoisted(() => ({ pathname: '/', asPath: '/', push: vi.fn(), query: {} }));
vi.mock('@/library/_axios', () => ({ axios: api }));
vi.mock('next/router', () => ({ useRouter: () => router }));
vi.mock('react-i18next', async importOriginal => ({ ...(await importOriginal()), useTranslation: () => ({
  t: (key, values = {}) => [key, ...Object.values(values)].join(' '),
  i18n: { language: 'en' },
}) }));
import { UiPrefsProvider } from './UiPrefsContext';
import HomeWidgets from '@/components/Home/HomeWidgets';
import ActiveSprints from '@/components/Home/DashboardWidgets/ActiveSprints';
import UnreadMessages from '@/components/Home/DashboardWidgets/UnreadMessages';
import RecentItems from '@/components/Home/DashboardWidgets/RecentItems';
import StarredItems from '@/components/Home/DashboardWidgets/StarredItems';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let container, root, replies, prefs;
const mount = async node => { await act(async () => root.render(<UiPrefsProvider>{node}</UiPrefsProvider>)); };
const mountHome = (id, height = 200) => mount(<div className="HomeCanvas" style={{ height }}><HomeWidgets id={id} /></div>);
const region = label => container.querySelector(`[role="region"][aria-label="${label}"]`);
const expectRegion = label => { expect(region(label)).not.toBeNull(); expect(region(label).tabIndex).toBe(0); };
const dismissButton = (name, action) => [...container.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === `home.scrumCards.dismiss ${name} home.scrumCards.${action}`);
const documents = () => Array.from({ length: 20 }, (_, i) => ({ type: 'doc', page_id: i + 1, canvas_id: 1, canvas_name: 'Canvas', title: `Document ${i + 1}`, viewed_at: '2026-10-04T00:00:00Z' }));
const rooms = () => [...Array.from({ length: 5 }, (_, i) => ({ room_id: i + 1, room_name: `Room ${i + 1}`, unread_count: i + 1 })), { room_id: 6, room_name: 'Read room', unread_count: 0 }];
const seedSprints = () => {
  replies['/branches'] = { branches: [{ branch_id: 1, branch_name: 'Branch', key: 'B' }] };
  replies['/branches/1/sprints'] = { sprints: Array.from({ length: 3 }, (_, i) => ({ sprint_id: i + 1, sprint_name: `Sprint ${i + 1}`, status: 'active' })) };
  for (let id = 1; id <= 3; id++) replies[`/branches/1/sprints/${id}/task-counts`] = { all_done_count: 1, all_total_count: 5, all_in_progress_count: 1, all_cancelled_count: 0, my_count: 1, my_incomplete_count: 1 };
};

beforeEach(() => {
  prefs = {}; replies = {};
  api.get.mockImplementation(async path => ({ data: { status: true, ...(path === '/profile/ui-prefs' ? { ui_prefs: prefs } : replies[path] || { items: [], tasks: [], branches: [], rooms: [], today_pending: [], retro_due: [] }) } }));
  router.push.mockReset().mockResolvedValue(true);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.clearAllMocks(); });

describe('home widget scroll contents', () => {
  it('counts visible tasks by category with legacy status fallbacks and keeps only unfinished rows', async () => {
    prefs = { hidden: { branches: [2] } };
    replies['/my-tasks'] = { tasks: [
      { task_id: 1, branch_id: 1, title: 'Legacy todo', status: 'todo' },
      { task_id: 2, branch_id: 1, title: 'Unknown category', status_category: 'custom' },
      { task_id: 3, branch_id: 1, title: 'Custom progress', status: 'done', status_category: 'in_progress' },
      { task_id: 4, branch_id: 1, title: 'Legacy progress', status: 'in_progress' },
      { task_id: 5, branch_id: 1, title: 'Custom done', status: 'todo', status_category: 'done' },
      { task_id: 6, branch_id: 1, title: 'Legacy cancelled', status: 'cancelled' },
      { task_id: 7, branch_id: 1, title: 'Custom cancelled', status: 'todo', status_category: 'cancelled' },
      ...['todo', 'in_progress', 'done', 'cancelled'].map((status, index) => ({ task_id: index + 8, branch_id: 2, title: `Hidden ${status}`, status })),
    ] };
    await mountHome('widget:mytasks');
    const stats = [...container.querySelectorAll('.HomeTasks__Stats a')];
    expect(stats).toHaveLength(4);
    for (const [label, count] of [['todo', 2], ['inProgress', 2], ['done', 1], ['cancelled', 2]]) {
      const stat = stats.find(link => link.textContent.includes(`home.widgets.myTasks.${label}`));
      expect(stat, label).toBeDefined();
      expect(stat.textContent).toContain(String(count));
      expect(stat.getAttribute('href')).toBe('/my-tasks');
    }
    expect(container.querySelector('.HomeTasks__Summary b').textContent).toBe('4');
    expect([...container.querySelectorAll('.HomeTasks__Row')].map(row => row.textContent)).toEqual(['Legacy todo', 'Unknown category', 'Custom progress', 'Legacy progress']);
  });

  it('keeps all 40 unfinished visible tasks and their count at every viewport height', async () => {
    prefs = { hidden: { branches: [2] } };
    replies['/my-tasks'] = { tasks: [
      ...Array.from({ length: 40 }, (_, i) => ({ task_id: i + 1, branch_id: 1, title: `Task ${i + 1}`, status: 'todo', status_category: 'todo', due_date: null })),
      { task_id: 41, branch_id: 1, title: 'Done', status_category: 'done' },
      { task_id: 42, branch_id: 1, title: 'Cancelled', status_category: 'cancelled' },
      { task_id: 43, branch_id: 2, title: 'Hidden', status_category: 'todo' },
    ] };
    await mountHome('widget:mytasks');
    expect(container.querySelectorAll('.HomeTasks__Row')).toHaveLength(40);
    expect(container.querySelector('.HomeTasks__Summary b').textContent).toBe('40');
    expect(container.querySelectorAll('.HomeTasks__Row')[39].getAttribute('href')).toBe('/branch/1/task/40');
    expectRegion('home.canvas.myTasks');
    const body = region('home.canvas.myTasks');
    await mountHome('widget:mytasks', 420);
    await mountHome('widget:mytasks');
    expect(region('home.canvas.myTasks')).toBe(body);
    expect(container.querySelectorAll('.HomeTasks__Row')).toHaveLength(40);
    expect(api.get.mock.calls.filter(([path]) => path === '/my-tasks')).toHaveLength(1);
  });

  it.each([
    ['widget:recent', '/recent-views', '.RecentItems__Item', 'home.canvas.continue'],
    ['widget:starred', '/stars', '.StarredItems__Item', 'home.widgets.starred.title'],
  ])('renders every fetched item in %s without raising its request limit', async (id, path, selector, label) => {
    replies[path] = { items: documents() };
    await mountHome(id);
    expect(container.querySelectorAll(selector)).toHaveLength(20);
    expect(container.querySelectorAll(selector)[19].getAttribute('href')).toBe('/canvas/1/20');
    expectRegion(label);
    const body = region(label);
    await mountHome(id, 640);
    await mountHome(id);
    expect(region(label)).toBe(body);
    expect(container.querySelectorAll(selector)).toHaveLength(20);
    expect(api.get.mock.calls.filter(([url]) => url === path)).toEqual([[path, { params: { limit: 20 } }]]);
  });

  it('shows three compact sprint cards in home and retains their navigation', async () => {
    seedSprints();
    await mountHome('widget:sprints');
    expect(container.querySelectorAll('.ActiveSprints__Item')).toHaveLength(3);
    expect(container.querySelectorAll('.ActiveSprints__Item')[2].getAttribute('href')).toBe('/branch/1?tab=board&sprint=3');
    expectRegion('home.widgets.activeSprints.title');
  });

  it('includes personal task counts and zero remaining tasks on home sprint cards', async () => {
    seedSprints();
    replies['/branches/1/sprints/1/task-counts'].my_count = 3;
    replies['/branches/1/sprints/1/task-counts'].my_incomplete_count = 0;
    replies['/branches/1/sprints/3/task-counts'].my_count = 0;
    replies['/branches/1/sprints/3/task-counts'].my_incomplete_count = 0;
    await mountHome('widget:sprints');
    const cards = [...container.querySelectorAll('.ActiveSprints__Item')];
    const completed = cards.find(card => card.getAttribute('href') === '/branch/1?tab=board&sprint=1');
    expect(completed.textContent).toContain('home.widgets.activeSprints.myTasks 3');
    expect(completed.textContent).toContain('home.widgets.activeSprints.myTasksLeft 0');
    const unassigned = cards.find(card => card.getAttribute('href') === '/branch/1?tab=board&sprint=3');
    expect(unassigned.textContent).not.toContain('home.widgets.activeSprints.myTasks');
  });

  it('pins the total outside the five unread rooms and opens the last room', async () => {
    replies['/chat'] = { rooms: rooms() };
    await mountHome('widget:messages');
    expect(container.querySelectorAll('.UnreadMessages__Room')).toHaveLength(5);
    expect(container.querySelectorAll('.UnreadMessages__Total')).toHaveLength(1);
    expect(container.querySelector('.UnreadMessages__Total').textContent).toBe('15');
    expect(container.querySelector('.Widget__Body .UnreadMessages__Total')).toBeNull();
    expectRegion('home.widgets.messages.title');
    let openedRoom;
    const onOpen = event => { openedRoom = event.detail; };
    window.addEventListener('layout:open-chat-room', onOpen);
    try {
      await act(async () => container.querySelectorAll('.UnreadMessages__Room')[4].click());
      expect(openedRoom).toBe(5);
    } finally { window.removeEventListener('layout:open-chat-room', onOpen); }
  });

  it('exposes each Scrum action once with one fixed primary footer', async () => {
    replies['/scrum/home-cards'] = {
      retro_due: [{ board_id: 1, name: 'Same board' }, { board_id: 2, name: 'Retro board' }],
      today_pending: [{ board_id: 1, name: 'Same board' }, { board_id: 3, name: 'Daily board 3' }, { board_id: 4, name: 'Daily board 4' }],
    };
    await mountHome('widget:scrum');
    expect(container.querySelector('.HomeScrum__Header')).not.toBeNull();
    expect(container.querySelectorAll('.HomeScrum__Action')).toHaveLength(1);
    const primary = container.querySelector('.HomeScrum__Action');
    expect(primary.getAttribute('href')).toBe('/scrum/1?tab=retro');
    expect(primary.textContent).toContain('Same board');
    const links = [...container.querySelectorAll('a')];
    expect(links.map(link => link.getAttribute('href'))).toEqual(['/scrum/2?tab=retro', '/scrum/1', '/scrum/3', '/scrum/4', '/scrum/1?tab=retro']);
    expect(container.querySelector('.Widget__Body .HomeScrum__Action')).toBeNull();
    expectRegion('home.canvas.todayScrum');
  });

  it('keeps Scrum empty state and the general entry link', async () => {
    await mountHome('widget:scrum');
    expect(container.querySelector('.Widget__Body').textContent).toContain('home.canvas.scrumClear');
    expect(container.querySelector('.HomeScrum__Action').getAttribute('href')).toBe('/scrum');
  });

  it('shows the retrospective period on both primary and secondary actions', async () => {
    replies['/scrum/home-cards'] = {
      retro_due: [
        { board_id: 1, name: 'Primary retro', period_start: '2026-09-21', period_end: '2026-09-27' },
        { board_id: 2, name: 'Secondary retro', period_start: '2026-09-28', period_end: '2026-10-04' },
      ],
      today_pending: [],
    };
    await mountHome('widget:scrum');
    expect(container.querySelector('a[href="/scrum/1?tab=retro"]').textContent).toContain('Sep 21 – Sep 27');
    expect(container.querySelector('a[href="/scrum/2?tab=retro"]').textContent).toContain('Sep 28 – Oct 4');
  });

  it('dismisses a primary retro independently from the same board daily action and resets on remount', async () => {
    replies['/scrum/home-cards'] = {
      retro_due: [{ board_id: 1, name: 'Same board', period_start: '2026-09-28', period_end: '2026-10-04' }],
      today_pending: [{ board_id: 1, name: 'Same board' }],
    };
    await mountHome('widget:scrum');
    const retroDismiss = dismissButton('Same board', 'writeRetro');
    expect(retroDismiss).toBeDefined();
    await act(async () => retroDismiss.click());
    expect(container.querySelector('a[href="/scrum/1?tab=retro"]')).toBeNull();
    expect(container.querySelector('.HomeScrum__Action').getAttribute('href')).toBe('/scrum/1');
    const dailyDismiss = dismissButton('Same board', 'writeNow');
    expect(dailyDismiss).toBeDefined();
    await act(async () => dailyDismiss.click());
    expect(container.querySelector('.Widget__Body').textContent).toContain('home.canvas.scrumClear');
    expect(container.querySelector('.HomeScrum__Action').getAttribute('href')).toBe('/scrum');
    expect(router.push).not.toHaveBeenCalled();
    for (const method of ['patch', 'post', 'put', 'delete']) expect(api[method]).not.toHaveBeenCalled();
    await mount(null);
    await mountHome('widget:scrum');
    expect(container.querySelector('.HomeScrum__Action').getAttribute('href')).toBe('/scrum/1?tab=retro');
    expect(dismissButton('Same board', 'writeNow')).toBeDefined();
  });

  it('dismisses a secondary daily action without navigating or removing that board retro', async () => {
    replies['/scrum/home-cards'] = {
      retro_due: [{ board_id: 1, name: 'Same board', period_start: '2026-09-28', period_end: '2026-10-04' }],
      today_pending: [{ board_id: 1, name: 'Same board' }, { board_id: 2, name: 'Other board' }],
    };
    await mountHome('widget:scrum');
    const dailyDismiss = dismissButton('Same board', 'writeNow');
    expect(dailyDismiss).toBeDefined();
    await act(async () => dailyDismiss.click());
    expect(container.querySelector('a[href="/scrum/1"]')).toBeNull();
    expect(container.querySelector('a[href="/scrum/2"]')).not.toBeNull();
    expect(container.querySelector('.HomeScrum__Action').getAttribute('href')).toBe('/scrum/1?tab=retro');
    expect(router.push).not.toHaveBeenCalled();
    for (const method of ['patch', 'post', 'put', 'delete']) expect(api[method]).not.toHaveBeenCalled();
  });
});

describe('shared widget default callers', () => {
  it.each([
    [RecentItems, '/recent-views', '.RecentItems__Item'],
    [StarredItems, '/stars', '.StarredItems__Item'],
  ])('retains an explicit item limit outside home', async (Component, path, selector) => {
    replies[path] = { items: documents() };
    await mount(<Component maxItems={2} />);
    expect(container.querySelectorAll(selector)).toHaveLength(2);
    expect(container.querySelector('[role="region"]')).toBeNull();
  });

  it('retains the compact default of one sprint outside home', async () => {
    seedSprints();
    await mount(<ActiveSprints compact />);
    expect(container.querySelectorAll('.ActiveSprints__Item')).toHaveLength(1);
    expect(container.querySelector('[role="region"]')).toBeNull();
  });

  it('retains the unread summary in the body and explicit room limit outside home', async () => {
    replies['/chat'] = { rooms: rooms() };
    await mount(<UnreadMessages maxItems={2} />);
    expect(container.querySelector('.Widget__Body .UnreadMessages__Total').textContent).toBe('15');
    expect(container.querySelectorAll('.UnreadMessages__Room')).toHaveLength(2);
    expect(container.querySelector('[role="region"]')).toBeNull();
  });
});
