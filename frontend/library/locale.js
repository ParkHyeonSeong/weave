// LocaleProvider — 개인 언어·시간대의 런타임 상태. 순수 로직은 library/localePrefs.js에 있다.
//
// 배치(pages/_app.js):
//   LocaleProvider                     ← appReady 게이트 **밖**. 로그인 전 화면도 언어를 갖는다.
//     └ appReady && …
//         └ UiPrefsProvider
//             └ LocaleServerSync       ← 서버 스냅샷을 Provider로 옮기는 브리지(UI 없음)
//             └ LocaleGate             ← 최초 선택 화면. loadStatus가 필요해 여기 있어야 한다.
//
// 상태 모델:
//   · locale   — 로그인 전에는 익명 표시 언어(localStorage) 또는 감지값, 로그인 후에는 서버값.
//   · timeZone — 로그인 후 서버값. 그 외에는 항상 **감지값**이다. 기기에 저장하지 않으므로
//                이전 계정의 시간대가 다음 계정에 상속될 수 없다.
//                단, 라우트 이동으로 UiPrefsProvider만 리마운트되는 동안(loading/error)에는
//                마지막으로 확인된 계정 값을 유지한다 — 아래 confirmedRef 참고.
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';

import i18next, { initI18n } from '@/library/i18n';
import { useUiPrefs } from '@/library/UiPrefsContext';
import {
  DEFAULT_LOCALE,
  FALLBACK_TIME_ZONE,
  LOCALE_STORAGE_KEY,
  detectLanguageRegion,
  mergeServerLanguageRegion,
  normalizeLanguageRegion,
  normalizeLocale,
  readLocaleMirror,
  sameLanguageRegion,
  writeLocaleMirror,
} from '@/library/localePrefs';

const LocaleContext = createContext(null);

const SERVER_DEFAULT = { locale: DEFAULT_LOCALE, time_zone: FALLBACK_TIME_ZONE };

// SSR/정적 프리렌더에는 브라우저 감지값이 없다. 첫 클라이언트 effect에서 채운다.
export function LocaleProvider({ children }) {
  const [value, setValue] = useState(SERVER_DEFAULT);
  const [detected, setDetected] = useState(SERVER_DEFAULT);
  const [ready, setReady] = useState(false);
  const [gateOpen, setGateOpen] = useState(false);
  const valueRef = useRef(value);
  valueRef.current = value;
  // 인증 조회 **성공**으로 채택한 마지막 계정 값. LocaleProvider는 appReady 게이트 밖이라
  // UiPrefsProvider가 리마운트돼도 살아남는다 — loading/error 동안 이 값을 유지하는 근거이자,
  // 로그아웃(skipped) 시 명시적으로 버려야 하는 값이다.
  const confirmedRef = useRef(null);
  const readConfirmed = useCallback(() => confirmedRef.current, []);
  const writeConfirmed = useCallback((next) => { confirmedRef.current = next || null; }, []);

  // 초기 채택: 언어는 익명 표시 언어 > 감지, 시간대는 감지. 서버값은 LocaleServerSync가 덮는다.
  useEffect(() => {
    // public/locale-boot.js와 같은 규칙: languages가 비어 있으면 language 하나로 판정한다.
    const langs = (navigator?.languages && navigator.languages.length)
      ? navigator.languages
      : [navigator?.language || ''];
    const det = detectLanguageRegion(langs);
    setDetected(det);
    const mirror = readLocaleMirror();
    setValue({ locale: mirror || det.locale, time_zone: det.time_zone });
    setReady(true);
  }, []);

  // 다른 탭이 익명 표시 언어를 바꾸면 따라간다(시간대는 기기에 없으므로 대상이 아니다).
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key !== LOCALE_STORAGE_KEY) return;
      const next = normalizeLocale(e.newValue);
      if (next) setValue((v) => (v.locale === next ? v : { ...v, locale: next }));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // i18next 언어 + <html lang> 동기. 부트스트랩(public/locale-boot.js)이 첫 페인트 전에
  // 이미 lang을 세팅하지만, 서버 값 채택·사용자 변경 후에는 여기서 교정한다.
  useEffect(() => {
    initI18n(value.locale);
    if (i18next.language !== value.locale) i18next.changeLanguage(value.locale);
    if (typeof document !== 'undefined') {
      document.documentElement.lang = value.locale;
    }
  }, [value.locale]);

  // 언어 **미리보기** — 화면만 바꾸고 아무 데도 저장하지 않는다(Setup Step 1의 라디오, 게이트 초안).
  const previewLocale = useCallback((locale) => {
    const norm = normalizeLocale(locale);
    if (!norm) return;
    setValue((v) => (v.locale === norm ? v : { ...v, locale: norm }));
  }, []);

  // 익명 표시 언어 확정 — 화면 + localStorage['locale']. 시간대는 건드리지 않는다.
  const commitLocale = useCallback((locale) => {
    const norm = normalizeLocale(locale);
    if (!norm) return null;
    writeLocaleMirror(norm);
    setValue((v) => (v.locale === norm ? v : { ...v, locale: norm }));
    return norm;
  }, []);

  // 로그인 사용자의 확정값 적용(낙관) — 화면 전체 + 익명 표시 언어. 서버 저장은
  // useLanguageRegionPreference가 담당한다.
  const applyValue = useCallback((next) => {
    const norm = normalizeLanguageRegion(next);
    if (!norm) return null;
    writeLocaleMirror(norm.locale);
    if (!sameLanguageRegion(norm, valueRef.current)) setValue(norm);
    return norm;
  }, []);

  // 서버 채택 — 익명 표시 언어를 갱신할지는 호출부(LocaleServerSync)가 결정한다.
  const adopt = useCallback((next, { mirrorLocale = false } = {}) => {
    const norm = normalizeLanguageRegion(next);
    if (!norm) return;
    if (mirrorLocale) writeLocaleMirror(norm.locale);
    if (!sameLanguageRegion(norm, valueRef.current)) setValue(norm);
  }, []);

  const ctx = useMemo(() => ({
    locale: value.locale,
    timeZone: value.time_zone,
    value,
    detected,
    ready,
    gateOpen,
    setGateOpen,
    previewLocale,
    commitLocale,
    applyValue,
    adopt,
    readConfirmed,
    writeConfirmed,
  }), [value, detected, ready, gateOpen, previewLocale, commitLocale, applyValue, adopt,
    readConfirmed, writeConfirmed]);

  return <LocaleContext.Provider value={ctx}>{children}</LocaleContext.Provider>;
}

// Provider 밖(테스트·초기 렌더)에서도 안전한 기본값
const EMPTY = {
  locale: DEFAULT_LOCALE,
  timeZone: FALLBACK_TIME_ZONE,
  value: SERVER_DEFAULT,
  detected: SERVER_DEFAULT,
  ready: false,
  gateOpen: false,
  setGateOpen: () => {},
  previewLocale: () => {},
  commitLocale: () => null,
  applyValue: () => null,
  adopt: () => {},
  readConfirmed: () => null,
  writeConfirmed: () => {},
};

export function useLocale() {
  return useContext(LocaleContext) || EMPTY;
}

// ---------------------------------------------------------------------------
// UiPrefsProvider 안에서 서버 스냅샷을 채택하는 브리지 (UI 없음)
// ---------------------------------------------------------------------------
//
// 서버 값이 없으면 게이트를 연다. 기기값을 서버로 자동 승격하는 경로는 **없다** —
// 사용자가 게이트에서 Continue를 눌러야만 저장된다(이전 계정 시간대 상속 금지).
export function LocaleServerSync() {
  const { prefs, loadStatus } = useUiPrefs();
  const { detected, ready, adopt, setGateOpen, readConfirmed, writeConfirmed } = useLocale();

  useEffect(() => {
    if (!ready) return;
    const decision = mergeServerLanguageRegion({
      loadStatus,
      serverValue: prefs.language_region,
      deviceLocale: readLocaleMirror(),
      detected,
      confirmed: readConfirmed(),
    });
    // 다음 마운트가 볼 기억을 먼저 갱신한다(로그아웃이면 null로 지운다).
    writeConfirmed(decision.nextConfirmed);
    setGateOpen(decision.showGate);
    // 게이트가 열려 있는 동안은 채택하지 않는다 — 사용자가 게이트에서 고르는 중인 미리보기를
    // 서버 부재 판단이 되돌려 놓으면 안 된다. 게이트가 닫히는 경로는 서버 저장 성공뿐이고,
    // 그때는 서버 값이 있어 아래 채택이 돈다.
    if (!decision.showGate) adopt(decision.value, { mirrorLocale: !!decision.localeMirrorWrite });
    // prefs는 객체 정체성으로 본다(theme의 ThemeServerSync와 같은 이유: 롤백 왕복 관측).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadStatus, prefs, ready, detected]);

  return null;
}

// ---------------------------------------------------------------------------
// 사용자 설정 진입점 — 최초 선택 게이트·Setup·Profile·로그인 화면 메뉴가 모두 이 훅을 쓴다.
// ---------------------------------------------------------------------------
export function useLanguageRegionPreference() {
  const { value, locale, timeZone, detected, applyValue, commitLocale, previewLocale, setGateOpen } = useLocale();
  const { setNamespaceChecked, loadStatus } = useUiPrefs();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const clearError = useCallback(() => setError(''), []);

  /**
   * locale + time_zone을 **한 번에** 저장한다(로그인 사용자).
   * 낙관 적용 → PATCH 1회 → 실패 시 UiPrefsContext의 CAS 롤백이 마지막 서버 확인값으로 되돌린다.
   * 되돌림 권위는 UiPrefsContext 하나다 — 여기서 다시 되돌리지 않는다(theme와 같은 계약).
   *
   * 미인증(loadStatus !== 'success')에서는 서버에 쓰지 않는다: 언어만 익명 표시 언어로
   * 확정하고 시간대는 세션 메모리에만 적용한다(설치 위저드가 initialize 요청에 실어 보낸다).
   * PATCH를 보내면 401 → auth:expired 인터셉터가 설치 화면을 로그인으로 튕긴다.
   */
  const choose = useCallback(async (next, { closeGate = false } = {}) => {
    const norm = normalizeLanguageRegion(next);
    if (!norm) return false;
    setError('');

    if (loadStatus !== 'success') {
      commitLocale(norm.locale);
      previewLocale(norm.locale);
      return true;
    }

    setPending(true);
    const applied = applyValue(norm);         // 낙관: 화면 + 익명 표시 언어
    try {
      await setNamespaceChecked('language_region', applied);
      if (closeGate) setGateOpen(false);
      return true;
    } catch (e) {
      // 문구는 현재 선택된 언어로 보여준다(방금 바꾼 언어가 이미 적용돼 있다).
      setError(i18next.t('languageRegion.saveFailed'));
      return false;
    } finally {
      setPending(false);
    }
  }, [applyValue, commitLocale, previewLocale, setNamespaceChecked, setGateOpen, loadStatus]);

  return { value, locale, timeZone, detected, choose, previewLocale, commitLocale, pending, error, clearError };
}
