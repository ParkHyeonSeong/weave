// @vitest-environment jsdom
// 실제 보드의 이전/다음 버튼과 요일 선택을 누른다. 서버·협업 연결과 본문 편집기만 대체한다.
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import * as Y from 'yjs';

const env = vi.hoisted(() => ({ today: '2026-11-10', get: vi.fn(), collab: vi.fn() }));
vi.mock('next/router', () => ({ useRouter: () => ({ isReady: true, query: { boardId: '1' } }) }));
vi.mock('react-i18next', async (original) => {
  const t = (key) => key;
  return { ...(await original()), useTranslation: () => ({ t }) };
});
vi.mock('@/library/_axios', () => ({ axios: { get: env.get } }));
vi.mock('@/library/workspaceSettings', () => ({ useWorkspaceSettings: () => ({ status: 'success' }) }));
vi.mock('@/hooks/useDateFormat', () => {
  const value = { today: () => env.today, formatDateOnly: (d) => d, formatDateOnlyRange: (a, b) => `${a} – ${b}` };
  return { useWorkspaceDateFormat: () => value };
});
vi.mock('@/library/useScrumWeekCollab', () => ({ default: env.collab }));
vi.mock('@/library/useCollabSynced', () => ({ default: () => true }));
vi.mock('@/components/Scrum/ScrumDayView', () => ({ default: () => null }));
vi.mock('@/components/Scrum/ScrumWeekGrid', () => ({ default: () => null }));
vi.mock('@/components/Scrum/RetroView', () => ({ default: () => null }));
vi.mock('@/components/Scrum/ScrumMembersModal', () => ({ default: () => null }));
vi.mock('@/components/Scrum/ScrumPresence', () => ({ default: () => null }));
vi.mock('@/components/shared/CollabStatusBadge', () => ({ default: () => null }));
vi.mock('@/components/shared/RefPanelHost', () => {
  const set = () => {};
  return { default: () => null, useRefPreview: () => [null, set] };
});
vi.mock('@/components/common/DatePicker', () => ({ default: ({ trigger }) => trigger }));
vi.mock('@/components/common/NavLink', () => ({ default: ({ children }) => <span>{children}</span> }));
import ScrumBoardView from '@/components/Scrum/ScrumBoardView';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root, node, doc;
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const click = async (label) => {
  act(() => node.querySelector(`[aria-label="${label}"]`).click());
  await settle();
};
const selectedDate = () => node.querySelector('.ScrumDaySelector__Day[aria-pressed="true"] .ScrumDaySelector__Date')?.textContent;
beforeEach(() => {
  env.today = '2026-11-10';
  sessionStorage.setItem('profile', JSON.stringify({ user_id: 7, username: 'Me' }));
  doc = new Y.Doc();
  env.collab.mockReset().mockReturnValue({ ydoc: doc, connectedUsers: [] });
  env.get.mockReset().mockImplementation(async (url) => ({ data: url === '/scrum/1'
    ? { status: true, board: { name: 'Test', members: [{ user_id: 7, username: 'Me' }] } }
    : { status: true, week: { week_id: Number(url.split('/').at(-1)) } } }));
  node = document.createElement('div');
  document.body.appendChild(node);
  root = createRoot(node);
});
afterEach(() => { act(() => root.unmount()); doc.destroy(); node.remove(); sessionStorage.clear(); });

it('월요일에서 이전 주는 금요일, 다음 주로 돌아오면 월요일을 고른다', async () => {
  act(() => root.render(<ScrumBoardView />));
  await settle();
  expect(selectedDate()).toBe('2026-11-10');
  act(() => node.querySelectorAll('.ScrumDaySelector__Day')[0].click());
  await click('scrum.board.prevWeek');
  expect(selectedDate()).toBe('2026-11-06');
  await click('scrum.board.nextWeek');
  expect(selectedDate()).toBe('2026-11-09');
});

it('연도를 넘는 이전/다음 이동과 오늘로가 각각 올바른 날짜를 고른다', async () => {
  env.today = '2027-01-04';
  act(() => root.render(<ScrumBoardView />));
  await settle();
  await click('scrum.board.prevWeek');
  expect(selectedDate()).toBe('2027-01-01');
  await click('scrum.board.nextWeek');
  expect(selectedDate()).toBe('2027-01-04');
  await click('scrum.board.nextWeek');
  expect(selectedDate()).toBe('2027-01-11');
  act(() => node.querySelector('.ScrumBoard__TodayBtn').click());
  await settle();
  expect(selectedDate()).toBe('2027-01-04');
});

it('빠르게 주를 왕복해도 늦게 도착한 이전 주 응답으로 문서가 바뀌지 않는다', async () => {
  const get = env.get.getMockImplementation();
  let resolvePrevious;
  env.get.mockImplementation((url) => url.endsWith('/2026/45')
    ? new Promise((resolve) => { resolvePrevious = resolve; }) : get(url));
  act(() => root.render(<ScrumBoardView />));
  await settle();
  await click('scrum.board.prevWeek');
  await click('scrum.board.nextWeek');
  expect(selectedDate()).toBe('2026-11-09');
  expect(env.collab.mock.lastCall[1]).toBe(46);
  await act(async () => resolvePrevious({ data: { status: true, week: { week_id: 45 } } }));
  expect(env.collab.mock.lastCall[1]).toBe(46);
});
