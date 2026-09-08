// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

import { THEME_STORAGE_KEY, ThemeProvider, useTheme, normalizeMode, resolveTheme } from './theme';
import { WORKSPACE_SETTINGS_KEY } from '@/library/workspaceSettings';
import { clearClientSession } from './sessionCleanup';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let activeRoot;
let mq;           // matchMedia 스텁 — ThemeProvider를 실마운트하는 케이스가 쓴다
const replace = vi.fn();

function ThemeProbe() {
  const { mode, resolved } = useTheme();
  return <span id="theme-probe">{`${mode}:${resolved}`}</span>;
}
const themeSeen = () => document.getElementById('theme-probe').textContent;

vi.mock('next/router', () => ({
  useRouter: () => ({ replace, push: vi.fn(), pathname: '/', query: {}, asPath: '/',
    events: { on: vi.fn(), off: vi.fn() } }),
}));

// 로그아웃 3경로가 각자 자기 줄을 복제하지 않고 한 함수를 타는지는 소스가 아니라
// 결과로 본다 — 어느 경로로 나가든 이전 계정의 테마 미러가 남지 않아야 한다.
function seedSession() {
  localStorage.setItem(THEME_STORAGE_KEY, 'dark');
  sessionStorage.setItem('profile', JSON.stringify({ user_id: 1 }));
  sessionStorage.setItem('avatar_url', 'x.png');
  sessionStorage.setItem(WORKSPACE_SETTINGS_KEY, JSON.stringify({ initialized: true }));
}

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom에는 scrollIntoView가 없다 (CommandPalette의 활성 항목 스크롤 effect가 부른다)
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
  localStorage.clear(); sessionStorage.clear();
  seedSession();
  mq = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  window.matchMedia = vi.fn().mockReturnValue(mq);
  globalThis.requestAnimationFrame = (cb) => { cb(); return 0; };
  document.documentElement.removeAttribute('data-theme');
  document.body.innerHTML = '<div id="root"></div>';
});
afterEach(() => { if (activeRoot) { act(() => activeRoot.unmount()); activeRoot = null; } });

describe('clearClientSession — 이전 계정의 흔적을 지운다', () => {
  it('profile·avatar_url·theme mirror를 지운다', () => {
    clearClientSession();
    expect(sessionStorage.getItem('profile')).toBeNull();
    expect(sessionStorage.getItem('avatar_url')).toBeNull();
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });
  it('워크스페이스 설정 캐시는 건드리지 않는다 (세션이 아니라 워크스페이스 상태다)', () => {
    clearClientSession();
    expect(sessionStorage.getItem(WORKSPACE_SETTINGS_KEY)).toBeTruthy();
  });
  it('제거 후 해석은 OS를 따른다 — light로 고정되지 않는다', () => {
    // ⚠️ "삭제하면 라이트가 된다"는 오해의 회귀 방지선이다. 미러가 없으면
    // normalizeMode(null) → 'system'이고, OS가 다크면 로그인 화면도 다크다(§14.2).
    clearClientSession();
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    expect(resolveTheme(normalizeMode(stored), true, { systemEnabled: true })).toBe('dark');
    expect(resolveTheme(normalizeMode(stored), false, { systemEnabled: true })).toBe('light');
  });
});

describe('로그아웃 3경로 — 어디로 나가도 이전 계정의 테마가 남지 않는다', () => {
  it('L1 Header 로그아웃', async () => {
    // handleLogout은 POST /auth/logout을 먼저 await 한다 — 어댑터를 세워야 정리까지 도달한다.
    const { axios } = await import('@/library/_axios');
    axios.defaults.adapter = async (config) => ({ data: { status: true }, status: 200, config });

    const { default: Header } = await import('@/components/Layout/Header');
    activeRoot = createRoot(document.getElementById('root'));
    // _app.js처럼 ThemeProvider는 로그아웃에도 언마운트되지 않고 살아 있다 — 같은 탭에는
    // storage 이벤트가 오지 않으므로 이 Provider가 직접 통지를 받아야 한다.
    await act(async () => {
      activeRoot.render(<ThemeProvider><ThemeProbe /><Header isMobile={false} /></ThemeProvider>);
    });
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');   // 이전 계정 explicit dark

    const userBtn = document.querySelector('.Header__Avatar');
    await act(async () => { userBtn.click(); });
    // ⚠️ 문구로 찾지 않는다 — 로그아웃 라벨은 이제 locale을 따른다(en이면 'Sign out').
    const logout = document.querySelector('.Header__SettingsItem--danger');
    await act(async () => { logout.click(); });
    await act(async () => {});          // 동적 import + POST 해소까지 한 틱 더

    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(sessionStorage.getItem('profile')).toBeNull();
    expect(sessionStorage.getItem(WORKSPACE_SETTINGS_KEY)).toBeNull();  // L1은 자기 줄로 계속 지운다
    // 저장소만 비고 React mode가 dark에 남으면 로그인 화면이 이전 계정의 다크로 그려진다
    expect(themeSeen()).toBe('system:light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('L2 Command Palette 로그아웃', async () => {
    const { default: CommandPalette } = await import('@/components/modal/CommandPalette');
    activeRoot = createRoot(document.getElementById('root'));
    await act(async () => { activeRoot.render(<CommandPalette isOpen={true} onClose={() => {}} />); });

    // 라벨은 catalog(auth.signOut)를 따른다 — 문자열 하드코딩 대신 현재 locale의 값으로 찾는다.
    const { default: i18next } = await import('@/library/i18n');
    const logout = [...document.querySelectorAll('.CommandPalette__Item')]
      .find((el) => el.textContent.includes(i18next.t('auth.signOut')));
    await act(async () => { logout.click(); });

    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(sessionStorage.getItem('profile')).toBeNull();
    expect(sessionStorage.getItem(WORKSPACE_SETTINGS_KEY)).toBeNull();  // L2도 자기 줄로 계속 지운다
  });

  it('L3 auth-expired (실물 인터셉터를 통과시킨다)', async () => {
    const { axios } = await import('@/library/_axios');
    axios.defaults.adapter = async (config) => {
      const err = new Error('unauthorized');
      err.config = config;
      err.response = { status: 401, data: {}, config };
      throw err;
    };
    await expect(axios.get('/anything', { _skipAuthRetry: true })).rejects.toBeTruthy();

    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(sessionStorage.getItem('profile')).toBeNull();
    // ⚠️ L3는 원래 워크스페이스 초기화 캐시를 지우지 않는다 — 현행 동작을 고정한다
    expect(sessionStorage.getItem(WORKSPACE_SETTINGS_KEY)).toBeTruthy();
  });
});

describe('로그아웃 직후 살아 있는 ThemeProvider — 같은 탭에서 즉시 동기화된다', () => {
  // 같은 탭에서는 localStorage.removeItem이 storage 이벤트를 만들지 않는다. _app.js의
  // ThemeProvider는 appReady 게이트 밖이라 로그아웃에도 언마운트되지 않으므로, 미러만 지우면
  // React mode가 이전 사용자의 explicit dark/light에 그대로 남는다.
  function mountTheme(props = {}) {
    activeRoot = createRoot(document.getElementById('root'));
    act(() => { activeRoot.render(<ThemeProvider {...props}><ThemeProbe /></ThemeProvider>); });
  }

  it('SYSTEM_ENABLED=false: explicit dark → 삭제 즉시 light (mode=system)', () => {
    mountTheme();
    expect(themeSeen()).toBe('dark:dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    act(() => { clearClientSession(); });
    expect(themeSeen()).toBe('system:light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('SYSTEM_ENABLED=true: explicit light → 삭제 즉시 OS 추종 (OS dark면 dark)', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    mq.matches = true;
    mountTheme({ systemEnabled: true });
    expect(themeSeen()).toBe('light:light');
    act(() => { clearClientSession(); });
    expect(themeSeen()).toBe('system:dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('SYSTEM_ENABLED=true: explicit dark → 삭제 즉시 OS 추종 (OS light면 light)', () => {
    mq.matches = false;
    mountTheme({ systemEnabled: true });
    expect(themeSeen()).toBe('dark:dark');
    act(() => { clearClientSession(); });
    expect(themeSeen()).toBe('system:light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});
