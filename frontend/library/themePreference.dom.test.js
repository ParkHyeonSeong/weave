// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('@/library/_axios', () => ({ axios: { get: vi.fn(), patch: vi.fn() } }));
import { axios } from '@/library/_axios';
import {
  ThemeProvider, ThemeServerSync, THEME_STORAGE_KEY, THEME_OPTIONS, nextCycleMode, useThemePreference,
} from './theme';
import { UiPrefsProvider } from './UiPrefsContext';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let hook;        // 마지막 렌더의 훅 반환값
let activeRoot;

function Probe({ id = 'probe' }) {
  const h = useThemePreference();
  hook = h;
  return <span id={id}>{`${h.enabled}|${h.mode}|${h.resolved}|${h.pending}|${h.error}`}</span>;
}

// 두 소비자(Profile 라디오 + Header 토글)를 동시에 마운트하는 경우도 다룬다
let hooks = [];
function MultiProbe({ id }) {
  const h = useThemePreference();
  hooks.push(h);
  return <span id={id}>{`${h.mode}`}</span>;
}

// ⚠️ ThemeServerSync가 반드시 들어간다 — 실패 롤백을 mode로 옮기는 것이 이 브리지다.
async function mount(children, providerProps = { systemEnabled: true }) {
  document.body.innerHTML = '<div id="root"></div>';
  activeRoot = createRoot(document.getElementById('root'));
  await act(async () => {
    activeRoot.render(
      <ThemeProvider {...providerProps}>
        <UiPrefsProvider fetchEnabled={true}><ThemeServerSync />{children}</UiPrefsProvider>
      </ThemeProvider>,
    );
  });
}

// ─── 공통 jsdom 하네스 (Task 4·5의 테스트 파일도 이 블록을 그대로 쓴다) ─────────────
let server;                                     // 가짜 서버 ui_prefs
beforeEach(() => {
  vi.clearAllMocks();
  hook = undefined; hooks = []; server = {};
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

describe('nextCycleMode — 순환 규칙', () => {
  it('light → dark → system → light', () => {
    expect(nextCycleMode('light')).toBe('dark');
    expect(nextCycleMode('dark')).toBe('system');
    expect(nextCycleMode('system')).toBe('light');
  });
  it('부재·오염은 normalizeMode를 거쳐 system으로 취급된다 → light', () => {
    expect(nextCycleMode(undefined)).toBe('light');
    expect(nextCycleMode(null)).toBe('light');
    expect(nextCycleMode('neon')).toBe('light');
  });
});

describe('THEME_OPTIONS — 3모드 계약', () => {
  it('light/dark/system 순서로 셋뿐이고 각각 라벨·설명을 갖는다', () => {
    expect(THEME_OPTIONS.map((o) => o.value)).toEqual(['light', 'dark', 'system']);
    // 라벨은 이제 catalog 키다 — 문구는 렌더 시점에 현재 locale로 푼다.
    // (키가 실제 문구로 풀리는지는 library/i18nCatalog.test.js의 parity가 보장한다.)
    for (const o of THEME_OPTIONS) {
      expect(o.labelKey, o.value).toBeTruthy();
      expect(o.hintKey, o.value).toBeTruthy();
    }
  });
});

describe('enabled 게이트 — UI는 공개 플래그 뒤에서만 산다', () => {
  it('enabled === systemEnabled && !killSwitch', async () => {
    await mount(<Probe />, { systemEnabled: false });
    expect(hook.enabled).toBe(false);
    await act(() => activeRoot.unmount()); activeRoot = null;
    await mount(<Probe />, { systemEnabled: true });
    expect(hook.enabled).toBe(true);
  });
  it('killSwitch=true면 systemEnabled와 무관하게 enabled=false이고 화면도 light다', async () => {
    await mount(<Probe />, { systemEnabled: true, killSwitch: true });
    expect(hook.enabled).toBe(false);
    expect(hook.resolved).toBe('light');
  });
});

describe('useThemePreference — 낙관 적용, 되돌리기는 서버 확인값이 정한다', () => {
  it('선택 즉시 mode·DOM·localStorage 미러가 따라온다', async () => {
    await mount(<Probe />);
    await act(async () => { await hook.choose('dark'); });
    expect(hook.mode).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(axios.patch).toHaveBeenCalledWith('/profile/ui-prefs', { theme: 'dark' }, { _skipAuthRetry: true });
  });
  it('같은 값을 다시 고르면 아무 것도 하지 않는다', async () => {
    await mount(<Probe />);
    await act(async () => { await hook.choose('dark'); });
    axios.patch.mockClear();
    await act(async () => { await hook.choose('dark'); });
    expect(axios.patch).not.toHaveBeenCalled();
  });
  it('서버가 실패하면 마지막 서버 확인값으로 돌아가고 error를 노출한다 (미러도 따라간다)', async () => {
    // 훅은 setMode를 되돌리지 않는다. UiPrefsContext가 prefs.theme를 확인값으로 되돌리고
    // ThemeServerSync가 그것을 mode로 옮긴다 — 권위가 하나여야 두 소비자가 안 싸운다.
    server = { theme: 'light' };
    await mount(<Probe />);
    axios.patch.mockRejectedValueOnce(new Error('boom'));
    await act(async () => { await hook.choose('dark'); });
    expect(hook.mode).toBe('light');
    expect(hook.error).toBeTruthy();
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  // 연속 2회 실패에서 롤백 권위를 가르는 단정(직전 낙관값 vs 확인값)은 Task 2의
  // uiPrefsMutation 테스트가 동시 호출로 잡는다. 여기서 중복하지 않는다.

  it('choose는 reject 하지 않는다 (호출부가 onClick — unhandled rejection 금지)', async () => {
    await mount(<Probe />);
    axios.patch.mockRejectedValueOnce(new Error('boom'));
    await act(async () => { await expect(hook.choose('dark')).resolves.toBeUndefined(); });
  });
  it('clearError가 오류를 지운다', async () => {
    await mount(<Probe />);
    axios.patch.mockRejectedValueOnce(new Error('boom'));
    await act(async () => { await hook.choose('dark'); });
    expect(hook.error).toBeTruthy();
    await act(async () => { hook.clearError(); });
    expect(hook.error).toBe('');
  });
  it('진행 중에는 pending이 true다', async () => {
    await mount(<Probe />);
    let release;
    axios.patch.mockReturnValueOnce(new Promise((r) => { release = r; }));
    let p;
    await act(async () => { p = hook.choose('dark'); });
    expect(hook.pending).toBe(true);
    await act(async () => { release({ data: { status: true } }); await p; });
    expect(hook.pending).toBe(false);
  });
});

describe('두 소비자 동시 변경 — 뒤늦은 실패가 최신 선택을 삼키지 않는다', () => {
  it('Header가 먼저 실패해도 Profile의 최신 선택이 남는다', async () => {
    // 훅은 소비자마다 독립된 pending/error를 갖지만 mode는 ThemeProvider가 공유한다.
    // 훅이 각자 setMode(before)를 부르면 여기서 서로를 덮어쓴다 — 그래서 훅은 안 되돌린다.
    // 되돌림 여부는 UiPrefsContext의 키별 revision CAS 하나가 정한다.
    await mount(<><MultiProbe id="a" /><MultiProbe id="b" /></>);
    const [a, b] = hooks.slice(-2);
    let release;
    axios.patch
      .mockReturnValueOnce(new Promise((_, rej) => { release = rej; }))   // a: 실패 예정
      .mockImplementationOnce(async (url, body) => {                      // b: 성공
        Object.assign(server, body); return { data: { status: true } };
      });
    let pa, pb;
    await act(async () => { pa = a.choose('dark'); });
    await act(async () => { pb = b.choose('light'); });
    await act(async () => { release(new Error('late failure')); await pa; await pb; });
    expect(document.getElementById('a').textContent).toBe('light');   // a의 실패가 b를 안 뒤집는다
    expect(document.getElementById('b').textContent).toBe('light');
  });
});
