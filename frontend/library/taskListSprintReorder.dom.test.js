// @vitest-environment jsdom
//
// 작업 탭 스프린트 순서 끌기.
// 스프린트를 끄는 동안 판정이 다른 스프린트의 태스크 행·백로그로 떨어지면 미리보기가 원래대로 튀고,
// 놓아도 아무 일도 없었다(실측: 태스크 1개짜리 스프린트는 93% 구간, 접힌 스프린트는 100% 구간).
// jsdom은 배치를 계산하지 않으므로 카드·본문·행에 브라우저와 같은 크기를 주고, 실제 dnd-kit에 마우스 이벤트를 보낸다.
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
const WORKFLOW = [
  { key: 'todo', label: 'To Do', color: '#9CA3AF', category: 'todo' },
  { key: 'in_progress', label: 'In Progress', color: '#2563EB', category: 'in_progress' },
  { key: 'done', label: 'Done', color: '#16A34A', category: 'done' },
];
const row = (id, sprintId, status = 'todo') => ({
  task_id: id, display_id: `QA-${id}`, display_number: id, title: `태스크 ${id}`, task_type: 'task', status,
  priority: 'medium', epic_id: null, sprint_id: sprintId, parent_task_id: null, start_date: null, due_date: null,
  sort_order: id, created_at: '2026-10-01T00:00:00+00:00', labels: [], assignees: [], issue_count: 0,
  subtasks: [], subtask_progress: { done: 0, total: 0 },
});
// 활성 S1은 상태 줄 때문에 헤더가 높다(74px) — 예정 스프린트 헤더(48px)와 다르다
const SPRINTS = [
  { sprint_id: 1, sprint_name: 'S1', status: 'active', start_date: '2026-10-13', end_date: '2026-10-24', goal: null },
  { sprint_id: 2, sprint_name: 'S2', status: 'future', start_date: null, end_date: null, goal: null },
  { sprint_id: 3, sprint_name: 'S3', status: 'future', start_date: null, end_date: null, goal: null },
];
// 실측과 같은 비율: 활성 스프린트는 행이 많아 본문이 끄는 작은 스프린트보다 훨씬 크다
const TASKS = {
  1: [row(1, 1, 'done'), row(2, 1, 'in_progress'), row(3, 1), row(4, 1), row(5, 1, 'done'), row(6, 1)],
  2: [row(11, 2), row(12, 2)],
  3: [row(21, 3)],
};
const BACKLOG = [row(31, null)];

let backlog;
let root;
let container;
let rects = new Map();

const ok = (data) => Promise.resolve({ data: { status: true, ...data } });
const flush = async () => {
  for (let i = 0; i < 6; i += 1) {
    await new Promise((r) => { setTimeout(r, 0); });
  }
};
const box = (top, height, left = 0, width = 800) => ({
  x: left, y: top, top, left, width, height, right: left + width, bottom: top + height,
});

// 브라우저 배치 흉내: 카드 = 헤더(활성 74px, 나머지 48px) + 본문(행 40px씩 + 빈 목록 안내 40px + 만들기 줄 40px),
// 카드 사이 16px. 접힌 섹션은 본문이 없다.
function layout() {
  rects = new Map();
  let y = 100;
  for (const card of container.querySelectorAll('.TaskList__Sprint')) {
    const top = y;
    y += card.querySelector('.TaskList__SprintSummary') ? 74 : 48;
    const body = card.querySelector('.TaskList__SprintBody');
    if (body) {
      const bodyTop = y;
      for (const el of body.querySelectorAll('.TaskListRow')) {
        rects.set(el, box(y, 40));
        y += 40;
      }
      if (body.querySelector('.TaskList__Empty')) y += 40;
      y += 40;
      rects.set(body, box(bodyTop, y - bodyTop));
    }
    rects.set(card, box(top, y - top));
    y += 16;
  }
}

async function mount() {
  await act(async () => {
    root.render(
      <TaskList branchId={BRANCH} branchKey="QA" taskTypes={[]} workflowStatuses={WORKFLOW} onSelectTask={vi.fn()} />,
    );
    await flush();
  });
  layout();
}

const card = (name) => [...container.querySelectorAll('.TaskList__Sprint')]
  .find((el) => el.querySelector('.TaskList__SprintName').textContent === name);
const rowsOf = (name) => [...card(name).querySelectorAll('.TaskListRow')];
const rectOf = (el) => rects.get(el);
const translateY = (el) => Number(el.style.transform.match(/translate3d\([^,]+, (-?[\d.]+)px/)?.[1]);

const mouse = (target, type, y) => {
  act(() => { target.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, clientX: 40, clientY: y })); });
};
// MouseSensor는 5px 넘게 움직여야 끌기를 시작한다. 시작 뒤 한 번 더 움직여 판정 영역 측정을 끝낸다.
function startDrag(handle, y) {
  mouse(handle, 'mousedown', y);
  mouse(document, 'mousemove', y + 10);
  mouse(document, 'mousemove', y + 12);
}
async function drop(y) {
  await act(async () => {
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, clientX: 40, clientY: y }));
    await flush();
  });
}
const sprintReorders = () => axios.post.mock.calls.filter(([url]) => url === `/branches/${BRANCH}/sprints/reorder`);

beforeEach(() => {
  localStorage.clear();
  backlog = BACKLOG;
  axios.get.mockImplementation((url, config) => {
    if (url === `/branches/${BRANCH}/sprints`) return ok({ sprints: SPRINTS });
    if (url === `/branches/${BRANCH}/tasks`) {
      const sprintId = config?.params?.sprint_id;
      return ok({ tasks: sprintId ? TASKS[sprintId] : backlog });
    }
    if (url === `/branches/${BRANCH}/epics`) return ok({ epics: [] });
    if (url === `/branches/${BRANCH}/members`) return ok({ members: [] });
    if (url === `/branches/${BRANCH}/labels`) return ok({ labels: [] });
    if (url === '/saved-views') return ok({ views: [] });
    return Promise.resolve({ data: { status: false } });
  });
  axios.post.mockImplementation(() => ok({}));
  // dnd-kit DragOverlay는 끌기 시작 때 끄는 노드의 자리·크기(인라인 top/left/width/height)로 놓인다.
  // 자식이 하나면(태스크 끌기의 미리보기 행) dnd-kit은 그 자식을 잰다 — 자식에도 같은 크기를 준다.
  const overlayBox = (el) => (el?.style.position === 'fixed' && el.style.width
    ? box(parseFloat(el.style.top), parseFloat(el.style.height), parseFloat(el.style.left), parseFloat(el.style.width))
    : null);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    return rects.get(this)
      ?? overlayBox(this)
      ?? (this.parentElement?.children.length === 1 ? overlayBox(this.parentElement) : null)
      ?? box(0, 0, 0, 0);
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  // 단정이 실패해 끌기가 남았으면 Esc로 취소한다 — 남은 문서 리스너가 다음 테스트의 mouseup을 받지 않게
  act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape' })); });
  act(() => { root.unmount(); });
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.clearAllMocks();
  await i18next.changeLanguage('en');
});

describe('스프린트 순서 끌기', () => {
  it('다른 스프린트의 태스크 행 위에서 놓아도 그 스프린트 자리로 옮긴다', async () => {
    await mount();
    const target = rectOf(rowsOf('S1')[1]).top + 20;
    startDrag(card('S3').querySelector('.TaskList__SprintName'), rectOf(card('S3')).top + 24);
    mouse(document, 'mousemove', target);
    await drop(target);
    expect(sprintReorders()).toEqual([[`/branches/${BRANCH}/sprints/reorder`, { sprint_ids: [3, 1, 2] }]]);
  });

  it('접힌 스프린트도 옮길 수 있다', async () => {
    localStorage.setItem(`weave_tasks_${BRANCH}_collapsed`, JSON.stringify([2, 3]));
    await mount();
    expect(card('S2').querySelector('.TaskList__SprintBody')).toBeNull();
    const target = rectOf(card('S2')).top + 24;
    startDrag(card('S3').querySelector('.TaskList__SprintName'), rectOf(card('S3')).top + 24);
    mouse(document, 'mousemove', target);
    await drop(target);
    expect(sprintReorders()).toEqual([[`/branches/${BRANCH}/sprints/reorder`, { sprint_ids: [1, 3, 2] }]]);
  });

  it('미리보기는 헤더 높이가 달라도 카드 전체 높이만큼 비켜나 겹치지 않는다', async () => {
    await mount();
    const s1 = rectOf(card('S1'));
    const s2 = rectOf(card('S2'));
    const target = s2.top + 30;
    startDrag(card('S1').querySelector('.TaskList__SprintName'), s1.top + 24);
    mouse(document, 'mousemove', target);
    expect(translateY(card('S2'))).toBe(-(s1.height + 16));   // S2가 S1 원래 자리로 올라간다
    expect(translateY(card('S1'))).toBe(s2.bottom - s1.bottom); // 반투명 S1은 S2 원래 아래 끝에 맞춘다
    await drop(target);
    expect(sprintReorders()).toEqual([[`/branches/${BRANCH}/sprints/reorder`, { sprint_ids: [2, 1, 3] }]]);
  });

  it('태스크 끌기는 그대로다: 다른 스프린트의 행 위에 놓으면 그 행 뒤로 옮긴다', async () => {
    await mount();
    const from = rowsOf('S2')[0];
    const target = rectOf(rowsOf('S1')[0]).top + 20;
    startDrag(from.querySelector('.TaskListRow__Title'), rectOf(from).top + 20);
    mouse(document, 'mousemove', target);
    await drop(target);
    expect(sprintReorders()).toEqual([]);
    expect(axios.post).toHaveBeenCalledWith(`/branches/${BRANCH}/tasks/reorder`, { task_ids: [11], sprint_id: 1, after_task_id: 1 });
  });

  it('태스크 끌기는 그대로다: 빈 백로그 헤더 위에 놓으면 백로그로 옮긴다', async () => {
    // 백로그 카드(sortable-backlog)가 후보에 끼면 헤더 근처에서 카드가 이겨 놓기가 무시된다
    backlog = [];
    await mount();
    const from = rowsOf('S2')[0];
    const target = rectOf(card('Backlog')).top + 24;
    startDrag(from.querySelector('.TaskListRow__Title'), rectOf(from).top + 20);
    mouse(document, 'mousemove', target);
    await drop(target);
    expect(axios.post).toHaveBeenCalledWith(`/branches/${BRANCH}/tasks/reorder`, { task_ids: [11], sprint_id: null, after_task_id: null });
  });
});
