// @vitest-environment jsdom
//
// 회고 보기(RetroView, 스펙 §6.5·§8): 머리(마감 칩·작성 현황)와 항목별·사람별 배치.
// 칸 편집기(ScrumCell)는 가짜로 바꿔 "어느 fragment 키의 칸이 어디에 그려지는가"와 다시 그려진 횟수만 본다.
// 회고 협업 훅은 테스트의 Y.Doc과 가짜 provider를 그대로 돌려주는 가짜, 워크스페이스 날짜는 오늘을 고정한 가짜다.
// provider는 기본으로 이미 동기화된 것 — 첫 동기화 전 화면은 '첫 동기화 전' 묶음에서만 본다.
// 칸 내용은 실제 Y.Doc에 넣는다(scrumDayCard 테스트와 같은 방식).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import * as Y from 'yjs';

let testDoc;
let testProvider;
const cellRenders = new Map();   // fragmentKey → 그 칸(가짜 편집기)이 그려진 횟수
const views = vi.hoisted(() => ({ renders: 0 }));   // RetroView가 그려진 횟수(그릴 때마다 회고 협업 훅을 부른다)
const dates = vi.hoisted(() => ({ today: '2026-11-04' }));
// 보간 값도 글자에 붙인다 — 열 머리의 수·아바타 이름표를 확인한다
const i18n = vi.hoisted(() => ({ t: vi.fn((key, o) => (o ? `${key}${JSON.stringify(o)}` : key)) }));

vi.mock('@/library/useScrumRetroCollab', () => ({
  default: () => {
    views.renders += 1;
    return { ydoc: testDoc, provider: testProvider, connection: 'connected', pending: false };
  },
}));
vi.mock('@/hooks/useDateFormat', () => ({
  useWorkspaceDateFormat: () => ({
    today: () => dates.today,
    formatDateOnly: (d) => d,
    formatDateOnlyRange: (a, b) => `${a} – ${b}`,
  }),
}));
vi.mock('@/components/Scrum/ScrumCell', () => ({
  default: function FakeCell({ fragmentKey, editable }) {
    cellRenders.set(fragmentKey, (cellRenders.get(fragmentKey) || 0) + 1);
    return <div data-cell={fragmentKey} data-editable={String(editable !== false)} />;
  },
}));
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal()),
  useTranslation: () => ({ t: i18n.t, i18n: { language: 'ko' } }),
}));
vi.mock('@/library/_axios', () => ({ getBaseURL: () => '' }));

import RetroView from '@/components/Scrum/RetroView';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// 1번이 나(보드뷰가 본인을 맨 위로 정렬해 넘긴다)
const MEMBERS = [
  { user_id: 1, username: '박현성' },
  { user_id: 2, username: '이서연' },
  { user_id: 3, username: '김도윤' },
];
const RETRO = { retro_id: 9, period_start: '2026-10-26', period_end: '2026-11-06' };
const KEEP = 'scrum.retro.colKeep';
const PROBLEM = 'scrum.retro.colProblem';
const TRY = 'scrum.retro.colTry';

// 연결되지 않은 Y 타입은 읽을 수 없으므로, 부모에 먼저 붙인 뒤 자식을 채운다.
function attach(parent, node) {
  parent.insert(parent.length, [node]);
  return node;
}
function write(doc, key, s) {
  const p = attach(doc.getXmlFragment(key), new Y.XmlElement('paragraph'));
  attach(p, new Y.XmlText(s));
}

// y-websocket provider 흉내 — synced와 'sync' 이벤트만 쓴다(useCollabEditBase 테스트와 같은 모양)
function makeProvider(synced) {
  const handlers = new Set();
  const provider = {
    synced,
    on: (event, fn) => { if (event === 'sync') handlers.add(fn); },
    off: (event, fn) => { if (event === 'sync') handlers.delete(fn); },
    emitSync() { provider.synced = true; [...handlers].forEach((fn) => fn(true)); },
  };
  return provider;
}

let root;
let container;

// 같은 MEMBERS·RETRO 객체를 넘긴다 — 보드뷰처럼 props가 같으면 다시 그리지 않는지도 본다
function renderRetro(props = {}) {
  act(() => {
    root.render(
      <RetroView boardId={4} members={MEMBERS} retro={RETRO} manual={false} view="topic" meId={1} isCurrent {...props} />,
    );
  });
}
// 회고 문서가 바뀐 뒤 한 프레임(useYDocRevision이 묶는 단위)을 기다린다
const nextFrame = () => act(async () => { await new Promise((r) => { requestAnimationFrame(() => r()); }); });

const cell = (key) => container.querySelector(`[data-cell="${key}"]`);
const cellKeys = (el) => [...el.querySelectorAll('[data-cell]')].map((n) => n.dataset.cell);
// 항목별 열 = 그 열 이름을 제목(h3)으로 가진 section
const column = (labelKey) => [...container.querySelectorAll('h3')].find((h) => h.textContent === labelKey)?.closest('section');
// 열 아래 '아직 안 쓴 사람' 한 줄과 그 안의 아바타 이름
const notYetRow = (col) => [...col.querySelectorAll('*')]
  .find((el) => el.children.length === 0 && el.textContent === 'scrum.retro.notYet')?.parentElement ?? null;
const avatarNames = (el) => [...el.querySelectorAll('[role="img"]')].map((n) => n.getAttribute('aria-label'));
// 머리의 작성 현황 아바타 이름표(쓴 사람·안 쓴 사람)
const roster = () => [...container.querySelectorAll('[role="img"]')]
  .map((n) => n.getAttribute('aria-label'))
  .filter((label) => label.startsWith('scrum.retro.roster'));
// 화면·보조기기에 드러나는 글자 — aria-hidden 자리 표시(첫 동기화 전에 자리만 지키는 판단 줄)는 뺀다
const exposedText = () => {
  const clone = container.cloneNode(true);
  clone.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
  return clone.textContent;
};

beforeEach(() => {
  testDoc = new Y.Doc();
  testProvider = makeProvider(true);
  cellRenders.clear();
  views.renders = 0;
  dates.today = '2026-11-04';
  i18n.t.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  document.body.innerHTML = '';
  testDoc.destroy();
});

describe('회고 항목별 보기', () => {
  it('항목별: 각 열에 내 블록은 항상, 남은 쓴 사람만', () => {
    write(testDoc, '2:keep', '디자인 QA를 매일 짧게 돌려서 수정 비용이 줄었음');
    renderRetro();
    expect(cellKeys(column(KEEP))).toEqual(['1:keep', '2:keep']);   // 내 블록이 맨 위, 안 쓴 3번은 없다
    expect(cellKeys(column(PROBLEM))).toEqual(['1:problem']);       // 아무도 안 쓴 열에도 내 블록(빈 편집기)은 있다
    expect(cellKeys(column(TRY))).toEqual(['1:try']);
    expect(cell('1:problem').dataset.editable).toBe('true');
    expect(column(KEEP).textContent).toContain('scrum.retro.colWriters{"count":1}');
    expect(column(PROBLEM).textContent).toContain('scrum.retro.colWriters{"count":0}');
  });

  it('항목별: 안 쓴 사람은 열 아래 한 줄', async () => {
    write(testDoc, '2:keep', '디자인 QA를 매일 짧게 돌려서 수정 비용이 줄었음');
    write(testDoc, '3:try', '마이그레이션 PR은 오전에 올리기');
    renderRetro();
    // 나는 내 블록이 늘 있으니 빠지고, 그 열에 쓴 사람도 빠진다
    expect(avatarNames(notYetRow(column(KEEP)))).toEqual(['김도윤']);
    expect(avatarNames(notYetRow(column(PROBLEM)))).toEqual(['이서연', '김도윤']);
    expect(avatarNames(notYetRow(column(TRY)))).toEqual(['이서연']);
    expect(notYetRow(column(KEEP)).querySelector('[data-cell]')).toBeNull();   // 이름만 — 편집기는 없다

    write(testDoc, '3:keep', '회귀 케이스를 미리 정리해 둠');                  // 모두 쓴 열에는 그 줄이 없다
    await nextFrame();
    expect(notYetRow(column(KEEP))).toBeNull();
  });

  it('남의 블록은 고치다가 비워도 그 자리에 남는다', async () => {
    write(testDoc, '2:keep', '디자인 QA를 매일 짧게 돌려서 수정 비용이 줄었음');
    renderRetro();
    const theirs = cell('2:keep');
    act(() => { theirs.dispatchEvent(new FocusEvent('focusin', { bubbles: true })); });   // 그 칸 편집기에 들어감
    const frag = testDoc.getXmlFragment('2:keep');
    frag.delete(0, frag.length);
    await nextFrame();
    expect(cell('2:keep')).toBe(theirs);                                    // 쓰던 편집기가 사라지지 않는다
    expect(column(KEEP).textContent).toContain('scrum.retro.colWriters{"count":0}');
    expect(avatarNames(notYetRow(column(KEEP)))).toEqual(['김도윤']);       // 보이는 블록의 주인은 '안 쓴 사람'에 겹쳐 나오지 않는다
  });
});

describe('회고 사람별 보기', () => {
  it('사람별: 모든 사람 × 세 칸', () => {
    write(testDoc, '2:keep', '디자인 QA를 매일 짧게 돌려서 수정 비용이 줄었음');
    renderRetro({ view: 'person' });
    expect(container.querySelectorAll('[data-cell]')).toHaveLength(MEMBERS.length * 3);
    expect(cellKeys(container)).toEqual([
      '1:keep', '1:problem', '1:try',
      '2:keep', '2:problem', '2:try',
      '3:keep', '3:problem', '3:try',
    ]);
    expect(column(KEEP)).toBeUndefined();   // 항목별 열은 그리지 않는다
  });
});

describe('회고 머리', () => {
  it('마감 칩: 현재 회고면 남은 날, 아니면 없음', () => {
    renderRetro({ isCurrent: true });
    expect(container.textContent).toContain('scrum.retro.deadlineRemaining');
    expect(i18n.t).toHaveBeenCalledWith('scrum.retro.deadlineRemaining', { date: '2026-11-06', count: 2 });

    renderRetro({ isCurrent: false });
    expect(container.textContent).not.toContain('scrum.retro.deadline');
  });

  it.each([
    ['마감일이 오늘이면 오늘 마감', '2026-11-06', 'scrum.retro.deadlineToday'],
    ['마감일이 지났으면(주말) 마감 지남', '2026-11-07', 'scrum.retro.deadlinePassed'],
  ])('마감 칩: %s', (_, today, key) => {
    dates.today = today;
    renderRetro();
    expect(container.textContent).toContain(key);
    expect(i18n.t).toHaveBeenCalledWith(key, { date: '2026-11-06' });
  });

  it('마감 칩: 워크스페이스 오늘을 아직 모르면 없음', () => {
    dates.today = null;
    renderRetro();
    expect(container.textContent).not.toContain('scrum.retro.deadline');
  });

  it('작성 현황: 세 칸 중 하나라도 쓴 사람은 작성함, 아니면 작성 전', () => {
    write(testDoc, '2:try', '정렬·필터 작업은 테스트 케이스부터 쓰기');
    renderRetro();
    expect(roster()).toEqual([
      'scrum.retro.rosterEmpty{"name":"박현성"}',
      'scrum.retro.rosterWritten{"name":"이서연"}',
      'scrum.retro.rosterEmpty{"name":"김도윤"}',
    ]);
    expect(container.textContent).toContain('scrum.retro.writtenSummary{"total":3,"written":1}');
    expect(container.textContent).toContain(`${RETRO.period_start} – ${RETRO.period_end}`);   // 기간 제목
  });

  it('수동 주기 보드는 안내만 보인다', () => {
    renderRetro({ retro: null, manual: true });
    expect(container.textContent).toBe('scrum.retro.manualNotice');
    expect(container.querySelector('[data-cell]')).toBeNull();
  });
});

// 회고 문서는 방에 들어간 직후 비어 있다 — 서버 문서(첫 동기화)가 오기 전에는 누가 썼는지 말하지 않는다.
// 칸 편집기는 그대로 두어, 동기화 뒤에도 같은 노드다(쓰던 내용·포커스 유지).
describe('첫 동기화 전', () => {
  it('항목별: 작성 현황·열 머리 수·아직 안 쓴 사람을 말하지 않다가, 동기화되면 그 렌더에서 바로 맞게 보인다', () => {
    testProvider = makeProvider(false);
    renderRetro();
    // 요약 줄·열 머리 수는 자리만 지키고 숨긴다(.is-pending = CSS visibility:hidden, aria-hidden) — 동기화 때 머리가 밀리지 않게
    const summary = container.querySelector('.RetroView__Summary');
    const keepCount = column(KEEP).querySelector('.RetroTopic__ColCount');
    for (const placeholder of [summary, keepCount]) {
      expect(placeholder.getAttribute('aria-hidden')).toBe('true');
      expect(placeholder.classList.contains('is-pending')).toBe(true);
    }
    expect(exposedText()).not.toContain('scrum.retro.writtenSummary');
    expect(exposedText()).not.toContain('scrum.retro.colWriters');
    expect(container.textContent).not.toContain('scrum.retro.notYet');
    expect(roster()).toEqual([]);                                          // 얼굴은 이름만 — ✓·흐림 없음
    expect(avatarNames(container.querySelector('.RetroView__RosterList'))).toEqual(['박현성', '이서연', '김도윤']);
    expect(container.querySelector('.RetroView__Face--faded')).toBeNull();
    const mine = cell('1:keep');
    expect(mine).not.toBeNull();                                           // 내 블록(편집기)은 그대로 쓸 수 있다

    // 서버 문서가 들어온 직후 sync — 문서 변경 신호(다음 프레임)보다 먼저 다시 그려져도 동기화 전에 센 값을 쓰지 않는다
    write(testDoc, '2:keep', '디자인 QA를 매일 짧게 돌려서 수정 비용이 줄었음');
    act(() => { testProvider.emitSync(); });
    expect(container.querySelector('.RetroView__Summary')).toBe(summary);  // 지키던 자리(같은 노드)가 그대로 보이게 된다
    expect(column(KEEP).querySelector('.RetroTopic__ColCount')).toBe(keepCount);
    for (const shown of [summary, keepCount]) {
      expect(shown.hasAttribute('aria-hidden')).toBe(false);
      expect(shown.classList.contains('is-pending')).toBe(false);
    }
    expect(summary.textContent).toBe('scrum.retro.writtenSummary{"total":3,"written":1}');
    expect(keepCount.textContent).toBe('scrum.retro.colWriters{"count":1}');
    expect(avatarNames(notYetRow(column(KEEP)))).toEqual(['김도윤']);
    expect(roster()).toEqual([
      'scrum.retro.rosterEmpty{"name":"박현성"}',
      'scrum.retro.rosterWritten{"name":"이서연"}',
      'scrum.retro.rosterEmpty{"name":"김도윤"}',
    ]);
    expect(cell('1:keep')).toBe(mine);
  });

  it('사람별: 카드 머리의 작성함/작성 전은 동기화 뒤에만 — 세 칸 편집기는 처음부터 있다', () => {
    testProvider = makeProvider(false);
    renderRetro({ view: 'person' });
    expect(container.textContent).not.toContain('scrum.day.statusEmpty');
    expect(container.textContent).not.toContain('scrum.day.statusWritten');
    expect(container.querySelectorAll('[data-cell]')).toHaveLength(MEMBERS.length * 3);

    act(() => { testProvider.emitSync(); });
    expect(container.textContent).toContain('scrum.day.statusEmpty');
  });
});

// 보드 화면은 접속자(presence)가 바뀔 때마다 다시 그려진다. 회고 칸 편집기까지 내려가면 안 된다.
describe('다시 그리기', () => {
  it('문서가 바뀌면 열·작성 현황을 다시 세고, 이미 있는 칸 편집기는 다시 그리지 않는다', async () => {
    write(testDoc, '3:keep', '회귀 케이스를 미리 정리해 둠');
    renderRetro();
    const mine = cell('1:keep');
    const theirs = cell('3:keep');
    expect(roster()).toContain('scrum.retro.rosterEmpty{"name":"이서연"}');

    write(testDoc, '2:keep', '디자인 QA를 매일 짧게 돌려서 수정 비용이 줄었음');   // 2번 블록이 3번 블록 앞에 끼어든다
    await nextFrame();
    expect(cellKeys(column(KEEP))).toEqual(['1:keep', '2:keep', '3:keep']);
    expect(notYetRow(column(KEEP))).toBeNull();
    expect(column(KEEP).textContent).toContain('scrum.retro.colWriters{"count":2}');
    expect(roster()).toContain('scrum.retro.rosterWritten{"name":"이서연"}');
    expect(cell('1:keep')).toBe(mine);                    // 있던 편집기는 같은 노드(실행 취소 기록·포커스 유지)
    expect(cell('3:keep')).toBe(theirs);
    expect(cellRenders.get('1:keep')).toBe(1);            // 다시 그리지도 않는다
    expect(cellRenders.get('3:keep')).toBe(1);

    const viewRenders = views.renders;
    renderRetro();                                        // 같은 props로 다시 그려도(보드 화면의 접속자 갱신)
    expect(views.renders).toBe(viewRenders);              // 회고 화면에서 멈춘다
    expect([...cellRenders.values()]).toEqual([1, 1, 1, 1, 1]);   // 1:keep·problem·try, 3:keep, 2:keep — 전부 한 번씩
  });
});
