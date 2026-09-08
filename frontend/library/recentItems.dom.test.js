// @vitest-environment jsdom
//
// RecentItems를 **실제로 렌더한다.** hookImports.test.js는 소스에서 use*() 호출이
// import되었는지만 보는 정적 스캔이라, 훅이 잘못된 인자로 불리거나 반환값을 잘못 쓰는
// 종류의 런타임 오류는 못 잡는다. 이 위젯은 프리렌더 대상도 아니고(로그인 후 홈)
// 지금까지 렌더 테스트가 없어서 `useDateFormat is not defined`가 실사용까지 새어나갔다.
//
// 그래서 로딩 → API 응답 → 목록 전환과 formatRelative 결과가 화면에 실제로 찍히는
// 경로를 통과시킨다. import를 다시 지우면 렌더가 던져 이 테스트가 RED가 된다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('@/library/_axios', () => ({ axios: { get: vi.fn(), patch: vi.fn() } }));
// NavLink가 next/router를 쓴다 — 라우팅은 이 테스트의 관심사가 아니라 최소 스텁만 둔다.
vi.mock('next/router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(),
    query: {}, pathname: '/', asPath: '/', events: { on: vi.fn(), off: vi.fn() } }),
}));
import { axios } from '@/library/_axios';

import { UiPrefsProvider } from '@/library/UiPrefsContext';
import { LocaleProvider, LocaleServerSync } from '@/library/locale';
import i18next from '@/library/i18n';
import RecentItems from '@/components/Home/DashboardWidgets/RecentItems';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let activeRoot = null;

// 개인 시간대는 America/New_York, 서버 언어는 테스트마다 지정한다.
const PREFS = (locale) => ({
  status: true,
  ui_prefs: { language_region: { locale, time_zone: 'America/New_York' } },
});

const HOUR = 3600 * 1000;

function recentPayload(now) {
  return {
    status: true,
    items: [
      { type: 'task', task_id: 1, display_number: 'WV-1', title: 'Ship it',
        branch_id: 7, status_category: 'todo', status_color: '#9CA3AF',
        viewed_at: new Date(now - 2 * HOUR).toISOString() },
      { type: 'doc', page_id: 5, title: 'Spec', canvas_id: 3, canvas_name: 'Docs',
        viewed_at: new Date(now - 30 * HOUR).toISOString() },
    ],
  };
}

async function mount(locale) {
  activeRoot = createRoot(document.getElementById('root'));
  await act(async () => {
    activeRoot.render(
      <LocaleProvider>
        <UiPrefsProvider fetchEnabled>
          <LocaleServerSync />
          <RecentItems />
        </UiPrefsProvider>
      </LocaleProvider>,
    );
  });
  await act(async () => {});
  await act(async () => {});
}

const times = () => [...document.querySelectorAll('.RecentItems__TaskTime')].map((e) => e.textContent);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  document.body.innerHTML = '<div id="root"></div>';
  Object.defineProperty(navigator, 'languages', { value: ['en-US'], configurable: true });
});

afterEach(async () => {
  if (activeRoot) { await act(async () => activeRoot.unmount()); activeRoot = null; }
});

describe('RecentItems — 실제 렌더', () => {
  it('로딩 상태에서 API 응답 후 목록으로 전환되고 상대시간이 찍힌다', async () => {
    const now = Date.now();
    let resolveRecent;
    axios.get.mockImplementation((url) => {
      if (url === '/profile/ui-prefs') return Promise.resolve({ data: PREFS('en') });
      return new Promise((res) => { resolveRecent = () => res({ data: recentPayload(now) }); });
    });
    await i18next.changeLanguage('en');
    await mount('en');

    // 1) 로딩 화면
    expect(document.querySelector('.Widget__Empty').textContent).toBe('Loading…');
    expect(document.querySelector('.RecentItems__List')).toBeNull();

    // 2) 응답 후 목록
    await act(async () => { resolveRecent(); });
    await act(async () => {});
    expect(document.querySelector('.RecentItems__List')).toBeTruthy();
    expect([...document.querySelectorAll('.RecentItems__TaskTitle')].map((e) => e.textContent))
      .toEqual(['Ship it', 'Spec']);

    // 3) formatRelative 결과가 실제로 화면에 있다 — 훅이 안 불리면 여기까지 오지 못한다.
    //    2시간 전은 지금 시각과 무관하게 고정이고, 30시간 전은 개인 시간대(New York)의
    //    달력 날짜로 '어제'인지 '1일 전'인지 갈리므로 둘 다 허용한다(둘 다 locale 표기다).
    expect(times()[0]).toBe('2 hours ago');
    expect(times()[1]).toMatch(/^(yesterday|1 day ago)$/);
    expect(times().every((s) => s.trim().length > 0)).toBe(true);
  });

  it('언어가 ko면 상대시간도 한국어로 찍힌다 (개인 시간대는 그대로 America/New_York)', async () => {
    const now = Date.now();
    axios.get.mockImplementation((url) => Promise.resolve({
      data: url === '/profile/ui-prefs' ? PREFS('ko') : recentPayload(now),
    }));
    await i18next.changeLanguage('ko');
    await mount('ko');

    expect(document.querySelector('.RecentItems__List')).toBeTruthy();
    expect(times()[0]).toBe('2시간 전');
    expect(times()[1]).toMatch(/^(어제|1일 전)$/);
    expect(document.querySelector('.Widget__Title').textContent).toBe('최근 항목');
  });

  it('항목이 없으면 빈 상태 문구를 현재 언어로 낸다', async () => {
    axios.get.mockImplementation((url) => Promise.resolve({
      data: url === '/profile/ui-prefs' ? PREFS('en') : { status: true, items: [] },
    }));
    await i18next.changeLanguage('en');
    await mount('en');

    expect(document.querySelector('.RecentItems__List')).toBeNull();
    expect(document.querySelector('.Widget__Empty').textContent).toBe('No recent items');
  });

  it('조회가 실패해도 위젯이 터지지 않고 빈 상태로 끝난다', async () => {
    axios.get.mockImplementation((url) => (url === '/profile/ui-prefs'
      ? Promise.resolve({ data: PREFS('en') })
      : Promise.reject(new Error('network'))));
    await i18next.changeLanguage('en');
    await mount('en');

    expect(document.querySelector('.Widget__Empty')).toBeTruthy();
    expect(document.querySelector('.Widget__Empty').textContent).toBe('No recent items');
  });
});
