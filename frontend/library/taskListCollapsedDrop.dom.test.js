// @vitest-environment jsdom
//
// 작업 탭: 접힌 섹션(스프린트·백로그)에 태스크 놓기, 접힌 헤더에 머무르면 이번 끌기 동안만 펼치기.
// 고치기 전에는 접힌 섹션에 받는 자리가 없어 태스크가 이웃 섹션 행으로 들어갔다(2026-11-02 실측).
// jsdom은 배치를 계산하지 않으므로 카드·헤더·본문·행에 브라우저와 같은 크기를 주고, 실제 dnd-kit에 마우스 이벤트를 보낸다.
// 크기는 물을 때마다 지금 DOM으로 다시 계산한다 — 임시로 펼치면 그 아래 섹션 좌표가 내려가야 한다.
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
const HOVER_MS = 600; // 사용자 결정(2026-11-02) — 제품 상수 HOVER_EXPAND_MS와 같다(유닛이 고정). 기준 코드에서도 이 파일이 돌도록 가져오지 않는다
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
// S1 진행 중(상태 줄이 있어 헤더 74px) · S2 예정(행 2) · S3 예정(빈 스프린트) · S4 예정(행 2) · 백로그(행 1)
const SPRINTS = [
  { sprint_id: 1, sprint_name: 'S1', status: 'active', start_date: '2026-10-27', end_date: '2026-11-07', goal: null },
  { sprint_id: 2, sprint_name: 'S2', status: 'future', start_date: null, end_date: null, goal: null },
  { sprint_id: 3, sprint_name: 'S3', status: 'future', start_date: null, end_date: null, goal: null },
  { sprint_id: 4, sprint_name: 'S4', status: 'future', start_date: null, end_date: null, goal: null },
];
const TASKS = {
  1: [row(1, 1, 'done'), row(2, 1, 'in_progress'), row(3, 1)],
  2: [row(11, 2), row(12, 2)],
  3: [],
  4: [row(41, 4), row(42, 4)],
};
const BACKLOG = [row(31, null)];

let root;
let container;

const ok = (data) => Promise.resolve({ data: { status: true, ...data } });
const flush = async () => {
  for (let i = 0; i < 6; i += 1) {
    await new Promise((r) => { setTimeout(r, 0); });
  }
};
const box = (top, height, left = 0, width = 800) => ({
  x: left, y: top, top, left, width, height, right: left + width, bottom: top + height,
});

// 브라우저 배치 흉내: 목록은 y=100에서 시작하고, 카드 = 헤더(진행 중 74px, 나머지 48px) + 본문
// (행 40px씩 + 빈 목록 안내 40px + 만들기 줄 40px), 카드 사이 16px. 접힌 섹션은 본문이 없다.
// 헤더 사각형도 준다 — 접힌 헤더 놓기는 포인터가 헤더 안인지로 판정한다.
function layout() {
  const rects = new Map();
  let y = 100;
  for (const card of container.querySelectorAll('.TaskList__Sprint')) {
    const top = y;
    const headerH = card.querySelector('.TaskList__SprintSummary') ? 74 : 48;
    rects.set(card.querySelector('.TaskList__SprintHeader'), box(top, headerH));
    y += headerH;
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
  return rects;
}

const card = (name) => [...container.querySelectorAll('.TaskList__Sprint')]
  .find((el) => el.querySelector('.TaskList__SprintName').textContent === name);
const headerOf = (name) => card(name).querySelector('.TaskList__SprintHeader');
const rowsOf = (name) => [...card(name).querySelectorAll('.TaskListRow')];
const isOpen = (name) => card(name).querySelector('.TaskList__SprintBody') !== null;
const rectOf = (el) => layout().get(el);
const mid = (el) => { const r = rectOf(el); return r.top + r.height / 2; };
const countOf = (name) => card(name).querySelector('.TaskList__SprintCount').textContent;
const highlighted = (name) => card(name).classList.contains('TaskList__Sprint--dragOver');
const taskReorders = () => axios.post.mock.calls
  .filter(([url]) => url === `/branches/${BRANCH}/tasks/reorder`).map(([, body]) => body);
const savedCollapsed = () => localStorage.getItem(`weave_tasks_${BRANCH}_collapsed`);

const mouse = (target, type, y) => {
  act(() => { target.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, clientX: 40, clientY: y })); });
};
// MouseSensor는 5px 넘게 움직여야 끌기를 시작한다. 시작 뒤 한 번 더 움직여 판정 영역 측정을 끝낸다.
function startDrag(handle, y) {
  mouse(handle, 'mousedown', y);
  mouse(document, 'mousemove', y + 10);
  mouse(document, 'mousemove', y + 12);
}
const dragRow = (rowEl, grabY = mid(rowEl)) => startDrag(rowEl.querySelector('.TaskListRow__Title'), grabY);
const moveTo = (y) => mouse(document, 'mousemove', y);
async function drop(y) {
  moveTo(y);
  await act(async () => {
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, clientX: 40, clientY: y }));
    await flush();
  });
}
const wait = (ms) => act(async () => { await new Promise((r) => { setTimeout(r, ms); }); });
const esc = () => act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape' })); });

async function mount(collapsed) {
  localStorage.setItem(`weave_tasks_${BRANCH}_collapsed`, JSON.stringify(collapsed));
  await act(async () => {
    root.render(
      <TaskList branchId={BRANCH} branchKey="QA" taskTypes={[]} workflowStatuses={WORKFLOW} onSelectTask={vi.fn()} />,
    );
    await flush();
  });
}

beforeEach(() => {
  localStorage.clear();
  axios.get.mockImplementation((url, config) => {
    if (url === `/branches/${BRANCH}/sprints`) return ok({ sprints: SPRINTS });
    if (url === `/branches/${BRANCH}/tasks`) {
      const sprintId = config?.params?.sprint_id;
      return ok({ tasks: sprintId ? TASKS[sprintId] : BACKLOG });
    }
    if (url === `/branches/${BRANCH}/epics`) return ok({ epics: [] });
    if (url === `/branches/${BRANCH}/members`) return ok({ members: [] });
    if (url === `/branches/${BRANCH}/labels`) return ok({ labels: [] });
    if (url === '/saved-views') return ok({ views: [] });
    return Promise.resolve({ data: { status: false } });
  });
  axios.post.mockImplementation(() => ok({}));
  // DragOverlay는 끌기 시작 때 끄는 노드의 자리·크기(인라인 top/left/width/height)로 놓이고,
  // 자식이 하나면 dnd-kit은 그 자식을 잰다 — 자식에도 같은 크기를 준다(taskListSprintReorder.dom.test.js와 같다).
  const overlayBox = (el) => (el?.style.position === 'fixed' && el.style.width
    ? box(parseFloat(el.style.top), parseFloat(el.style.height), parseFloat(el.style.left), parseFloat(el.style.width))
    : null);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    return layout().get(this)
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
  esc();
  act(() => { root.unmount(); });
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.clearAllMocks();
  await i18next.changeLanguage('en');
});

describe('접힌 섹션 헤더에 놓기', () => {
  it('접힌 S2 헤더에 놓으면 S2 맨 위로 옮기고 접힌 채 개수만 는다', async () => {
    await mount([2]);
    dragRow(rowsOf('S1')[1]); // 태스크 2
    moveTo(mid(headerOf('S2')));
    expect(highlighted('S2')).toBe(true);
    await drop(mid(headerOf('S2')));
    expect(taskReorders()).toEqual([{ task_ids: [2], sprint_id: 2, after_task_id: null }]);
    expect(isOpen('S2')).toBe(false);
    expect(countOf('S2')).toBe('3 tasks');
  });

  it.each([
    ['위', '위'], ['위', '아래'], ['아래', '위'], ['아래', '아래'],
  ])('행 %s쪽을 잡고 접힌 S2 헤더 %s 경계에 놓아도 S2 맨 위다(위아래 이웃도 접힘)', async (grab, edge) => {
    // 위아래 이웃 S1·S3도 접어 헤더 자리로 둔다 — 끄는 사각형으로 재면 경계에서 이웃 헤더가 이긴다(리뷰 재현)
    await mount([1, 2, 3]);
    const from = rowsOf('S4')[0]; // 태스크 41
    const r = rectOf(from);
    const h = rectOf(headerOf('S2'));
    dragRow(from, grab === '위' ? r.top + 2 : r.bottom - 2);
    await drop(edge === '위' ? h.top + 1 : h.bottom - 1);
    expect(taskReorders()).toEqual([{ task_ids: [41], sprint_id: 2, after_task_id: null }]);
  });

  it('접힌 진행 중 S1(상태 줄이 있는 74px 헤더)의 아래 경계에 놓아도 S1 맨 위다', async () => {
    await mount([1]);
    const h = rectOf(headerOf('S1'));
    expect(h.height).toBe(74);
    dragRow(rowsOf('S2')[0]); // 태스크 11
    await drop(h.bottom - 1);
    expect(taskReorders()).toEqual([{ task_ids: [11], sprint_id: 1, after_task_id: null }]);
  });

  it('접힌 백로그 헤더에 놓으면 백로그 맨 위로 옮긴다', async () => {
    await mount(['backlog']);
    dragRow(rowsOf('S1')[1]);
    await drop(mid(headerOf('Backlog')));
    expect(taskReorders()).toEqual([{ task_ids: [2], sprint_id: null, after_task_id: null }]);
    expect(isOpen('Backlog')).toBe(false);
  });

  it('Cmd로 고른 여러 태스크를 접힌 헤더에 놓으면 고른 순서대로 맨 위에 넣는다', async () => {
    await mount([2]);
    const [, r2, r3] = rowsOf('S1');
    for (const el of [r3, r2]) {
      act(() => {
        el.querySelector('.TaskListRow__Title').dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));
      });
    }
    dragRow(r2);
    await drop(mid(headerOf('S2')));
    expect(taskReorders()).toEqual([{ task_ids: [3, 2], sprint_id: 2, after_task_id: null }]);
  });

  it('처음부터 펼친 S2는 헤더에 놓아도 지금 판정 그대로다(헤더 자리 없음 → 가장 가까운 첫 행 뒤)', async () => {
    await mount([]);
    dragRow(rowsOf('S1')[1]);
    await drop(mid(headerOf('S2')));
    expect(taskReorders()).toEqual([{ task_ids: [2], sprint_id: 2, after_task_id: 11 }]);
  });
});

describe('접힌 헤더에 머무르면 이번 끌기 동안만 펼친다', () => {
  it('600ms 머무르면 펼치고(저장 안 함), 행에 놓으면 그 행 뒤로 옮긴 뒤 다시 접는다', async () => {
    await mount([2]);
    dragRow(rowsOf('S1')[1]);
    moveTo(mid(headerOf('S2')));
    await wait(HOVER_MS - 200);
    expect(isOpen('S2')).toBe(false);
    await wait(250);
    expect(isOpen('S2')).toBe(true);
    expect(savedCollapsed()).toBe('[2]');
    await drop(mid(rowsOf('S2')[1])); // 태스크 12
    expect(taskReorders()).toEqual([{ task_ids: [2], sprint_id: 2, after_task_id: 12 }]);
    expect(isOpen('S2')).toBe(false);
    expect(savedCollapsed()).toBe('[2]');
  });

  it('임시로 펼친 뒤 같은 헤더에 놓아도 맨 위다 — 기다린 시간이 결과를 바꾸지 않는다', async () => {
    await mount([2]);
    dragRow(rowsOf('S1')[1]);
    moveTo(mid(headerOf('S2')));
    await wait(HOVER_MS + 50);
    expect(isOpen('S2')).toBe(true);
    await drop(mid(headerOf('S2')) + 1);
    expect(taskReorders()).toEqual([{ task_ids: [2], sprint_id: 2, after_task_id: null }]);
    expect(isOpen('S2')).toBe(false);
  });

  it('헤더를 벗어나 섹션 사이 간격에서 600ms 넘게 기다려도 펼치지 않고, 다시 들어오면 처음부터 잰다', async () => {
    await mount([2]);
    dragRow(rowsOf('S1')[1]);
    const h = rectOf(headerOf('S2'));
    moveTo(h.top + 24);
    await wait(HOVER_MS - 200);
    moveTo(h.bottom + 8); // S2 아래 16px 간격
    await wait(HOVER_MS + 50);
    expect(isOpen('S2')).toBe(false);
    moveTo(h.top - 8); // S2 위 간격
    await wait(HOVER_MS + 50);
    expect(isOpen('S2')).toBe(false);
    moveTo(h.top + 24); // 앞서 머문 400ms와 합치지 않는다
    await wait(HOVER_MS - 200);
    expect(isOpen('S2')).toBe(false);
    await wait(250);
    expect(isOpen('S2')).toBe(true);
    esc();
    await wait(0); // DragOverlay가 끌기가 끝난 뒤 Promise로 미루는 상태 갱신도 act 안에서 흘려보낸다
    expect(isOpen('S2')).toBe(false);
    expect(taskReorders()).toEqual([]);
  });

  it('여러 섹션을 임시로 펼친 뒤 Esc면 모두 다시 접고, 걸려 있던 머무름 타이머도 지운다', async () => {
    await mount([2, 3, 4]);
    dragRow(rowsOf('S1')[1]);
    moveTo(mid(headerOf('S2')));
    await wait(HOVER_MS + 50);
    moveTo(mid(headerOf('S4'))); // S2가 펼쳐져 내려간 자리
    await wait(HOVER_MS + 50);
    expect(['S2', 'S3', 'S4'].map(isOpen)).toEqual([true, false, true]);
    moveTo(mid(headerOf('S3'))); // 타이머만 걸고
    esc(); // 600ms 전에 취소
    expect(['S2', 'S3', 'S4'].map(isOpen)).toEqual([false, false, false]);
    expect(highlighted('S3')).toBe(false);
    await wait(HOVER_MS + 50);
    expect(isOpen('S3')).toBe(false);
    expect(isOpen('S1')).toBe(true);
    expect(savedCollapsed()).toBe('[2,3,4]');
    expect(taskReorders()).toEqual([]);
  });

  it('여러 섹션을 임시로 펼친 뒤 놓으면 놓은 곳으로 옮기고, 임시로 펼친 섹션만 접고, 걸린 타이머도 지운다', async () => {
    await mount([2, 3, 4]);
    dragRow(rowsOf('S1')[1]);
    moveTo(mid(headerOf('S2')));
    await wait(HOVER_MS + 50);
    moveTo(mid(headerOf('S3'))); // 빈 S3 — 펼쳐도 새 행이 없다
    await wait(HOVER_MS + 50);
    expect(['S2', 'S3', 'S4'].map(isOpen)).toEqual([true, true, false]);
    moveTo(mid(headerOf('S4'))); // S3 본문(80px)만큼 내려간 자리, 타이머만 건다
    await wait(100);
    await drop(mid(headerOf('S4')));
    expect(taskReorders()).toEqual([{ task_ids: [2], sprint_id: 4, after_task_id: null }]);
    expect(['S1', 'S2', 'S3', 'S4'].map(isOpen)).toEqual([true, false, false, false]);
    await wait(HOVER_MS + 50);
    expect(isOpen('S4')).toBe(false);
  });

  it('빈 S3를 임시로 펼친 뒤 아래 S4 행에 놓으면 그 행 뒤로 간다 — 펼친 직후 위치를 다시 잰다', async () => {
    await mount([3]);
    dragRow(rowsOf('S1')[1]);
    moveTo(mid(headerOf('S3')));
    await wait(HOVER_MS + 50);
    expect(isOpen('S3')).toBe(true);
    await drop(mid(rowsOf('S4')[1])); // 태스크 42, S3 본문(80px)만큼 내려간 자리
    expect(taskReorders()).toEqual([{ task_ids: [2], sprint_id: 4, after_task_id: 42 }]);
  });

  it('아래 백로그에서 위로 끌어 접힌 S2를 펼쳐도(끄는 행이 밀려 내려가도) 놓은 S2 행 뒤로 간다', async () => {
    await mount([2]);
    dragRow(rowsOf('Backlog')[0]); // 태스크 31
    moveTo(mid(headerOf('S2')));
    await wait(HOVER_MS + 50);
    expect(isOpen('S2')).toBe(true);
    await drop(mid(rowsOf('S2')[0])); // 태스크 11
    expect(taskReorders()).toEqual([{ task_ids: [31], sprint_id: 2, after_task_id: 11 }]);
    expect(isOpen('S2')).toBe(false);
  });

  it('스프린트를 끌 때는 접힌 헤더에 오래 머물러도 펼치지 않는다', async () => {
    await mount([2]);
    startDrag(headerOf('S4').querySelector('.TaskList__SprintName'), mid(headerOf('S4')));
    moveTo(mid(headerOf('S2')));
    await wait(HOVER_MS + 50);
    expect(isOpen('S2')).toBe(false);
  });
});
