// @vitest-environment jsdom
//
// 라벨 이름·색을 바꾸면 useTaskDetail.updateLabel이 task:updated를 보낸다. 목록·보드는 그 이벤트로
// 행·카드만 다시 받고, 필터 옵션·필터 칩·「라벨로 묶기」 머리가 쓰는 라벨 목록은 브랜치를 바꿀 때만 받아
// 옛 이름이 남았다. 이제 같은 이벤트에서 라벨 목록도 다시 받는다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('@/library/_axios', () => ({ axios: { get: vi.fn(), post: vi.fn(), patch: vi.fn() }, getBaseURL: () => '' }));
vi.mock('next/router', () => ({ useRouter: () => ({ push: vi.fn(), query: {} }) }));
import { axios } from '@/library/_axios';
import BoardView from '@/components/Branch/Board/BoardView';
import TaskList from '@/components/Branch/Tasks/TaskList';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const BRANCH = 5;
const WORKFLOW = [
  { key: 'todo', label: 'To Do', color: '#9CA3AF', category: 'todo' },
  { key: 'done', label: 'Done', color: '#16A34A', category: 'done' },
];
let labelName;
const label = () => ({ label_id: 9, label_name: labelName, color: '#0D9488' });
const card = () => ({
  task_id: 1, display_id: 'QA-1', title: '태스크 1', status: 'todo', priority: 'medium',
  epic_id: null, due_date: null, created_at: '2026-09-01T00:00:00+00:00',
  labels: [label()], assignees: [], subtasks: [], subtask_progress: { done: 0, total: 0 },
});
const ok = (data) => Promise.resolve({ data: { status: true, ...data } });

let root;
let container;
const flush = async () => {
  for (let i = 0; i < 4; i += 1) await new Promise((r) => { setTimeout(r, 0); });
};
const labelGets = () => axios.get.mock.calls.filter(([url]) => url === `/branches/${BRANCH}/labels`).length;
const renameAndBroadcast = async (name) => {
  labelName = name;
  await act(async () => {
    window.dispatchEvent(new CustomEvent('task:updated', { detail: { origin: {} } }));
    await flush();
  });
};

beforeEach(() => {
  localStorage.clear();
  labelName = 'UX 개선';
  axios.get.mockImplementation((url) => {
    if (url === `/branches/${BRANCH}/sprints`) return ok({ sprints: [{ sprint_id: 1, sprint_name: 'S1', status: 'active', end_date: null }] });
    if (url === `/branches/${BRANCH}/tasks/board`) return ok({ columns: { todo: [card()], done: [] } });
    if (url === `/branches/${BRANCH}/tasks`) return ok({ tasks: [card()] });
    if (url === `/branches/${BRANCH}/labels`) return ok({ labels: [label()] });
    if (url === `/branches/${BRANCH}/members`) return ok({ members: [] });
    if (url === `/branches/${BRANCH}/epics`) return ok({ epics: [] });
    if (url === '/saved-views') return ok({ views: [] });
    return Promise.resolve({ data: { status: false } });
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  document.body.replaceChildren();
  vi.clearAllMocks();
});

describe('라벨 변경 뒤 같은 브랜치 화면의 라벨 목록 동기화', () => {
  it('보드: 「라벨로 묶기」 머리가 task:updated 뒤 새 이름이 된다', async () => {
    localStorage.setItem(`weave_board_${BRANCH}_filters`, JSON.stringify({ groupBy: 'label' }));
    await act(async () => {
      root.render(<BoardView branchId={BRANCH} branchKey="QA" taskTypes={[]} workflowStatuses={WORKFLOW} onSelectTask={vi.fn()} />);
      await flush();
    });
    const lane = () => [...container.querySelectorAll('.BoardView__SwimlaneLabel')].map((el) => el.textContent);
    expect(lane()).toContain('UX 개선');
    await renameAndBroadcast('사용성 개선');
    expect(lane()).toContain('사용성 개선');
    expect(lane()).not.toContain('UX 개선');
  });

  it('목록: task:updated 때 행과 함께 라벨 목록을 다시 받는다', async () => {
    await act(async () => {
      root.render(<TaskList branchId={BRANCH} branchKey="QA" taskTypes={[]} workflowStatuses={WORKFLOW} onSelectTask={vi.fn()} />);
      await flush();
    });
    const before = labelGets();
    await renameAndBroadcast('사용성 개선');
    expect(labelGets()).toBe(before + 1);
  });
});
