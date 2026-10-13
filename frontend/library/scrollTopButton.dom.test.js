// @vitest-environment jsdom
//
// 맨 위로 버튼 — 영역 높이의 절반 이상 내려왔을 때만 보이고, 그 영역만 맨 위로 올린다.
// 글을 입력하는 중(댓글·설명 편집기 포커스)에는 숨기고, 입력기·하단 작업 버튼(data-scroll-top-avoid)이
// 버튼 자리에 오면 숨는다. 다시 나타나는 것은 스크롤 때만이다(누르는 도중 그 자리에 나타나 클릭을 가로채지 않게).
// 전체 상세·Canvas는 RefPanelPageLayout이 본문 스크롤 영역(__Main)에 버튼을 붙인다(라우트가 켤 때만).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'sass';
import postcss from 'postcss';

vi.mock('@/components/shared/RefPanelHost', () => ({ default: () => null, useRefPreview: () => [null, () => {}] }));

import i18next from '@/library/i18n';
import ScrollTopButton from '@/components/common/ScrollTopButton';
import RefPanelPageLayout from '@/components/shared/RefPanelPageLayout';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root;
let state;

function makeScroller(clientHeight) {
  const el = document.createElement('div');
  Object.defineProperty(el, 'scrollTop', { configurable: true, get: () => state.scrollTop, set: (v) => { state.scrollTop = v; } });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => clientHeight });
  el.scrollTo = vi.fn(({ top }) => { el.scrollTop = top; el.dispatchEvent(new Event('scroll')); });
  return el;
}
const frame = () => act(async () => { vi.advanceTimersByTime(20); });
const scrollTo = async (el, top) => {
  await act(async () => { el.scrollTop = top; el.dispatchEvent(new Event('scroll')); });
  await frame();
};
// 보이는 버튼만 — 숨김 중에도 자리를 재려고 DOM에는 남아 있다(ScrollTopButton--hidden)
const fab = () => document.querySelector('.ScrollTopButton:not(.ScrollTopButton--hidden)');

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

describe('ScrollTopButton', () => {
  let region;
  let scroller;
  let outer;
  async function mount(clientHeight = 735) {
    outer = makeScroller(900);                 // 배경 목록 같은 다른 스크롤러
    region = document.createElement('div');    // 패널(위치 기준)
    scroller = makeScroller(clientHeight);     // 패널 본문
    const host = document.createElement('div');
    region.append(scroller, host);
    outer.appendChild(region);
    document.body.appendChild(outer);
    root = createRoot(host);
    await act(async () => { root.render(<ScrollTopButton scrollEl={scroller} regionEl={region} />); });
  }

  it('맨 위·절반 미만에서는 없고, 절반(368px) 이상이면 "맨 위로"가 보인다', async () => {
    await mount();
    expect(fab()).toBeNull();
    await scrollTo(scroller, 367);
    expect(fab()).toBeNull();
    await scrollTo(scroller, 368);
    expect(fab().textContent).toBe('맨 위로');
  });

  it('누르면 그 영역만 맨 위로 — 다른 스크롤러는 그대로', async () => {
    await mount();
    await scrollTo(scroller, 1200);
    await act(async () => { fab().dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(scroller.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    expect(outer.scrollTo).not.toHaveBeenCalled();
    await frame();
    expect(fab()).toBeNull();   // 맨 위에 오면 숨는다
  });

  it('동작 줄이기면 즉시 이동', async () => {
    window.matchMedia = (q) => ({ matches: q === '(prefers-reduced-motion: reduce)' });
    await mount();
    await scrollTo(scroller, 1200);
    await act(async () => { fab().dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(scroller.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
  });

  it('글을 입력하는 동안은 숨기고, 입력기에서 등록 버튼으로 포커스가 옮겨 가도 다음 스크롤 전에는 나타나지 않는다', async () => {
    await mount();
    const textarea = document.createElement('textarea');
    const submit = document.createElement('button');
    scroller.append(textarea, submit);
    await scrollTo(scroller, 1200);
    expect(fab()).not.toBeNull();
    await act(async () => { textarea.focus(); });
    await frame();
    expect(fab()).toBeNull();
    // 등록 버튼을 누르는 도중(누름 → 포커스 이동 → 뗌): 그사이 그 자리에 나타나면 뗌이 맨 위로에 떨어진다
    await act(async () => { submit.focus(); });
    await frame();
    expect(fab()).toBeNull();
    await scrollTo(scroller, 1210);
    expect(fab()).not.toBeNull();
  });

  it('입력기·하단 작업 버튼이 버튼 자리에 오면 숨기고(누를 수도 포커스할 수도 없다), 비켜나면 스크롤 때 다시 보인다', async () => {
    await mount();
    const composer = document.createElement('div');
    composer.setAttribute('data-scroll-top-avoid', '');
    scroller.appendChild(composer);
    const rect = (top) => ({ left: 0, right: 400, top, bottom: top + 120, width: 400, height: 120 });
    let composerTop = 680;   // 버튼 자리(700~736)와 겹친다
    composer.getBoundingClientRect = () => rect(composerTop);
    document.querySelector('.ScrollTopButton').getBoundingClientRect = () => ({ left: 290, right: 400, top: 700, bottom: 736, width: 110, height: 36 });
    await scrollTo(scroller, 1200);
    expect(fab()).toBeNull();
    const hidden = document.querySelector('.ScrollTopButton');
    expect(hidden.getAttribute('aria-hidden')).toBe('true');
    expect(hidden.tabIndex).toBe(-1);
    composerTop = 300;       // 위로 비켜났다
    await scrollTo(scroller, 1300);
    expect(fab()).not.toBeNull();
    expect(fab().getAttribute('aria-hidden')).toBeNull();
  });

  it('마우스 누름은 포커스를 빼앗지 않는다', async () => {
    await mount();
    await scrollTo(scroller, 1200);
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    fab().dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
  });

  it('키보드로 누르면 영역 맨 앞 조작 요소로 포커스를 옮긴다', async () => {
    await mount();
    const first = document.createElement('button');
    scroller.appendChild(first);
    await scrollTo(scroller, 1200);
    fab().focus();
    await act(async () => { fab().dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(document.activeElement).toBe(first);
  });
});

describe('RefPanelPageLayout — 라우트가 켤 때만 본문 영역 버튼', () => {
  async function render(props) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root.render(<RefPanelPageLayout {...props}><p>본문</p></RefPanelPageLayout>); });
  }
  async function scrollMain(top) {
    const main = document.querySelector('.RefPanelPageLayout__Main');
    Object.defineProperty(main, 'clientHeight', { configurable: true, get: () => 824 });
    Object.defineProperty(main, 'scrollTop', { configurable: true, get: () => top });
    await act(async () => { main.dispatchEvent(new Event('scroll')); });
    await frame();
  }
  it('켜지 않으면 버튼이 없다(이슈 라우트)', async () => {
    await render({});
    await scrollMain(900);
    expect(document.querySelector('.ScrollTopButton')).toBeNull();   // 숨은 버튼도 없다
  });
  it('켜면 __MainWrap에 붙고 본문 영역 절반(412px)부터 보인다', async () => {
    await render({ scrollTopButton: true });
    await scrollMain(411);
    expect(fab()).toBeNull();
    await scrollMain(412);
    expect(fab().parentElement.className).toBe('RefPanelPageLayout__MainWrap');
  });
});

// 전체 상세를 끝까지 내리면 마지막 행이 영역 바닥 여백 위에 놓인다. 휴대폰은 세부 사항이 본문 아래로 쌓여
// 그 마지막 행(커스텀 필드 선택칸 등)의 오른쪽 조작부가 버튼 자리에 온다 — 끝 여백이 버튼 자리(아래 간격 + 높이)
// 위로 8px를 더 비워야 그 조작부를 눌러도 맨 위로 가지 않는다.
describe('전체 상세 — 휴대폰 끝 여백이 맨 위로 버튼 자리를 비운다', () => {
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  // px 숫자 — 규칙이 없거나 px가 아니면(calc·env) 어느 값인지 밝히고 실패한다
  const px = (label, v) => {
    const n = Number(String(v).replace(/px$/, ''));
    expect(Number.isFinite(n), `${label}: px 값이 아니다(${v})`).toBe(true);
    return n;
  };
  // 컴파일한 CSS에서 선택자 하나의 선언을 소스 순서대로 — media가 null이면 미디어 쿼리 밖 규칙만
  function decls(file, selector, media) {
    const out = [];
    postcss.parse(compile(resolve(ROOT, file)).css).walkRules((rule) => {
      const params = rule.parent.type === 'atrule' ? rule.parent.params : null;
      if (rule.selector !== selector || params !== media) return;
      rule.walkDecls((d) => { out.push([d.prop, d.value]); });
    });
    return out;
  }
  const last = (list, prop) => list.filter(([p]) => p === prop).pop()?.[1];
  // 아래 여백 — 뒤에 오는 선언이 이긴다(padding 축약형은 값이 셋 이상이면 세 번째, 아니면 첫 번째가 아래)
  const bottomOf = (list) => list.reduce((bottom, [prop, value]) => {
    if (prop === 'padding-bottom') return value;
    if (prop !== 'padding') return bottom;
    const parts = value.trim().split(/\s+/);
    return parts.length > 2 ? parts[2] : parts[0];
  }, undefined);

  it('끝 여백 ≥ 버튼 아래 간격 + 높이 + 8px', () => {
    const btn = decls('styles/components/common/scrollTopButton.scss', '.ScrollTopButton', null);
    const mobile = decls('styles/components/branch/taskFullPage.scss', '.TaskFullPage', '(max-width: 767px)');
    const need = px('버튼 bottom', last(btn, 'bottom')) + px('버튼 height', last(btn, 'height')) + 8;
    expect(px('휴대폰 .TaskFullPage 아래 여백', bottomOf(mobile))).toBeGreaterThanOrEqual(need);
  });
});
