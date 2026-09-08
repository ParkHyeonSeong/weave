// @vitest-environment jsdom
//
// pages/404.js와 pages/500.js를 **실제로 렌더한다.** Next 기본 오류 화면은 영문 고정이라
// 이 두 파일이 없으면 한국어 사용자에게 "This page could not be found"가 그대로 보인다.
// 파일 존재만으로는 부족하고 현재 언어로 문구가 나오는지가 계약이라, 카탈로그 키가 아니라
// 렌더된 텍스트를 en·ko 양쪽에서 고정한다.
//
// 500은 서버가 응답하지 못하는 상황에서 뜨는 화면이라 조회가 없어야 한다 — axios mock이
// 한 번도 불리지 않는 것으로 확인한다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('@/library/_axios', () => ({ axios: { get: vi.fn(), patch: vi.fn(), post: vi.fn() } }));

const push = vi.fn();
vi.mock('next/router', () => ({
  useRouter: () => ({
    push, replace: vi.fn(), prefetch: vi.fn(),
    query: {}, pathname: '/404', asPath: '/404', events: { on: vi.fn(), off: vi.fn() },
  }),
}));
// next/head는 Next 런타임(HeadManager)이 있어야 동작한다. 여기서는 <Head> 자식을 그대로
// 트리에 흘려 title 문자열이 카탈로그에서 나오는지만 본다(실제 문서 제목은 Playwright에서 확인).
vi.mock('next/head', () => ({ default: ({ children }) => children }));

import { axios } from '@/library/_axios';
import { LocaleProvider } from '@/library/locale';
import { LOCALE_STORAGE_KEY } from '@/library/localePrefs';
import NotFoundPage from '@/pages/404';
import ServerErrorPage from '@/pages/500';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let activeRoot = null;

async function mount(Page, locale) {
  // 익명 표시 언어를 심어 두면 LocaleProvider가 그 값을 채택하고 <html lang>까지 맞춘다.
  localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  activeRoot = createRoot(document.getElementById('root'));
  await act(async () => {
    activeRoot.render(<LocaleProvider><Page /></LocaleProvider>);
  });
  await act(async () => {});
}

const text = (sel) => document.querySelector(sel)?.textContent;
const rendered = () => document.getElementById('root').textContent;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  document.documentElement.lang = '';
  document.body.innerHTML = '<div id="root"></div>';
  Object.defineProperty(navigator, 'languages', { value: ['en-US'], configurable: true });
});

afterEach(async () => {
  if (activeRoot) { await act(async () => activeRoot.unmount()); activeRoot = null; }
});

describe('404 — 실제 렌더', () => {
  it('en에서 영어 제목·설명·홈 버튼을 낸다', async () => {
    await mount(NotFoundPage, 'en');

    expect(text('.ErrorPage__Code')).toBe('404');
    expect(text('.ErrorPage__Title')).toBe('Page not found');
    expect(text('.ErrorPage__Message'))
      .toBe('The address may be wrong, or the page may have been moved or removed.');
    expect(text('.ErrorPage__Button')).toBe('Go to home');
    expect(document.documentElement.lang).toBe('en');
  });

  it('ko에서 한국어 제목·설명·홈 버튼을 낸다', async () => {
    await mount(NotFoundPage, 'ko');

    expect(text('.ErrorPage__Code')).toBe('404');
    expect(text('.ErrorPage__Title')).toBe('페이지를 찾을 수 없습니다');
    expect(text('.ErrorPage__Message'))
      .toBe('주소가 잘못되었거나, 페이지가 이동되었거나 삭제되었을 수 있습니다.');
    expect(text('.ErrorPage__Button')).toBe('홈으로 가기');
    expect(document.documentElement.lang).toBe('ko');
  });

  it('홈 버튼은 실제 앵커이고 좌클릭이 홈으로 라우팅한다', async () => {
    await mount(NotFoundPage, 'ko');

    const home = document.querySelector('.ErrorPage__Button');
    expect(home.tagName).toBe('A');
    expect(home.getAttribute('href')).toBe('/');
    await act(async () => { home.click(); });
    expect(push).toHaveBeenCalledWith('/', undefined, expect.anything());
  });
});

describe('500 — 실제 렌더', () => {
  it('en에서 영어 제목·설명과 다시 시도·홈 동작을 낸다', async () => {
    await mount(ServerErrorPage, 'en');

    expect(text('.ErrorPage__Code')).toBe('500');
    expect(text('.ErrorPage__Title')).toBe('Something went wrong on the server');
    expect(text('.ErrorPage__Message')).toBe(
      'We could not complete your request. Please try again in a moment, '
      + 'or contact an administrator if the problem continues.',
    );
    expect(text('.ErrorPage__Button')).toBe('Try again');
    expect(text('.ErrorPage__Link')).toBe('Go to home');
    expect(document.documentElement.lang).toBe('en');
  });

  it('ko에서 한국어 제목·설명과 다시 시도·홈 동작을 낸다', async () => {
    await mount(ServerErrorPage, 'ko');

    expect(text('.ErrorPage__Code')).toBe('500');
    expect(text('.ErrorPage__Title')).toBe('서버에서 문제가 발생했습니다');
    expect(text('.ErrorPage__Message')).toBe(
      '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주시거나, '
      + '문제가 계속되면 관리자에게 문의해 주세요.',
    );
    expect(text('.ErrorPage__Button')).toBe('다시 시도');
    expect(text('.ErrorPage__Link')).toBe('홈으로 가기');
    expect(document.documentElement.lang).toBe('ko');
  });

  it('다시 시도 버튼이 현재 화면을 다시 불러온다', async () => {
    const reload = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', {
      value: { ...original, reload }, writable: true, configurable: true,
    });
    try {
      await mount(ServerErrorPage, 'ko');
      await act(async () => { document.querySelector('.ErrorPage__Button').click(); });
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, 'location', {
        value: original, writable: true, configurable: true,
      });
    }
  });

  it('서버나 API에 의존하지 않는다 — 렌더 중 조회가 없다', async () => {
    await mount(ServerErrorPage, 'ko');

    expect(axios.get).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
    expect(axios.patch).not.toHaveBeenCalled();
  });
});

describe('두 화면 모두 번역 키 원문을 노출하지 않는다', () => {
  it.each([
    ['404', NotFoundPage],
    ['500', ServerErrorPage],
  ])('%s', async (_name, Page) => {
    for (const locale of ['en', 'ko']) {
      await mount(Page, locale);
      expect(rendered()).not.toMatch(/errorPages\.|pageTitles\./);
      expect(rendered().trim().length).toBeGreaterThan(0);
      await act(async () => { activeRoot.unmount(); });
      activeRoot = null;
      document.body.innerHTML = '<div id="root"></div>';
    }
  });
});
