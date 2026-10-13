// @vitest-environment jsdom
//
// 섹션 바로가기 — 클릭 이동은 그 스크롤 영역만, 섹션 머리는 본문 윗변(패널) 또는 sticky 바로가기(전체 상세)
// 아래 8px. 현재 섹션은 클릭 직후 바로 바뀌고 이동이 멈출 때까지 유지되며, 직접 스크롤하면 위치로 다시 고른다.
// jsdom에는 레이아웃이 없어 1440×900 브라우저 실측 좌표로 모형을 세운다:
//   패널   — 바로가기는 헤더 아래 고정 줄(스크롤 영역 밖), 본문 clientHeight 735, scrollHeight 3126
//   전체 상세 — 바로가기는 본문 열 안 sticky(높이 36), __Main clientHeight 824, scrollHeight 2436
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import i18next from '@/library/i18n';
import TaskSectionNav from '@/components/Branch/Tasks/TaskSectionNav';
import { FULL_PAGE_NAV, PANEL_NAV } from '@/library/taskSectionNav';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const NAV_H = 36;
const PANEL = {
  viewH: 735, scrollH: 3126, navInside: false, rootIsScroller: true,
  sections: {
    subtasks: 97, description: 300, details: 1858, pageLinks: 2325,
    issues: 2420, pullRequests: 2522, comments: 2625, activity: 2938,
  },
};
const FULL = {
  viewH: 824, scrollH: 2436, navInside: true, rootIsScroller: false,
  sections: {
    subtasks: 228, description: 447, pageLinks: 1646, issues: 1757,
    pullRequests: 1875, comments: 1994, activity: 2303,
  },
};
const VIEW_TOP = 100;

let state;
let root;
let scroller;
let outer;
const offsetHeightDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() { return this.tagName === 'NAV' ? NAV_H : 0; },
  });
});
afterAll(() => {
  if (offsetHeightDesc) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeightDesc);
});

const rect = (top, height) => ({ top, bottom: top + height, left: 0, right: 419, width: 419, height, x: 0, y: top });

function buildDom(model) {
  outer = document.createElement('div');   // 배경 목록 같은 다른 스크롤러
  outer.scrollTo = vi.fn();
  scroller = document.createElement('div');
  const max = model.scrollH - model.viewH;
  Object.defineProperty(scroller, 'scrollTop', {
    configurable: true,
    get: () => state.scrollTop,
    set: (v) => { state.scrollTop = Math.max(0, Math.min(v, max)); },
  });
  Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => model.viewH });
  Object.defineProperty(scroller, 'scrollHeight', { configurable: true, get: () => model.scrollH });
  scroller.getBoundingClientRect = () => rect(VIEW_TOP, model.viewH);
  // 즉시 이동 + scroll 이벤트(브라우저의 스크롤 한 번)
  scroller.scrollTo = vi.fn(({ top }) => { scroller.scrollTop = top; scroller.dispatchEvent(new Event('scroll')); });

  const sectionRoot = model.rootIsScroller ? scroller : document.createElement('div');
  if (!model.rootIsScroller) scroller.appendChild(sectionRoot);
  const navHost = document.createElement('div');
  if (model.navInside) sectionRoot.appendChild(navHost);   // 전체 상세: 본문 열 안 sticky
  else outer.appendChild(navHost);                          // 패널: 스크롤 영역 밖 고정 줄
  for (const [id, top] of Object.entries(model.sections)) {
    const el = document.createElement('div');
    el.setAttribute('data-task-section', id);
    el.getBoundingClientRect = () => rect(VIEW_TOP + top - state.scrollTop, 60);
    sectionRoot.appendChild(el);
  }
  outer.appendChild(scroller);
  document.body.appendChild(outer);
  return { navHost, sectionRoot };
}

async function mount(nav, model) {
  const { navHost, sectionRoot } = buildDom(model);
  root = createRoot(navHost);
  await act(async () => { root.render(<TaskSectionNav nav={nav} scrollEl={scroller} rootEl={sectionRoot} />); });
}

const navButtons = () => [...document.querySelectorAll('.TaskSectionNav__Item')];
const buttonByText = (text) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === text);
const current = () => document.querySelector('[aria-current="location"]')?.textContent.trim() ?? null;
const scrollTo = async (top) => {
  await act(async () => {
    scroller.scrollTop = top;
    scroller.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(20);   // rAF
  });
};
// detail 0 = 키보드로 누른 click(Enter·Space). 마우스 click은 detail 1
const click = (el, detail = 0) => act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true, detail })); });

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
  state = { scrollTop: 0 };
  window.matchMedia = () => ({ matches: false });
  await i18next.changeLanguage('ko');
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null;
  document.body.replaceChildren();
  vi.useRealTimers();
  await i18next.changeLanguage('en');
});

describe('패널 바로가기 — 헤더 아래 고정 줄', () => {
  it('기본 메뉴는 하위 태스크 · 설명 · 속성 · 댓글 · 더보기, 맨 위에서는 하위 태스크', async () => {
    await mount(PANEL_NAV, PANEL);
    expect(navButtons().map((b) => b.textContent.trim())).toEqual(['하위 태스크', '설명', '속성', '댓글', '더보기']);
    expect(current()).toBe('하위 태스크');
  });

  it('항목을 누르면 그 영역만 스크롤해 섹션 머리를 본문 윗변 8px 아래에 둔다', async () => {
    await mount(PANEL_NAV, PANEL);
    await click(buttonByText('속성'));
    expect(scroller.scrollTo).toHaveBeenCalledWith({ top: 1858 - 8, behavior: 'smooth' });   // 실측 1850
    expect(outer.scrollTo).not.toHaveBeenCalled();
    expect(current()).toBe('속성');
  });

  it('동작 줄이기면 즉시 이동하고, 끝을 넘는 목적지는 끝에서 멈춘다', async () => {
    window.matchMedia = (q) => ({ matches: q === '(prefers-reduced-motion: reduce)' });
    await mount(PANEL_NAV, PANEL);
    await click(buttonByText('댓글'));
    expect(scroller.scrollTo).toHaveBeenCalledWith({ top: 3126 - 735, behavior: 'auto' });   // 실측 2391
  });

  it('짧은 섹션을 눌러 끝에 닿아도 누른 항목을 유지하고, 직접 스크롤하면 위치로 다시 고른다', async () => {
    await mount(PANEL_NAV, PANEL);
    await click(buttonByText('댓글'));
    await act(async () => { vi.advanceTimersByTime(400); });   // 이동이 멈추고 잠금 해제
    expect(current()).toBe('댓글');   // 끝에서는 원래 '활동'이 고르지만 누른 항목이 이긴다
    await scrollTo(1800);
    expect(current()).toBe('속성');   // 1858 − 1800 = 58 ≤ 기준선 160
  });

  it('스크롤할 거리가 없는 짧은 태스크는 맨 위 섹션이 현재 섹션이다(끝 규칙을 쓰지 않는다)', async () => {
    const SHORT = {
      viewH: 735, scrollH: 735, navInside: false, rootIsScroller: true,
      sections: { subtasks: 97, description: 300, details: 380, pageLinks: 520, issues: 580, pullRequests: 630, comments: 680, activity: 720 },
    };
    await mount(PANEL_NAV, SHORT);
    expect(current()).toBe('하위 태스크');
    expect(document.querySelector('.TaskSectionNav__MoreBtn').textContent.trim()).toBe('더보기');
  });

  it('끝까지 직접 내리면 마지막 섹션(활동)이 더보기 자리에 보인다', async () => {
    await mount(PANEL_NAV, PANEL);
    await scrollTo(PANEL.scrollH - PANEL.viewH);
    const more = document.querySelector('.TaskSectionNav__MoreBtn');
    expect(more.textContent.trim()).toBe('활동');
    expect(more.className).toContain('TaskSectionNav__Item--active');
    expect(more.getAttribute('aria-label')).toBe('더보기 — 현재 활동');
  });

  it('더보기에는 실제로 렌더된 섹션만 — 의존성이 없으면 메뉴에도 없다', async () => {
    await mount(PANEL_NAV, PANEL);
    await click(document.querySelector('.TaskSectionNav__MoreBtn'));
    const items = [...document.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent.trim());
    expect(items).toEqual(['연결 문서', '이슈', 'PR', '활동']);
  });

  it('의존성이 렌더돼 있으면 더보기에서 그 섹션으로 간다', async () => {
    await mount(PANEL_NAV, { ...PANEL, sections: { ...PANEL.sections, dependencies: 2300 } });
    await click(document.querySelector('.TaskSectionNav__MoreBtn'));
    await click(buttonByText('의존성'));
    expect(scroller.scrollTo).toHaveBeenLastCalledWith({ top: 2300 - 8, behavior: 'smooth' });
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it('키보드로 연 메뉴는 첫 항목으로 포커스, Escape는 닫고 트리거로 돌린다', async () => {
    await mount(PANEL_NAV, PANEL);
    const trigger = document.querySelector('.TaskSectionNav__MoreBtn');
    await click(trigger, 0);
    const menu = document.querySelector('[role="menu"]');
    expect(document.activeElement).toBe(menu.querySelector('[role="menuitem"]'));
    await act(async () => { menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('마우스로 연 더보기는 포커스를 옮기지 않는다(편집 중인 입력기 유지)', async () => {
    await mount(PANEL_NAV, PANEL);
    const editor = document.createElement('textarea');
    document.body.appendChild(editor);
    editor.focus();
    const trigger = document.querySelector('.TaskSectionNav__MoreBtn');
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    trigger.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    await click(trigger, 1);
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    expect(document.activeElement).toBe(editor);
  });

  it('항목의 마우스 누름은 포커스를 빼앗지 않는다(설명 편집기 blur 저장 방지)', async () => {
    await mount(PANEL_NAV, PANEL);
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    buttonByText('댓글').dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
  });

  it('언마운트하면 scroll 리스너를 떼어 이전 대상이 남지 않는다', async () => {
    await mount(PANEL_NAV, PANEL);
    const removed = vi.spyOn(scroller, 'removeEventListener');
    await act(async () => root.unmount());
    root = null;
    expect(removed).toHaveBeenCalledWith('scroll', expect.any(Function));
  });
});

describe('전체 상세 바로가기 — 본문 열 안 sticky, 연결 4종은 한 항목', () => {
  it('메뉴에 속성이 없고, 연결은 렌더된 첫 연결 섹션 머리를 바로가기 아래 8px에 둔다', async () => {
    await mount(FULL_PAGE_NAV, FULL);
    expect(navButtons().map((b) => b.textContent.trim())).toEqual(['하위 태스크', '설명', '연결', '댓글', '활동']);
    await click(buttonByText('연결'));
    expect(scroller.scrollTo).toHaveBeenCalledWith({ top: 1646 - NAV_H - 8, behavior: 'smooth' });   // 실측 1602
  });

  it('연결 묶음 안을 읽는 동안 연결이 현재 항목', async () => {
    await mount(FULL_PAGE_NAV, FULL);
    await scrollTo(1550);   // 연결 문서 머리 96 ≤ 기준선 196 < 이슈 머리 207
    expect(current()).toBe('연결');
  });
});
