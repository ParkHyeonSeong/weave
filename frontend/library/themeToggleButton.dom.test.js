// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('@/library/_axios', () => ({ axios: { get: vi.fn(), patch: vi.fn() } }));
import { axios } from '@/library/_axios';
import { ThemeProvider, ThemeServerSync, THEME_STORAGE_KEY } from '@/library/theme';
import i18next from '@/library/i18n';
import { UiPrefsProvider } from '@/library/UiPrefsContext';
import ThemeToggleButton from '@/components/Layout/ThemeToggleButton';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let activeRoot;
const btn = () => document.querySelector('.Header__ThemeToggle');

const PATCH_CFG = { _skipAuthRetry: true };

// ─── 공통 jsdom 하네스 (themePreference.dom.test.js와 같은 블록) ─────────────────
let server;                                     // 가짜 서버 ui_prefs
beforeEach(() => {
  vi.clearAllMocks();
  server = {};
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false, addEventListener: () => {}, removeEventListener: () => {},
  });
  globalThis.requestAnimationFrame = (cb) => { cb(); return 0; };
  localStorage.clear(); sessionStorage.clear();
  sessionStorage.setItem('profile', JSON.stringify({ user_id: 1 }));
  document.documentElement.removeAttribute('data-theme');
  document.head.innerHTML = '<meta name="theme-color" content="">';
  axios.get.mockImplementation(async () => ({ data: { status: true, ui_prefs: { ...server } } }));
  axios.patch.mockImplementation(async (url, body) => {
    Object.assign(server, body); return { data: { status: true } };
  });
});
afterEach(() => { if (activeRoot) { act(() => activeRoot.unmount()); activeRoot = null; } });
// ────────────────────────────────────────────────────────────────────────────────

async function mount(providerProps = { systemEnabled: true }) {
  const mirror = localStorage.getItem(THEME_STORAGE_KEY);
  if (mirror) server = { theme: mirror };     // 서버도 같은 값 (Task 4 mount와 같은 이유)
  document.body.innerHTML = '<div id="root"></div>';
  activeRoot = createRoot(document.getElementById('root'));
  await act(async () => {
    activeRoot.render(
      <ThemeProvider {...providerProps}>
        <UiPrefsProvider fetchEnabled={true}><ThemeServerSync /><ThemeToggleButton /></UiPrefsProvider>
      </ThemeProvider>,
    );
  });
}
const click = async () => { await act(async () => { btn().click(); }); };

describe('ThemeToggleButton — 플래그 게이트', () => {
  it('공개 플래그가 꺼져 있으면 DOM을 만들지 않는다', async () => {
    await mount({ systemEnabled: false });
    expect(btn()).toBeNull();
  });
  it('킬스위치가 켜져 있으면 사라진다', async () => {
    await mount({ systemEnabled: true, killSwitch: true });
    expect(btn()).toBeNull();
  });
});

describe('ThemeToggleButton — 순환과 접근성', () => {
  it('버튼 하나이고 접근성 이름을 갖는다', async () => {
    await mount();
    expect(document.querySelectorAll('button')).toHaveLength(1);
    expect(btn().getAttribute('aria-label')).toBeTruthy();
  });
  it('aria-label이 현재 모드와 다음 동작을 함께 말한다', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    await mount();
    const label = btn().getAttribute('aria-label');
    expect(label).toMatch(/Light/);   // 현재
    expect(label).toMatch(/Dark/);    // 다음
  });
  it('light→dark→system→light 3단 순환이고 3회면 제자리다', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    await mount();
    for (const want of ['dark', 'system', 'light']) {
      await click();
      expect(btn().dataset.mode, want).toBe(want);
    }
    expect(axios.patch).toHaveBeenNthCalledWith(1, '/profile/ui-prefs', { theme: 'dark' }, PATCH_CFG);
  });
  it('아이콘은 resolved가 아니라 mode를 반영한다', async () => {
    // system인데 OS가 다크면 resolved는 dark지만, 사용자가 고른 것은 system이다.
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true, addEventListener: () => {}, removeEventListener: () => {},
    });
    localStorage.setItem(THEME_STORAGE_KEY, 'system');
    await mount();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');  // resolved
    expect(btn().dataset.mode).toBe('system');                                  // 아이콘 기준
  });
  it('저장 중에는 aria-disabled로 표시하고 DOM disabled는 쓰지 않는다 (포커스 유지)', async () => {
    await mount();
    let release;
    axios.patch.mockReturnValueOnce(new Promise((r) => { release = r; }));
    btn().focus();
    await click();
    expect(btn().getAttribute('aria-disabled')).toBe('true');
    expect(btn().disabled).toBe(false);
    expect(document.activeElement).toBe(btn());
    await click();                                               // 저장 중 재클릭은 무시된다
    expect(axios.patch).toHaveBeenCalledTimes(1);
    await act(async () => { release({ data: { status: true } }); });
    expect(btn().hasAttribute('aria-disabled')).toBe(false);
  });
  it('저장 실패는 title로 알린다 (Header에 alert 영역이 없다)', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    await mount();
    axios.patch.mockRejectedValueOnce(new Error('boom'));
    await click();
    // 문구는 현재 locale을 따른다(기본 en). 테스트는 catalog 값과 대조한다.
    expect(btn().getAttribute('title')).toBe(i18next.t('theme.saveFailed'));
    expect(btn().dataset.mode).toBe('light');   // 되돌아감
  });
});
