// @vitest-environment jsdom
//
// 작업 목록 탭 스프린트 헤더의 개수·상태 요약.
// 헤더 숫자에 단위가 없고, 활성 스프린트는 완료 포함 상위 태스크 수·예정 스프린트는 미완료 수·
// 필터 중에는 일치 수로 뜻이 바뀌던 문제를 고친다. 여기서는 TaskList를 그대로 띄워
// (1) 필터 전 집계가 헤더로 가는지 (2) 상태 줄이 활성 스프린트에만 있는지
// (3) 하위 포함 토글이 범례만 바꾸고 섹션을 접지 않는지를 본다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('@/library/_axios', () => ({ axios: { get: vi.fn(), post: vi.fn(), patch: vi.fn() }, getBaseURL: () => '' }));
vi.mock('next/router', () => ({ useRouter: () => ({ push: vi.fn(), query: {} }) }));
import { axios } from '@/library/_axios';
import i18next from '@/library/i18n';
import TaskList from '@/components/Branch/Tasks/TaskList';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const BRANCH = 5;
// key ≠ category인 상태(review·wontfix)를 섞어 category로 묶이는지 본다
const WORKFLOW = [
  { key: 'todo', label: 'To Do', color: '#9CA3AF', category: 'todo' },
  { key: 'review', label: 'Review', color: '#2563EB', category: 'in_progress' },
  { key: 'done', label: 'Done', color: '#16A34A', category: 'done' },
  { key: 'wontfix', label: "Won't fix", color: '#DC2626', category: 'cancelled' },
];
// find_by_branch가 돌려주는 행 모양(하위는 subtasks[]에 붙어 온다)
const row = (id, status, extra) => ({
  task_id: id, display_id: `QA-${id}`, display_number: id, title: `태스크 ${id}`, task_type: 'task', status,
  priority: 'medium', epic_id: null, sprint_id: null, parent_task_id: null, start_date: null, due_date: null,
  sort_order: id, created_at: '2026-09-01T00:00:00+00:00', labels: [], assignees: [], issue_count: 0,
  subtasks: [], subtask_progress: { done: 0, total: 0 }, ...extra,
});
const sub = (id, parentId, status) => row(id, status, { parent_task_id: parentId });
// 활성 S1: 상위 5(완료 2·취소 1·진행 중 1·할 일 1) + 하위 3(완료 2·할 일 1)
const ACTIVE_TASKS = [
  row(1, 'done', { subtasks: [sub(11, 1, 'done')], subtask_progress: { done: 1, total: 1 } }),
  row(2, 'review', { title: '결제 웹훅', subtasks: [sub(21, 2, 'done'), sub(22, 2, 'todo')], subtask_progress: { done: 1, total: 2 } }),
  row(3, 'done'),
  row(4, 'wontfix'),
  row(5, 'todo'),
];
const FUTURE_TASKS = [row(6, 'todo'), row(7, 'todo')];
const BACKLOG_TASKS = [row(8, 'todo')];
const SPRINTS = [
  { sprint_id: 1, sprint_name: 'S1', status: 'active', start_date: '2026-09-21', end_date: '2026-10-04', goal: null },
  { sprint_id: 2, sprint_name: 'S2', status: 'future', start_date: null, end_date: null, goal: null },
];

let activeTasks;
let root;
let container;

const ok = (data) => Promise.resolve({ data: { status: true, ...data } });
const flush = async () => {
  for (let i = 0; i < 6; i += 1) {
    await new Promise((r) => { setTimeout(r, 0); });
  }
};

async function mount(workflowStatuses = WORKFLOW) {
  await act(async () => {
    root.render(
      <TaskList branchId={BRANCH} branchKey="QA" taskTypes={[]} workflowStatuses={workflowStatuses} onSelectTask={vi.fn()} />,
    );
    await flush();
  });
}

const header = (name) => [...container.querySelectorAll('.TaskList__SprintHeader')]
  .find((h) => h.querySelector('.TaskList__SprintName').textContent === name);
const textOf = (el, selector) => el.querySelector(selector)?.textContent ?? null;
const legend = (h) => [...h.querySelectorAll('.TaskList__SprintLegendItem')].map((el) => el.textContent);
const rowIds = (name) => [...header(name).closest('.TaskList__Sprint').querySelectorAll('.TaskListRow__Id')]
  .map((el) => el.textContent);

beforeEach(() => {
  localStorage.clear();
  activeTasks = ACTIVE_TASKS;
  axios.get.mockImplementation((url, config) => {
    if (url === `/branches/${BRANCH}/sprints`) return ok({ sprints: SPRINTS });
    if (url === `/branches/${BRANCH}/tasks`) {
      const sprintId = config?.params?.sprint_id;
      return ok({ tasks: sprintId === 1 ? activeTasks : sprintId === 2 ? FUTURE_TASKS : BACKLOG_TASKS });
    }
    if (url === `/branches/${BRANCH}/epics`) return ok({ epics: [] });
    if (url === `/branches/${BRANCH}/members`) return ok({ members: [] });
    if (url === `/branches/${BRANCH}/labels`) return ok({ labels: [] });
    if (url === '/saved-views') return ok({ views: [] });
    return Promise.resolve({ data: { status: false } });
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  act(() => { root.unmount(); });
  document.body.innerHTML = '';
  vi.clearAllMocks();
  await i18next.changeLanguage('en');
});

describe('스프린트 헤더 개수·상태 요약', () => {
  it('활성 스프린트: 보이는 행(상위) 기준 개수와 상태별 범례·막대를 보여준다', async () => {
    await mount();
    const h = header('S1');
    expect(textOf(h, '.TaskList__SprintCount')).toBe('5 tasks');
    expect(legend(h)).toEqual(['Done 2', 'Cancelled 1', 'In Progress 1', 'To Do 1']);
    const widths = [...h.querySelectorAll('.TaskList__SprintProgressSegment')].map((el) => el.style.width);
    expect(widths).toEqual(['40%', '20%', '20%']);
    expect(h.querySelector('.TaskList__SprintSubtaskToggle').getAttribute('aria-pressed')).toBe('false');
  });

  it('하위 포함 토글은 범례만 상위+하위 기준으로 바꾸고, 개수 라벨과 섹션 펼침은 그대로 둔다', async () => {
    await mount();
    const h = header('S1');
    const toggle = h.querySelector('.TaskList__SprintSubtaskToggle');
    expect(toggle.textContent).toBe('Include 3 subtasks');

    act(() => { toggle.click(); });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(legend(h)).toEqual(['Done 4', 'Cancelled 1', 'In Progress 1', 'To Do 2']);
    expect(textOf(h, '.TaskList__SprintCount')).toBe('5 tasks');
    expect(rowIds('S1')).toHaveLength(5);   // 헤더 클릭(접기)으로 번지지 않았다

    act(() => { toggle.click(); });
    expect(legend(h)).toEqual(['Done 2', 'Cancelled 1', 'In Progress 1', 'To Do 1']);
  });

  it('상태가 바뀌어 다시 불러오면 집계는 새 값이 되고, 하위 포함 토글은 켜진 채로 남는다', async () => {
    await mount();
    const toggle = () => header('S1').querySelector('.TaskList__SprintSubtaskToggle');
    act(() => { toggle().click(); });
    expect(legend(header('S1'))).toEqual(['Done 4', 'Cancelled 1', 'In Progress 1', 'To Do 2']);

    // 행에서 상태를 바꾸면 PATCH 뒤 task:updated가 나가고 TaskList가 목록을 다시 불러온다(TaskListRow.handleFieldChange).
    // 이벤트와 응답 처리를 다른 act로 나눠, 실제처럼 응답 전 화면이 한 번 그려지게 한다
    // (한 act에 묶으면 재조회 중 리마운트 같은 중간 상태가 합쳐져 사라진다).
    activeTasks = ACTIVE_TASKS.map((t) => (t.task_id === 5 ? { ...t, status: 'done' } : t));
    act(() => { window.dispatchEvent(new Event('task:updated')); });
    await act(async () => { await flush(); });

    expect(toggle().getAttribute('aria-pressed')).toBe('true');
    expect(legend(header('S1'))).toEqual(['Done 5', 'Cancelled 1', 'In Progress 1', 'To Do 1']);
    expect(textOf(header('S1'), '.TaskList__SprintCount')).toBe('5 tasks');
  });

  it('토글에서 시작한 마우스 끌기는 스프린트 끌기를 시작하지 않는다 (이름에서 시작하면 시작한다)', async () => {
    await mount();
    const section = () => header('S1').closest('.TaskList__Sprint');
    // 헤더 전체가 dnd-kit 손잡이다(MouseSensor, 5px 이동 뒤 시작). 끌기가 시작되면 섹션이 반투명(0.4)해진다.
    const dragFrom = (el) => {
      act(() => { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 10, clientY: 10 })); });
      act(() => { document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 10, clientY: 60 })); });
      const opacity = section().style.opacity;
      act(() => { document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 10, clientY: 60 })); });
      return opacity;
    };
    expect(dragFrom(header('S1').querySelector('.TaskList__SprintSubtaskToggle'))).toBe('1');
    expect(dragFrom(header('S1').querySelector('.TaskList__SprintName'))).toBe('0.4');   // 대조군: 이 탐지가 끌기를 본다
  });

  it('예정 스프린트와 백로그는 개수 라벨만 있고 상태 줄이 없다', async () => {
    await mount();
    for (const [name, label] of [['S2', '2 tasks'], ['Backlog', '1 task']]) {
      const h = header(name);
      expect(textOf(h, '.TaskList__SprintCount')).toBe(label);
      expect(h.querySelector('.TaskList__SprintSummary')).toBeNull();
    }
  });

  it('필터가 켜져도 헤더 집계는 스프린트 전체 기준이고, 일치 수는 따로 붙는다', async () => {
    localStorage.setItem(`weave_tasks_${BRANCH}_filters`, JSON.stringify({ searchQuery: '결제' }));
    await mount();
    const h = header('S1');
    expect(rowIds('S1')).toEqual(['QA-2']);
    expect(textOf(h, '.TaskList__SprintCount')).toBe('5 tasks');
    expect(textOf(h, '.TaskList__SprintMatch')).toBe('1 match');
    expect(legend(h)).toEqual(['Done 2', 'Cancelled 1', 'In Progress 1', 'To Do 1']);
    expect(textOf(header('S2'), '.TaskList__SprintMatch')).toBe('0 matches');
    expect(textOf(header('Backlog'), '.TaskList__SprintCount')).toBe('1 task');   // 백로그도 필터 전 개수
  });

  it('필터가 꺼져 있으면 일치 칩이 없다', async () => {
    await mount();
    expect(container.querySelector('.TaskList__SprintMatch')).toBeNull();
  });

  it('워크플로 상태가 없으면 상태 줄 없이 개수만, 태스크가 없는 활성 스프린트도 상태 줄이 없다', async () => {
    await mount([]);
    expect(textOf(header('S1'), '.TaskList__SprintCount')).toBe('5 tasks');
    expect(header('S1').querySelector('.TaskList__SprintSummary')).toBeNull();

    act(() => { root.unmount(); });
    root = createRoot(container);
    activeTasks = [];
    await mount();
    expect(textOf(header('S1'), '.TaskList__SprintCount')).toBe('0 tasks');
    expect(header('S1').querySelector('.TaskList__SprintSummary')).toBeNull();
  });

  it('하위태스크가 없으면 토글이 없고, 취소가 0이면 범례에서 취소됨을 뺀다', async () => {
    activeTasks = ACTIVE_TASKS.filter((t) => t.status !== 'wontfix').map((t) => ({ ...t, subtasks: [] }));
    await mount();
    const h = header('S1');
    expect(legend(h)).toEqual(['Done 2', 'In Progress 1', 'To Do 1']);
    expect(h.querySelector('.TaskList__SprintSubtaskToggle')).toBeNull();
  });

  it('한국어 문구', async () => {
    await act(async () => { await i18next.changeLanguage('ko'); });
    await mount();
    const h = header('S1');
    expect(textOf(h, '.TaskList__SprintCount')).toBe('태스크 5개');
    expect(legend(h)).toEqual(['완료 2', '취소됨 1', '진행 중 1', '할 일 1']);
    expect(textOf(h, '.TaskList__SprintSubtaskToggle')).toBe('하위 3개 포함');
  });
});
