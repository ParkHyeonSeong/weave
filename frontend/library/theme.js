import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useUiPrefs } from '@/library/UiPrefsContext';
import { errorText } from '@/library/errorText';
import i18next from '@/library/i18n';

// 다크모드 테마 결정 로직 단일 소스 — 부트스트랩(public/theme-boot.js)·런타임(ThemeProvider)이 공유.
//
// 플래그가 둘인 이유: SYSTEM_ENABLED만으로는 다크를 끌 수 없다. resolveTheme의
// `if (mode === 'dark') return 'dark'`가 그 플래그를 읽지 않아, 명시적으로 dark를 고른
// 사용자는 플래그가 꺼져 있어도 계속 다크를 본다(프리뷰를 위해 의도된 동작이다).
//   SYSTEM_ENABLED   = 공개 플래그. S10에서 true로 플립했다 — 'system'이 OS를 따르고,
//                      서버에 저장된 테마가 권위를 가지며, 설정 UI(Profile 라디오·Header 토글)가 렌더된다.
//   DARK_KILL_SWITCH = 비상 정지. explicit dark까지 light로 강제한다. 부트스트랩·런타임 양쪽.
//                      되돌릴 일이 생기면 SYSTEM_ENABLED를 만지지 말고 이것을 켠다(한 줄·한 커밋).
// ⚠️ 이 상수를 바꾸면 public/theme-boot.js를 반드시 재생성한다(theme.test.js parity가 RED로 잡는다).
export const THEME_STORAGE_KEY = 'theme';
// 같은 탭 통지. storage 이벤트는 "다른" 탭에만 오므로, 이 탭이 미러를 지웠을 때(로그아웃)
// 살아 있는 ThemeProvider에게 다시 읽으라고 알리는 유일한 경로다.
export const THEME_MIRROR_EVENT = 'weave:theme-mirror';
export const VALID_MODES = ['light', 'dark', 'system'];
export const SYSTEM_ENABLED = true;
export const DARK_KILL_SWITCH = false;

const META_COLORS = { light: '#FFFFFF', dark: '#0E0F11' }; // _themes.scss --color-bg와 동기

// 단일 정규화 계약: 저장값 부재/오염 → 'system' (해석은 resolveTheme가 플래그에 따라)
export function normalizeMode(raw) {
  return VALID_MODES.includes(raw) ? raw : 'system';
}

export function resolveTheme(rawMode, osDark, { systemEnabled = SYSTEM_ENABLED, killSwitch = DARK_KILL_SWITCH } = {}) {
  if (killSwitch) return 'light';          // explicit dark도 여기서 막힌다
  const mode = normalizeMode(rawMode);
  if (mode === 'dark') return 'dark';
  if (mode === 'light') return 'light';
  return systemEnabled && osDark ? 'dark' : 'light';
}

// 스펙 §3 전이표. 서버 권위는 "인증된 GET 성공(loadStatus==='success')"에만 —
// GET 실패·미인증 스킵·로그아웃은 전부 미러 유지다.
export function mergeServerTheme({ loadStatus, serverTheme, localMode }, { systemEnabled = SYSTEM_ENABLED } = {}) {
  const local = normalizeMode(localMode);
  if (loadStatus !== 'success') return { mode: local, mirrorWrite: null };
  if (!systemEnabled) return { mode: local, mirrorWrite: null }; // 숨김 기간: 미러 단독 권위
  if (VALID_MODES.includes(serverTheme)) {
    if (serverTheme === local) return { mode: local, mirrorWrite: null };
    return { mode: serverTheme, mirrorWrite: serverTheme };
  }
  // 서버 부재/오염 → 기본값 system + 미러 덮어쓰기 (공유 브라우저 이전 계정 테마 차단)
  return { mode: 'system', mirrorWrite: local === 'system' ? null : 'system' };
}

export function getStoredMode() {
  try { return localStorage.getItem(THEME_STORAGE_KEY); } catch { return null; }
}

export function storeMode(mode) {
  try { localStorage.setItem(THEME_STORAGE_KEY, mode); } catch {}
}

export function applyResolvedTheme(resolved, doc = document) {
  doc.documentElement.setAttribute('data-theme', resolved);
  const meta = doc.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = META_COLORS[resolved]; // attr 불변이어도 항상 동기 (멱등)
}

// public/theme-boot.js의 생성원(자족 IIFE). ⚠️ 인라인 <script nonce>로 넣으면 안 된다 —
// custom _document.getInitialProps는 정적 최적화(ASO)를 끄지 않아(page 컴포넌트 기준 판정)
// prod 정적 HTML의 nonce가 빈 값이 되고, middleware는 요청마다 새 nonce를 CSP에 넣으므로
// 인라인은 차단된다. 외부 파일은 script-src 'self'로 통과. theme.test.js parity 테스트가
// resolveTheme과의 동치를, Task 9 파일 parity가 파일과 이 함수의 동기화를 강제한다.
export function buildBootstrapScript({ systemEnabled = SYSTEM_ENABLED, killSwitch = DARK_KILL_SWITCH } = {}) {
  // ⚠️ storage 읽기만 try — 정규화·해석은 항상 실행. getItem 예외를 해석까지 묶으면
  // 런타임(getStoredMode→null→'system')과 결과가 갈려 GA에서 light→dark FOUC가 난다.
  const readStored = `var t=null;try{t=localStorage.getItem('${THEME_STORAGE_KEY}');}catch(e){}`;
  const normalize = `var v=(t==='light'||t==='dark'||t==='system')?t:'system';`;
  const resolveGa = `var r=v==='dark'?'dark':v==='light'?'light':(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');`;
  const resolvePreview = `var r=v==='dark'?'dark':'light';`;
  const resolveKilled = `var r='light';`;
  // 앞부분(readStored/normalize)은 플래그와 무관하게 고정한다 — 산출물 diff가 항상
  // 해석 절 한 줄로만 나와야 리뷰어가 무엇이 바뀌었는지 즉시 본다.
  const resolve = killSwitch ? resolveKilled : (systemEnabled ? resolveGa : resolvePreview);
  return `(function(){${readStored}${normalize}${resolve}document.documentElement.setAttribute('data-theme',r);try{var m=document.querySelector('meta[name="theme-color"]');if(m)m.content=r==='dark'?'${META_COLORS.dark}':'${META_COLORS.light}';}catch(e){}})();`;
}

// 토글 순간 transition:all 205곳의 스태거드 색 전환 억제 (globals.scss .theme-switching 규칙과 짝)
export function withTransitionsSuppressed(doc, fn) {
  doc.documentElement.classList.add('theme-switching');
  fn();
  requestAnimationFrame(() => requestAnimationFrame(() => {
    doc.documentElement.classList.remove('theme-switching');
  }));
}

// ---------------------------------------------------------------------------
// ThemeProvider — _app의 appReady 게이트 "밖"에 마운트해 라우팅/게이트 리셋에도 상주.
// preference를 React 상태로 들어 storage 채택 시 소비자(S10 Profile 라디오)까지 재렌더된다.
// ---------------------------------------------------------------------------
const ThemeContext = createContext(null);

// systemEnabled prop: 기본은 공개 플래그. 주입 가능하게 열어둔 이유는 테스트가 두 경로
// (OS 추종·서버 권위 vs 프리뷰 전용)를 플래그 값과 무관하게 각각 고정하기 위해서다 — 지우지 마라.
export function ThemeProvider({ children, systemEnabled = SYSTEM_ENABLED, killSwitch = DARK_KILL_SWITCH }) {
  const [mode, setModeState] = useState('system');
  const [osDark, setOsDark] = useState(false);
  const [ready, setReady] = useState(false); // 초기 미러 채택 전 DOM 동기 금지(부트스트랩 결과 보존)

  useEffect(() => {
    setModeState(normalizeMode(getStoredMode()));
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    setOsDark(mq.matches);
    setReady(true);
    const onChange = (e) => setOsDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // 탭 간 동기화 — React 상태로 반영 (DOM만 만지면 Profile 라디오가 stale)
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === THEME_STORAGE_KEY) setModeState(normalizeMode(e.newValue));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // 같은 탭 동기화 — 로그아웃이 미러를 지운 뒤 알린다. _app.js의 이 Provider는 appReady
  // 게이트 밖이라 언마운트되지 않으므로, 여기서 다시 읽지 않으면 이전 계정의 explicit
  // dark/light가 로그인 화면까지 남는다. 미러 부재 → 'system' → 플래그대로 해석된다.
  useEffect(() => {
    const onMirror = () => setModeState(normalizeMode(getStoredMode()));
    window.addEventListener(THEME_MIRROR_EVENT, onMirror);
    return () => window.removeEventListener(THEME_MIRROR_EVENT, onMirror);
  }, []);

  const resolved = resolveTheme(mode, osDark, { systemEnabled, killSwitch });

  // DOM 동기 — attr 변화 시에만 트랜지션 억제, meta는 항상 동기(멱등).
  useEffect(() => {
    if (!ready) return;
    const current = document.documentElement.getAttribute('data-theme');
    if (current !== resolved) {
      withTransitionsSuppressed(document, () => applyResolvedTheme(resolved));
    } else {
      applyResolvedTheme(resolved); // 부트스트랩이 attr만 맞춘 경우에도 meta 동기 (P1: dark 새로고침 meta 잔존)
    }
  }, [ready, resolved]);

  // 사용자 선택(S10 UI)·서버 채택 공용 진입점 — 미러 기록 포함
  const setMode = useCallback((next) => {
    const norm = normalizeMode(next);
    storeMode(norm);
    setModeState(norm);
  }, []);

  const value = useMemo(
    () => ({ mode, resolved, setMode, systemEnabled, killSwitch }),
    [mode, resolved, setMode, systemEnabled, killSwitch],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext)
    || { mode: 'system', resolved: 'light', setMode: () => {}, systemEnabled: SYSTEM_ENABLED, killSwitch: DARK_KILL_SWITCH };
}

// UiPrefsProvider 안에서 서버 스냅샷을 전이표대로 채택하는 브리지 (UI 없음)
export function ThemeServerSync() {
  const { prefs, loadStatus } = useUiPrefs();
  const { mode, setMode, systemEnabled } = useTheme();
  useEffect(() => {
    const { mode: next } = mergeServerTheme(
      { loadStatus, serverTheme: prefs.theme, localMode: mode },
      { systemEnabled },
    );
    if (next !== mode) setMode(next);
    // mode는 deps에서 의도적 제외 — prefs 변화에만 반응한다 (mode를 넣으면 재머지 루프).
    //
    // ⚠️ deps가 prefs.theme(값)이 아니라 prefs(객체 정체성)인 이유: 저장 실패 롤백은
    // theme를 '마지막 서버 확인값'으로 되돌리는데, 그 값은 낙관 적용 직전 값과 같다.
    // 낙관 적용과 롤백이 같은 React 배치에 합쳐지면 값 diff가 0이라 브리지가 돌지 않고
    // mode가 실패한 낙관값에 남는다(실측: choose 후 렌더 1회, mode=dark / prefs.theme=light).
    // 객체 정체성은 setPrefs마다 새로 생기므로 왕복 롤백도 관측된다. 다른 namespace 변경에도
    // 돌지만 mergeServerTheme은 순수 함수이고 setMode는 next !== mode로 막혀 무해하다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadStatus, prefs]);
  return null;
}

// ---------------------------------------------------------------------------
// S10 — 사용자 설정 진입점. Profile 라디오·Header 토글은 전부 이 훅을 쓴다.
// ---------------------------------------------------------------------------

// label/hint는 catalog 키다 — 렌더 시점에 현재 locale로 푼다(AppearanceSection).
// value('light'|'dark'|'system')는 저장 값이므로 절대 번역하지 않는다.
export const THEME_OPTIONS = Object.freeze([
  Object.freeze({ value: 'light',  labelKey: 'theme.light',  hintKey: 'theme.lightHint' }),
  Object.freeze({ value: 'dark',   labelKey: 'theme.dark',   hintKey: 'theme.darkHint' }),
  Object.freeze({ value: 'system', labelKey: 'theme.system', hintKey: 'theme.systemHint' }),
]);

const CYCLE = { light: 'dark', dark: 'system', system: 'light' };

export function nextCycleMode(current) {
  return CYCLE[normalizeMode(current)];
}

// 선택을 즉시 적용하고(낙관적) 서버에 저장한다. 실패하면 error를 노출한다 —
// 조용히 되돌아가면 사용자는 뭐가 잘못됐는지 알 수 없다.
//
// ⚠️ 여기서 setMode로 되돌리지 않는다. 되돌림 권위는 UiPrefsContext 하나다:
// setNamespaceChecked가 prefs.theme를 마지막 서버 확인값으로 되돌리고, ThemeServerSync가
// 그 변화를 setMode로 옮긴다. 훅에서 한 번 더 되돌리면 Profile과 Header가 서로의 선택을
// 덮어쓰고, 되돌아갈 값도 아무도 확인한 적 없는 직전 낙관값이 된다.
//
// choose는 reject 하지 않는다. 호출부가 onClick이라 reject 하면 unhandled rejection이
// 콘솔에 남는다. 실패는 error 상태로만 알린다 — 문구는 레포 규약(errorText)으로 풀고
// 코드가 없는 네트워크 실패만 아래 폴백을 쓴다.
//
// enabled: UI는 공개 플래그 뒤에서만 렌더한다. 킬스위치가 켜지면 화면이 light로 강제되므로
// 설정 UI도 함께 감춘다 — 고른 값과 보이는 값이 다르면 사용자는 앱이 고장났다고 읽는다.


export function useThemePreference() {
  const { mode, resolved, setMode, systemEnabled, killSwitch } = useTheme();
  const { setNamespaceChecked } = useUiPrefs();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const clearError = useCallback(() => setError(''), []);

  const choose = useCallback(async (nextMode) => {
    const want = normalizeMode(nextMode);
    if (want === normalizeMode(mode)) return;
    setError('');
    setPending(true);
    setMode(want);                       // 낙관적: 화면 + localStorage 미러
    try {
      await setNamespaceChecked('theme', want);
    } catch (e) {
      setError(errorText(e?.code, e?.category) || i18next.t('theme.saveFailed'));
    } finally {
      setPending(false);
    }
  }, [mode, setMode, setNamespaceChecked]);

  return {
    enabled: systemEnabled && !killSwitch,
    mode, resolved,
    options: THEME_OPTIONS,
    choose, pending, error, clearError,
  };
}
