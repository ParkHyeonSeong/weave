// @vitest-environment jsdom
//
// 보드 필터에서 에픽을 고르면 그 에픽의 카드까지 전부 사라지던 회귀.
// 원인은 보드 조회가 epic_id를 빼던 백엔드다(backend/tests/test_board_payload.py가 페이로드를
// 고정한다). 여기서는 그 페이로드 모양으로 에픽 필터 → 남는 카드 → 카드의 에픽 칩까지 화면 경로를 본다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('@/library/_axios', () => ({ axios: { get: vi.fn(), patch: vi.fn() }, getBaseURL: () => '' }));
vi.mock('next/router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
import { axios } from '@/library/_axios';
import BoardView from '@/components/Branch/Board/BoardView';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const BRANCH = 5;
const WORKFLOW = [
  { key: 'todo', label: 'To Do', color: '#9CA3AF', category: 'todo' },
  { key: 'done', label: 'Done', color: '#16A34A', category: 'done' },
];
// find_for_board가 돌려주는 카드 모양 — epic_id·due_date·created_at이 들어 있다
const boardCard = (id, extra) => ({
  task_id: id, display_id: `QA-${id}`, title: `태스크 ${id}`, status: 'todo', priority: 'medium',
  epic_id: null, due_date: null, created_at: '2026-09-01T00:00:00+00:00',
  labels: [], assignees: [], subtasks: [], subtask_progress: { done: 0, total: 0 }, ...extra,
});
const RESPONSES = {
  [`/branches/${BRANCH}/sprints`]: { status: true, sprints: [{ sprint_id: 1, sprint_name: 'S1', status: 'active', end_date: null }] },
  [`/branches/${BRANCH}/tasks/board`]: { status: true, columns: { todo: [boardCard(1, { epic_id: 7 }), boardCard(2)], done: [] } },
  [`/branches/${BRANCH}/members`]: { status: true, members: [] },
  [`/branches/${BRANCH}/epics`]: { status: true, epics: [{ epic_id: 7, epic_name: 'Payments', color: '#16A34A' }] },
  [`/branches/${BRANCH}/labels`]: { status: true, labels: [] },
};

let root;
let container;

const flush = async () => {
  for (let i = 0; i < 4; i += 1) {
    await new Promise((r) => { setTimeout(r, 0); });
  }
};

async function mount() {
  await act(async () => {
    root.render(
      <BoardView branchId={BRANCH} branchKey="QA" taskTypes={[]} workflowStatuses={WORKFLOW} onSelectTask={vi.fn()} />,
    );
    await flush();
  });
}

const cardIds = () => [...container.querySelectorAll('.BoardCard__Id')].map((el) => el.textContent);

beforeEach(() => {
  localStorage.clear();
  axios.get.mockImplementation((url) => Promise.resolve({ data: RESPONSES[url] }));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('BoardView 에픽 필터와 카드의 에픽 칩', () => {
  it('에픽을 고르면 그 에픽의 카드는 남고, 카드에 에픽 이름이 보인다', async () => {
    await mount();
    expect(cardIds()).toEqual(['QA-1', 'QA-2']);

    const epicSelect = [...container.querySelectorAll('.MultiSelect')]
      .find((el) => el.querySelector('.MultiSelect__Label').textContent === 'Epic');
    act(() => { epicSelect.querySelector('.MultiSelect__Trigger').click(); });
    const option = [...epicSelect.querySelectorAll('.MultiSelect__Option')]
      .find((el) => el.textContent.includes('Payments'));
    act(() => { option.click(); });

    expect(cardIds()).toEqual(['QA-1']);
    expect(container.querySelector('.BoardCard__EpicName').textContent).toBe('Payments');
  });

  it('스윔레인으로 묶어도 카드에 에픽 이름이 보인다', async () => {
    localStorage.setItem(`weave_board_${BRANCH}_filters`, JSON.stringify({ groupBy: 'priority' }));
    await mount();
    expect(container.querySelector('.BoardView__Swimlane')).not.toBeNull();
    expect(container.querySelector('.BoardCard__EpicName').textContent).toBe('Payments');
  });
});
