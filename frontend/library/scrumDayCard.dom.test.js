// @vitest-environment jsdom
//
// 하루 보기 사람 카드(ScrumDayCard)의 본문 규칙(스펙 §6.2·§8)과 전날 할 일 가져오기(§6.4).
// 칸 편집기(ScrumCell)는 가짜로 바꿔 "어느 fragment 키의 칸이 그려지는가"만 본다.
// 가짜 칸은 onEditor로 가짜 편집기를 넘긴다 — 가져오기가 편집기에 내린 명령만 기록한다(TipTap 없음).
// 칸 내용은 실제 Y.Doc에 넣는다(scrumCellContent 테스트와 같은 방식).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import * as Y from 'yjs';
import { collectTaskIds } from '@/library/scrumCarryOver';

const cells = vi.hoisted(() => {
  const editors = new Map();   // fragmentKey → 그 칸에 마지막으로 붙은 가짜 편집기
  function fakeEditor() {
    const listeners = new Set();
    const editor = {
      isDestroyed: false,
      state: {},               // 실제 편집기처럼 state가 있다 — y-undo 플러그인 상태는 없다(실행 취소 묶음은 실제 편집기 테스트가 본다)
      runs: [],                // chain().…run() 한 번마다 { meta, content, focus }
      commands: { focus: vi.fn(), undo: vi.fn() },
      on: (name, fn) => { if (name === 'update') listeners.add(fn); },
      off: (name, fn) => { if (name === 'update') listeners.delete(fn); },
      // TipTap의 update 이벤트 — 받는 쪽은 transaction.getMeta만 읽는다
      emitUpdate: (meta = {}) => listeners.forEach((fn) => fn({ editor, transaction: { getMeta: (k) => meta[k] } })),
      chain() {
        const step = { meta: {} };
        const chain = {
          setMeta: (k, v) => { step.meta[k] = v; return chain; },
          setContent: (content) => { step.content = content; return chain; },
          focus: (pos) => { step.focus = pos; return chain; },
          run: () => { editor.runs.push(step); return true; },
        };
        return chain;
      },
    };
    return editor;
  }
  return { editors, fakeEditor };
});
const refs = vi.hoisted(() => ({ resolveTaskCategories: vi.fn(), hydrateEditor: vi.fn() }));

vi.mock('@/components/Scrum/ScrumCell', async () => {
  const { useEffect } = await import('react');
  return {
    default: function FakeCell({ fragmentKey, editable, onEditor }) {
      // 실제 ScrumCell처럼 마운트 뒤 편집기를 알리고, 사라질 때 파괴된 편집기를 놓는다
      useEffect(() => {
        if (!onEditor) return undefined;
        const editor = cells.fakeEditor();
        cells.editors.set(fragmentKey, editor);
        onEditor(editor);
        return () => { editor.isDestroyed = true; onEditor(null); };
      }, [fragmentKey, onEditor]);
      return <div data-cell={fragmentKey} data-editable={String(editable !== false)} />;
    },
  };
});
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal()),
  useTranslation: () => ({ t: (key) => key, i18n: { language: 'ko' } }),
}));
vi.mock('@/library/_axios', () => ({ getBaseURL: () => '' }));
vi.mock('@/library/refHydration', () => refs);

import ScrumDayCard from '@/components/Scrum/ScrumDayCard';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const MEMBER = { user_id: 7, username: '박현성' };
const PLAN = '7:2:plan';
const RECAP = '7:2:gap';

// 연결되지 않은 Y 타입은 읽을 수 없으므로, 부모에 먼저 붙인 뒤 자식을 채운다.
function attach(parent, node) {
  parent.insert(parent.length, [node]);
  return node;
}
function write(doc, key, s) {
  const p = attach(doc.getXmlFragment(key), new Y.XmlElement('paragraph'));
  attach(p, new Y.XmlText(s));
}
// 글머리 목록 하나. 항목마다 글자({ text }) 또는 태스크 칩 하나({ taskId })
function writeList(doc, key, items) {
  const list = attach(doc.getXmlFragment(key), new Y.XmlElement('bulletList'));
  items.forEach(({ text, taskId }) => {
    const p = attach(attach(list, new Y.XmlElement('listItem')), new Y.XmlElement('paragraph'));
    if (taskId) attach(p, new Y.XmlElement('taskRef')).setAttribute('taskId', taskId);
    else attach(p, new Y.XmlText(text));
  });
}

let root;
let container;
let doc;
let onToggle;

// 기본은 주간 문서가 첫 동기화를 마친 뒤(synced) — 동기화 전 모양은 '첫 동기화 전' 묶음에서만 본다
function renderCard(props = {}) {
  act(() => {
    root.render(
      <ScrumDayCard
        ydoc={doc}
        member={MEMBER}
        members={[MEMBER]}
        isMe={false}
        dayIdx={2}
        open
        synced
        onToggle={onToggle}
        {...props}
      />,
    );
  });
}

const cell = (key) => container.querySelector(`[data-cell="${key}"]`);
const cellCount = () => container.querySelectorAll('[data-cell]').length;
const button = (label) => [...container.querySelectorAll('button')].find((b) => b.textContent.includes(label));

beforeEach(() => {
  doc = new Y.Doc();
  onToggle = vi.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  document.body.innerHTML = '';
  doc.destroy();
});

describe('ScrumDayCard 본문 규칙', () => {
  it('둘 다 있으면 할 일·리캡 칸 두 개', () => {
    write(doc, PLAN, '로그인 버그 수정');
    write(doc, RECAP, '수정 완료');
    renderCard();
    expect(cell(PLAN)).not.toBeNull();
    expect(cell(RECAP)).not.toBeNull();
    expect(container.textContent).not.toContain('scrum.day.noRecap');
  });

  it('할 일만 있으면 리캡은 한 줄 행, 남의 카드엔 쓰기 버튼 없음', () => {
    write(doc, PLAN, '로그인 버그 수정');
    renderCard();
    expect(cell(PLAN)).not.toBeNull();
    expect(cell(RECAP)).toBeNull();
    expect(container.textContent).toContain('scrum.day.noRecap');
    expect(button('scrum.day.writeRecap')).toBeUndefined();
  });

  it('내 카드의 리캡 쓰기를 누르면 리캡 칸이 열린다', () => {
    write(doc, PLAN, '로그인 버그 수정');
    renderCard({ isMe: true });
    expect(cell(RECAP)).toBeNull();
    act(() => { button('scrum.day.writeRecap').click(); });
    expect(cell(RECAP)).not.toBeNull();
    expect(cell(PLAN)).not.toBeNull();
    expect(button('scrum.day.writeRecap')).toBeUndefined();
  });

  it('남의 카드가 비면 한 줄 문구만', () => {
    renderCard();
    expect(container.textContent).toContain('scrum.day.notWritten');
    expect(cellCount()).toBe(0);
  });

  it('내 카드가 비어도 할 일 칸은 보인다', () => {
    renderCard({ isMe: true });
    expect(cell(PLAN)).not.toBeNull();
    expect(cell(RECAP)).toBeNull();
    expect(container.textContent).not.toContain('scrum.day.notWritten');
    expect(button('scrum.day.writeRecap')).toBeDefined();
  });

  it('내 카드에 할 일이 채워져도 할 일 칸 DOM 노드가 그대로다', () => {
    renderCard({ isMe: true });
    const before = cell(PLAN);
    expect(before).not.toBeNull();
    expect(container.textContent).toContain('scrum.day.statusEmpty');

    write(doc, PLAN, '로그인 버그 수정');
    renderCard({ isMe: true });
    expect(container.textContent).toContain('scrum.day.statusWritten');   // 다시 계산됐다
    expect(cell(PLAN)).toBe(before);

    write(doc, RECAP, '수정 완료');                                        // 둘 다 있음으로
    renderCard({ isMe: true });
    expect(cell(RECAP)).not.toBeNull();
    expect(cell(PLAN)).toBe(before);
  });

  // 쓰기 시작한 칸 옆의 빈 칸이 접히면(= 편집기 언마운트) 쓰는 도중 화면이 뛴다
  it('쓰기로 연 칸은 옆 칸에 쓰기 시작해도 그대로, 요일이 바뀌면 풀린다', () => {
    renderCard({ isMe: true });                       // 둘 다 비어 있음: 할 일 칸 + 리캡 한 줄 행
    const plan = cell(PLAN);
    act(() => { button('scrum.day.writeRecap').click(); });
    write(doc, RECAP, '수정 완료');                    // 할 일은 빈 채로 리캡만 생김
    renderCard({ isMe: true });
    expect(cell(PLAN)).toBe(plan);
    expect(cell(RECAP)).not.toBeNull();

    renderCard({ isMe: true, dayIdx: 3 });            // 목요일은 아무것도 안 씀
    expect(cell('7:3:plan')).not.toBeNull();
    expect(cell('7:3:gap')).toBeNull();
    expect(button('scrum.day.writeRecap')).toBeDefined();
  });

  it('만진 칸은 내용을 다 지워도 남는다', () => {
    write(doc, PLAN, '로그인 버그 수정');
    renderCard();
    const pane = cell(PLAN).closest('section');
    act(() => { pane.dispatchEvent(new FocusEvent('focusin', { bubbles: true })); });
    const frag = doc.getXmlFragment(PLAN);
    frag.delete(0, frag.length);
    renderCard();
    expect(cell(PLAN)).not.toBeNull();
    expect(container.textContent).not.toContain('scrum.day.notWritten');
  });

  it('접힌 카드는 칸을 그리지 않는다', () => {
    write(doc, PLAN, '로그인 버그 수정');
    write(doc, RECAP, '수정 완료');
    renderCard({ open: false });
    expect(cellCount()).toBe(0);
    const toggle = container.querySelector('button[aria-expanded]');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    act(() => { toggle.click(); });
    expect(onToggle).toHaveBeenCalledWith(7);
  });
});

// 주간 문서는 방에 들어간 직후 비어 있다 — 서버 문서(첫 동기화)가 오기 전에는 썼는지 안 썼는지 말하지 않는다.
// 칸 편집기는 그대로 두어, 동기화 뒤에도 내 할 일 칸은 같은 노드다(쓰던 내용·실행 취소 기록 유지).
describe('첫 동기화 전', () => {
  it('남의 카드: 작성 상태·"아직 작성 전이에요"를 말하지 않는다', () => {
    renderCard({ synced: false });
    expect(container.textContent).not.toContain('scrum.day.statusEmpty');
    expect(container.textContent).not.toContain('scrum.day.notWritten');

    renderCard();
    expect(container.textContent).toContain('scrum.day.statusEmpty');
    expect(container.textContent).toContain('scrum.day.notWritten');
  });

  it('내 카드: 할 일 칸·쓰기 버튼은 그대로, 작성 상태·"없어요" 한 줄은 동기화 뒤에 — 할 일 칸은 같은 노드', () => {
    renderCard({ isMe: true, synced: false });
    const plan = cell(PLAN);
    expect(plan).not.toBeNull();
    expect(button('scrum.day.writeRecap')).toBeDefined();
    expect(container.textContent).not.toContain('scrum.day.statusEmpty');
    expect(container.textContent).not.toContain('scrum.day.noRecap');

    renderCard({ isMe: true });
    expect(cell(PLAN)).toBe(plan);
    expect(container.textContent).toContain('scrum.day.statusEmpty');
    expect(container.textContent).toContain('scrum.day.noRecap');
  });

  it('전날 할 일 가져오기 버튼은 동기화 뒤에만 — 그 전에는 이날 할 일이 정말 빈지 모른다', () => {
    write(doc, '7:1:plan', '로그인 버그 수정');
    renderCard({ isMe: true, synced: false });
    expect(button('scrum.carry.button')).toBeUndefined();
    const plan = cell(PLAN);

    renderCard({ isMe: true });
    expect(button('scrum.carry.button')).toBeDefined();
    expect(cell(PLAN)).toBe(plan);                   // 버튼 줄이 생겨도 할 일 칸은 같은 노드
  });
});

// 전날 할 일 가져오기(스펙 §6.4·§8). 선택한 날은 수요일(2), 전날은 화요일(1).
describe('전날 할 일 가져오기', () => {
  const PREV = '7:1:plan';
  const carryButton = () => button('scrum.carry.button');
  const band = () => container.querySelector('[role="status"]');
  const notice = () => container.querySelector('.ScrumDayCard__CarriedText')?.textContent ?? null;
  // 상태 조회(가짜 Promise) 뒤의 이어지는 작업까지 끝낸다
  const settle = () => act(async () => { await new Promise((r) => { setTimeout(r, 0); }); });
  // 응답을 손으로 보내는 상태 조회 — 기다리는 사이의 동작을 본다
  const holdStatus = () => {
    const held = {};
    refs.resolveTaskCategories.mockImplementation(() => new Promise((resolve) => { held.answer = resolve; }));
    return held;
  };

  beforeEach(() => {
    cells.editors.clear();
    refs.resolveTaskCategories.mockReset();
    refs.resolveTaskCategories.mockResolvedValue({ categoryById: {}, failed: false });
    refs.hydrateEditor.mockReset();
  });

  it('월요일의 지난주 금요일 원본이 없으면 가져오기 버튼이 없다', () => {
    renderCard({ isMe: true, dayIdx: 0 });
    expect(cell('7:0:plan')).not.toBeNull();
    expect(carryButton()).toBeUndefined();
    expect(doc.share.has('7:-1:plan')).toBe(false);   // 없는 '전날' 칸 키를 만들지도 않는다
  });

  it('월요일도 내 빈 칸에만 지난주 금요일 가져오기를 제공한다', () => {
    const previousFriday = { status: 'ready', dateLabel: '11/6', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '금요일 할 일' }] }] } };
    renderCard({ isMe: true, dayIdx: 0, previousFriday });
    expect(carryButton()).toBeDefined();
    renderCard({ isMe: false, dayIdx: 0, previousFriday });
    expect(carryButton()).toBeUndefined();
    write(doc, '7:0:plan', '이미 작성한 월요일');
    renderCard({ isMe: true, dayIdx: 0, previousFriday });
    expect(carryButton()).toBeUndefined();
  });

  it('지난주 금요일의 빈 원본에는 버튼이 없고, 읽기 실패는 재시도를 보여준다', () => {
    renderCard({ isMe: true, dayIdx: 0, previousFriday: { status: 'ready', doc: { type: 'doc', content: [] } } });
    expect(carryButton()).toBeUndefined();
    renderCard({ isMe: true, dayIdx: 0, previousFriday: { status: 'error', retry: () => {} } });
    expect(container.textContent).toContain('scrum.carry.previousFailed');
    expect(button('common.actions.retry')).toBeDefined();
  });

  it('전날이 비어 있으면 버튼이 없다', () => {
    write(doc, '7:0:plan', '월요일에 쓴 일');        // 이틀 전은 세지 않는다
    renderCard({ isMe: true });
    expect(cell(PLAN)).not.toBeNull();
    expect(carryButton()).toBeUndefined();
  });

  it('내 할 일이 비고 전날이 있으면 버튼이 보인다', () => {
    write(doc, PREV, '로그인 버그 수정');
    renderCard({ isMe: true });
    expect(carryButton()).toBeDefined();
    const planNode = cell(PLAN);
    expect(planNode).not.toBeNull();                 // 버튼이 있어도 빈 할 일 칸은 바로 쓸 수 있다
    expect(container.textContent).toContain('scrum.carry.hint');

    write(doc, PLAN, '오늘 할 일');                   // 내 할 일이 채워지면 사라진다
    renderCard({ isMe: true });
    expect(carryButton()).toBeUndefined();
    expect(cell(PLAN)).toBe(planNode);               // 버튼 줄이 빠져도 할 일 칸은 같은 노드(실행 취소 기록 유지)
  });

  it('남의 카드에는 버튼이 없다', () => {
    write(doc, PREV, '로그인 버그 수정');
    renderCard();
    expect(container.textContent).toContain('scrum.day.notWritten');
    expect(carryButton()).toBeUndefined();
  });

  it('리캡만 있으면 버튼은 할 일 쓰기 행 안에 있다', () => {
    write(doc, PREV, '로그인 버그 수정');
    write(doc, RECAP, '수정 완료');
    renderCard({ isMe: true });
    expect(cell(PLAN)).toBeNull();
    const row = carryButton().closest('.ScrumDayCard__Slim');
    expect(row).not.toBeNull();
    expect(row.textContent).toContain('scrum.day.writePlan');
  });

  it('끝난 항목을 뺀 전날 할 일을 할 일 편집기에 한 번에 넣고 안내 띠를 띄운다', async () => {
    writeList(doc, PREV, [{ taskId: 11 }, { taskId: 12 }, { text: '회의록 정리' }]);
    refs.resolveTaskCategories.mockResolvedValue({ categoryById: { 11: 'done', 12: 'in_progress' }, failed: false });
    const runsWhenHydrated = [];
    refs.hydrateEditor.mockImplementation((ed) => { runsWhenHydrated.push(ed.runs.length); });
    renderCard({ isMe: true });
    const planNode = cell(PLAN);
    act(() => { carryButton().click(); });
    await settle();

    expect(cell(PLAN)).toBe(planNode);               // 띠가 생겨도 할 일 칸은 같은 노드
    expect(runsWhenHydrated).toEqual([1]);           // 넣은 직후 그 편집기의 칩을 한 번 덧칠한다(스냅숏 배지 방지)
    expect(refs.resolveTaskCategories).toHaveBeenCalledWith([11, 12]);
    const { runs } = cells.editors.get(PLAN);
    expect(runs).toHaveLength(1);
    expect(runs[0].meta).toEqual({ scrumCarryOver: true });   // 이 표시로 '사용자가 고친 변경'과 가른다
    expect(runs[0].focus).toBe('end');
    expect(collectTaskIds(runs[0].content)).toEqual([12]);
    expect(JSON.stringify(runs[0].content)).toContain('회의록 정리');
    expect(notice()).toBe('scrum.carry.doneRemoved');
    expect(button('scrum.carry.undo')).toBeDefined();
    expect(doc.getXmlFragment(PREV).length).toBe(1);         // 전날 칸은 그대로
  });

  it('되돌리기는 편집기 실행 취소이고, 사용자가 칸을 고치면 안내 띠가 닫힌다', async () => {
    write(doc, PREV, '로그인 버그 수정');
    renderCard({ isMe: true });
    act(() => { carryButton().click(); });
    await settle();
    const editor = cells.editors.get(PLAN);
    expect(notice()).toBe('scrum.carry.done');

    act(() => { editor.emitUpdate({ scrumCarryOver: true }); });   // 가져오기 자신의 변경은 닫지 않는다
    expect(band()).not.toBeNull();
    act(() => { button('scrum.carry.undo').click(); });
    expect(editor.commands.undo).toHaveBeenCalledTimes(1);
    expect(band()).toBeNull();

    act(() => { carryButton().click(); });                      // 다시 가져온 뒤 직접 고치면 닫힌다
    await settle();
    expect(band()).not.toBeNull();
    act(() => { editor.emitUpdate(); });
    expect(band()).toBeNull();
  });

  it.each([
    ['실패하면', () => refs.resolveTaskCategories.mockResolvedValue({ categoryById: { 11: 'done' }, failed: true })],
    ['예외로 끝나면', () => refs.resolveTaskCategories.mockRejectedValue(new Error('offline'))],
  ])('상태 조회가 %s 아무것도 빼지 않고 가져온다', async (_, arrange) => {
    writeList(doc, PREV, [{ taskId: 11 }, { text: '회의록 정리' }]);
    arrange();
    renderCard({ isMe: true });
    act(() => { carryButton().click(); });
    await settle();
    const { runs } = cells.editors.get(PLAN);
    expect(runs).toHaveLength(1);
    expect(collectTaskIds(runs[0].content)).toEqual([11]);
    expect(notice()).toBe('scrum.carry.doneUnknown');
  });

  it('전날 할 일이 모두 끝났으면 빈 문서를 넣지 않고 그렇다고 알린다', async () => {
    writeList(doc, PREV, [{ taskId: 11 }]);
    refs.resolveTaskCategories.mockResolvedValue({ categoryById: { 11: 'done' }, failed: false });
    renderCard({ isMe: true });
    act(() => { carryButton().click(); });
    await settle();
    const editor = cells.editors.get(PLAN);
    expect(editor.runs).toHaveLength(0);
    expect(refs.hydrateEditor).not.toHaveBeenCalled();
    expect(notice()).toBe('scrum.carry.nothing');
    expect(button('scrum.carry.undo')).toBeUndefined();
    expect(carryButton()).toBeUndefined();                     // 띠가 버튼 줄을 대신한다
    expect(editor.commands.focus).toHaveBeenCalledWith('end');  // 누른 버튼이 사라지니 포커스는 빈 칸으로
  });

  it('리캡만 있을 때 누르면 할 일 칸이 열리고, 그 편집기가 생기면 한 번만 가져온다', async () => {
    write(doc, PREV, '로그인 버그 수정');
    write(doc, RECAP, '수정 완료');
    renderCard({ isMe: true });
    act(() => { carryButton().click(); });
    await settle();
    expect(cell(PLAN)).not.toBeNull();
    const editor = cells.editors.get(PLAN);
    expect(editor.runs).toHaveLength(1);
    expect(band()).not.toBeNull();

    renderCard({ isMe: true });                       // 다시 그려지거나
    renderCard({ isMe: true, open: false });          // 접었다 펴서 편집기가 새로 생겨도 또 넣지 않는다
    renderCard({ isMe: true });
    await settle();
    expect(cells.editors.get(PLAN)).not.toBe(editor);
    expect(cells.editors.get(PLAN).runs).toHaveLength(0);
    expect(editor.runs).toHaveLength(1);
    expect(refs.resolveTaskCategories).toHaveBeenCalledTimes(1);
    expect(refs.hydrateEditor).toHaveBeenCalledTimes(1);
    expect(band()).toBeNull();                        // 되돌릴 기록이 없는 새 편집기에는 띠도 없다
  });

  it('상태를 묻는 동안 다시 눌러도 한 번만 가져온다', async () => {
    write(doc, PREV, '로그인 버그 수정');
    const held = holdStatus();
    renderCard({ isMe: true });
    act(() => { carryButton().click(); });
    act(() => { carryButton().click(); });
    await act(async () => { held.answer({ categoryById: {}, failed: false }); });
    await settle();
    expect(refs.resolveTaskCategories).toHaveBeenCalledTimes(1);
    expect(cells.editors.get(PLAN).runs).toHaveLength(1);
  });

  it('상태를 묻는 사이 할 일 편집기가 사라지면 넣지 않는다', async () => {
    write(doc, PREV, '로그인 버그 수정');
    const held = holdStatus();
    renderCard({ isMe: true });
    act(() => { carryButton().click(); });
    const editor = cells.editors.get(PLAN);
    renderCard({ isMe: true, open: false });          // 카드를 접으면 칸 편집기가 파괴된다
    await act(async () => { held.answer({ categoryById: {}, failed: false }); });
    await settle();
    expect(editor.isDestroyed).toBe(true);
    expect(editor.runs).toHaveLength(0);
  });

  it('상태를 묻는 사이 누가 이날 할 일 칸에 쓰면 덮어쓰지 않고 안내도 띄우지 않는다', async () => {
    write(doc, PREV, '로그인 버그 수정');
    const held = holdStatus();
    renderCard({ isMe: true });
    act(() => { carryButton().click(); });
    const editor = cells.editors.get(PLAN);
    write(doc, PLAN, '다른 탭에서 쓴 할 일');            // 공유 문서의 내 칸에 그사이 내용이 생겼다
    renderCard({ isMe: true });                       // 문서가 바뀌면 하루 보기가 카드를 다시 그린다
    await act(async () => { held.answer({ categoryById: {}, failed: false }); });
    await settle();
    expect(cells.editors.get(PLAN)).toBe(editor);     // 편집기는 그대로 살아 있다 — 막은 것은 칸 내용 검사
    expect(editor.runs).toHaveLength(0);
    expect(refs.hydrateEditor).not.toHaveBeenCalled();
    expect(band()).toBeNull();
  });

  // 문서 변환·setContent 같은 곳에서 예상 밖 예외가 나도 처리 안 된 reject로 새지 않는다. 맞는 안내 문구가 없어
  // 띠 없이 조용히 끝내고(칸은 그대로), 진행 중 표시를 풀어 다시 누를 수 있게 한다.
  it('가져오기가 예상 밖 예외로 끝나면 칸은 그대로 두고 조용히 끝낸다 — 다시 누를 수 있다', async () => {
    write(doc, PREV, '로그인 버그 수정');
    renderCard({ isMe: true });
    const editor = cells.editors.get(PLAN);
    editor.chain = () => { throw new Error('Invalid content for node doc'); };   // 예: 넣을 문서가 스키마에 맞지 않음
    act(() => { carryButton().click(); });
    await settle();
    expect(editor.runs).toHaveLength(0);
    expect(band()).toBeNull();
    expect(refs.hydrateEditor).not.toHaveBeenCalled();
    expect(carryButton()).toBeDefined();

    act(() => { carryButton().click(); });
    await settle();
    expect(refs.resolveTaskCategories).toHaveBeenCalledTimes(2);
  });
});
