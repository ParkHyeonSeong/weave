// @vitest-environment jsdom
//
// 보드 카드의 하위태스크 목록(제목·행·사진·펼치기 줄)에서 시작한 드래그가 부모 태스크의 상태를
// 바꾸던 회귀. 부모 카드 본문 드래그와 펼치기·하위 열기·우클릭 차단은 그대로여야 한다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('@/library/_axios', () => ({ getBaseURL: () => '' }));
import BoardColumn from '@/components/Branch/Board/BoardColumn';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PARENT = 1001;
const CHILD = 1002;
const CHILD_WITH_PHOTO = 1003;
const photoUser = { user_id: 7, username: 'Kim', avatar_url: '/api/uploads/avatars/7.png', role: 'main' };
const WORKFLOW = [
  { key: 'todo', label: 'To Do', color: '#9CA3AF', category: 'todo' },
  { key: 'done', label: 'Done', color: '#16A34A', category: 'done' },
];
const PARENT_TASK = {
  task_id: PARENT,
  display_id: 'QA-1',
  title: '부모 태스크',
  status: 'todo',
  assignees: [photoUser],
  subtask_progress: { done: 0, total: 2 },
  subtasks: [
    { task_id: CHILD, display_id: 'QA-2', title: '하위 제목', status: 'todo', assignees: [] },
    { task_id: CHILD_WITH_PHOTO, display_id: 'QA-3', title: '사진 있는 하위', status: 'todo', assignees: [photoUser] },
  ],
};

let root;
let container;
let onStatusChange;
let onCardClick;
let onCardContextMenu;

function renderBoard() {
  act(() => {
    root.render(
      <>
        {WORKFLOW.map((ws) => (
          <BoardColumn
            key={ws.key}
            status={ws.key}
            label={ws.label}
            color={ws.color}
            tasks={ws.key === 'todo' ? [PARENT_TASK] : []}
            taskTypes={[]}
            workflowStatuses={WORKFLOW}
            onCardClick={onCardClick}
            onCardContextMenu={onCardContextMenu}
            onStatusChange={onStatusChange}
          />
        ))}
      </>,
    );
  });
}

const card = () => container.querySelector('.BoardCard');
const doneColumnBody = () => container.querySelectorAll('.BoardColumn__Body')[1];
const subtaskRow = (i) => container.querySelectorAll('.BoardCard__Subtask')[i];

function expandSubtasks() {
  act(() => { container.querySelector('.BoardCard__Progress').click(); });
}

// 브라우저의 드래그 원천 선택: <img>는 기본 draggable이라 자신이 원천이고,
// 그 밖에는 누른 지점에서 가장 가까운 draggable="true" 조상이 원천이다.
function dragSourceFor(pressed) {
  if (pressed.tagName === 'IMG' && pressed.getAttribute('draggable') !== 'false') return pressed;
  return pressed.closest('[draggable="true"]');
}

function dragEvent(type, dataTransfer) {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'dataTransfer', { value: dataTransfer });
  return ev;
}

// pressed에서 드래그를 시작해 target 열에 놓고, 드래그가 실제로 시작됐는지 돌려준다.
// dragstart가 취소되면 브라우저는 드래그를 시작하지 않으므로 drop도 보내지 않는다.
function dragAndDrop(pressed, target) {
  const store = new Map();
  const dataTransfer = {
    effectAllowed: 'all',
    dropEffect: 'none',
    setData: (type, value) => store.set(type, value),
    getData: (type) => store.get(type) ?? '',
  };
  const source = dragSourceFor(pressed);
  const start = dragEvent('dragstart', dataTransfer);
  act(() => { source.dispatchEvent(start); });
  if (start.defaultPrevented) return false;
  act(() => {
    target.dispatchEvent(dragEvent('dragover', dataTransfer));
    target.dispatchEvent(dragEvent('drop', dataTransfer));
  });
  return true;
}

beforeEach(() => {
  onStatusChange = vi.fn();
  onCardClick = vi.fn();
  onCardContextMenu = vi.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  renderBoard();
});

afterEach(() => {
  act(() => { root.unmount(); });
  document.body.innerHTML = '';
});

describe('BoardCard 하위태스크 영역에서 시작한 드래그', () => {
  it('하위태스크 제목에서 시작하면 부모 상태를 바꾸지 않는다', () => {
    expandSubtasks();
    expect(dragAndDrop(subtaskRow(0).querySelector('.BoardCard__SubtaskTitle'), doneColumnBody())).toBe(false);
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it('하위태스크 행(키 부분)에서 시작해도 부모 상태를 바꾸지 않는다', () => {
    expandSubtasks();
    expect(dragAndDrop(subtaskRow(0).querySelector('.BoardCard__SubtaskId'), doneColumnBody())).toBe(false);
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it('하위태스크 담당자 사진에서 시작해도 부모 상태를 바꾸지 않는다', () => {
    expandSubtasks();
    const photo = subtaskRow(1).querySelector('img');
    expect(photo).not.toBeNull();
    expect(dragAndDrop(photo, doneColumnBody())).toBe(false);
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it('펼치기 줄에서 시작해도 부모 상태를 바꾸지 않는다', () => {
    expect(dragAndDrop(container.querySelector('.BoardCard__ProgressText'), doneColumnBody())).toBe(false);
    expect(onStatusChange).not.toHaveBeenCalled();
  });
});

describe('BoardCard 부모 카드 드래그와 기존 상호작용', () => {
  it('부모 카드 본문에서 시작한 드래그는 부모 상태를 바꾼다', () => {
    dragAndDrop(card().querySelector('.BoardCard__Title'), doneColumnBody());
    expect(onStatusChange).toHaveBeenCalledWith(PARENT, 'done');
  });

  it('부모 카드의 담당자 사진에서 시작한 드래그도 부모 상태를 바꾼다', () => {
    dragAndDrop(card().querySelector('.BoardCard__Assignees img'), doneColumnBody());
    expect(onStatusChange).toHaveBeenCalledWith(PARENT, 'done');
  });

  it('펼치기는 부모 태스크를 열지 않고 목록만 펼친다', () => {
    expandSubtasks();
    expect(subtaskRow(0)).not.toBeUndefined();
    expect(onCardClick).not.toHaveBeenCalled();
  });

  it('하위태스크를 누르면 부모가 아니라 그 하위태스크를 연다', () => {
    expandSubtasks();
    act(() => { subtaskRow(0).click(); });
    expect(onCardClick).toHaveBeenCalledTimes(1);
    expect(onCardClick.mock.calls[0][0].task_id).toBe(CHILD);
  });

  it('하위태스크 우클릭은 부모 우클릭 메뉴로 번지지 않고, 카드 본문 우클릭은 연다', () => {
    expandSubtasks();
    act(() => { subtaskRow(0).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); });
    expect(onCardContextMenu).not.toHaveBeenCalled();
    act(() => { card().querySelector('.BoardCard__Title').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); });
    expect(onCardContextMenu).toHaveBeenCalledTimes(1);
  });
});

// 스탠드업에서 "이거 언제까지죠?"를 카드를 열지 않고 답하게 한다. 오늘은 개인 시간대 기준이다
// (Provider 밖 기본 시간대 UTC). 날짜를 고정해 경계(지남·이틀 이내·여유)를 결정적으로 본다.
describe('BoardCard 마감 칩과 에픽 칩', () => {
  const EPICS = [{ epic_id: 7, epic_name: 'Payments', color: '#16A34A' }];
  const taskWith = (id, extra) => ({
    task_id: id, display_id: `QA-${id}`, title: `태스크 ${id}`, status: 'todo', assignees: [], ...extra,
  });

  function renderCards(tasks) {
    act(() => {
      root.render(
        <BoardColumn
          status="todo"
          label="To Do"
          color="#9CA3AF"
          tasks={tasks}
          taskTypes={[]}
          workflowStatuses={WORKFLOW}
          epics={EPICS}
          onCardClick={onCardClick}
          onCardContextMenu={onCardContextMenu}
          onStatusChange={onStatusChange}
        />,
      );
    });
  }

  const cardOf = (id) => [...container.querySelectorAll('.BoardCard')]
    .find((el) => el.textContent.includes(`QA-${id}`));
  const dueOf = (id) => cardOf(id).querySelector('.BoardCard__Due');

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-30T03:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('마감이 지난 열린 태스크는 빨간 D+N 칩을 단다', () => {
    renderCards([taskWith(1, { due_date: '2026-09-28' })]);
    const due = dueOf(1);
    expect(due.classList.contains('BoardCard__Due--over')).toBe(true);
    expect(due.querySelector('.BoardCard__DueDate').textContent).toBe('09/28');
    expect(due.querySelector('.BoardCard__DueDday').textContent).toBe('D+2');
    expect(due.getAttribute('title')).toBe('Due 09/28');
  });

  it('이틀 이내 마감은 주황 칩이다 (오늘은 D-day)', () => {
    renderCards([
      taskWith(1, { due_date: '2026-09-30' }),
      taskWith(2, { due_date: '2026-10-02' }),
    ]);
    expect(dueOf(1).classList.contains('BoardCard__Due--soon')).toBe(true);
    expect(dueOf(1).querySelector('.BoardCard__DueDday').textContent).toBe('D-day');
    expect(dueOf(2).classList.contains('BoardCard__Due--soon')).toBe(true);
    expect(dueOf(2).querySelector('.BoardCard__DueDday').textContent).toBe('D-2');
  });

  it('여유 있는 마감은 날짜만 보이고 경고색이 없다', () => {
    renderCards([taskWith(1, { due_date: '2026-10-15' })]);
    const due = dueOf(1);
    expect(due.classList.contains('BoardCard__Due--calm')).toBe(true);
    expect(due.querySelector('.BoardCard__DueDate').textContent).toBe('10/15');
    expect(due.querySelector('.BoardCard__DueDday')).toBeNull();
  });

  it('완료된 태스크는 마감이 지나도 경고하지 않는다', () => {
    renderCards([taskWith(1, { status: 'done', due_date: '2026-09-28' })]);
    const due = dueOf(1);
    expect(due.classList.contains('BoardCard__Due--calm')).toBe(true);
    expect(due.querySelector('.BoardCard__DueDday')).toBeNull();
  });

  it('에픽이 있으면 색 점과 에픽 이름을 보인다', () => {
    renderCards([taskWith(1, { epic_id: 7 })]);
    const epic = cardOf(1).querySelector('.BoardCard__Epic');
    expect(epic.querySelector('.BoardCard__EpicName').textContent).toBe('Payments');
    expect(epic.querySelector('.BoardCard__EpicDot').style.backgroundColor).toBe('rgb(22, 163, 74)');
    expect(cardOf(1).querySelector('.BoardCard__Due')).toBeNull();
  });

  it('마감도 에픽도 없으면 칩 줄을 그리지 않는다', () => {
    renderCards([taskWith(1, {}), taskWith(2, { epic_id: 999 })]);
    expect(cardOf(1).querySelector('.BoardCard__Meta')).toBeNull();
    // 목록에 없는 에픽 id(방금 지워진 에픽 등)는 빈 칩 대신 아무것도 그리지 않는다
    expect(cardOf(2).querySelector('.BoardCard__Meta')).toBeNull();
  });
});
