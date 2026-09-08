// i18next 초기화. catalog는 정적 번들이다 — HTTP backend를 쓰지 않는다.
//   · 부트 시 추가 요청이 없어 첫 페인트가 빨라지고,
//   · 오프라인(Service Worker 폴백)에서도 문구가 살아 있고,
//   · CSP connect-src를 넓힐 이유가 없다.
//
// URL에 /en·/ko를 붙이지 않고 next.config.mjs의 locale routing도 쓰지 않는다.
// 이 앱은 로그인 중심(noindex)이라 locale별 URL이 필요 없고, 라우트를 바꾸면
// library/authRedirect.js의 PUBLIC_PATHS·normalizeReturnTo 판정이 전부 흔들린다.
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from '@/library/i18n/en';
import ko from '@/library/i18n/ko';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '@/library/localePrefs';

export const resources = { en: { translation: en }, ko: { translation: ko } };

// 누락 키는 dev에서 시끄럽게 만든다 — 조용히 키 문자열이 화면에 찍히면 리뷰에서 놓친다.
// (테스트는 library/i18nCatalog.test.js가 parity로 잡는다.)
function onMissingKey(lngs, ns, key) {
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.warn(`[i18n] missing key: ${key} (${Array.isArray(lngs) ? lngs.join(',') : lngs})`);
  }
}

let initialized = false;

export function initI18n(locale = DEFAULT_LOCALE) {
  const lng = SUPPORTED_LOCALES.includes(locale) ? locale : DEFAULT_LOCALE;
  if (initialized) {
    if (i18next.language !== lng) i18next.changeLanguage(lng);
    return i18next;
  }
  i18next.use(initReactI18next).init({
    resources,
    lng,
    fallbackLng: DEFAULT_LOCALE,
    supportedLngs: SUPPORTED_LOCALES,
    interpolation: { escapeValue: false },   // React가 이미 이스케이프한다
    returnNull: false,
    saveMissing: true,
    missingKeyHandler: onMissingKey,
    react: { useSuspense: false },           // 정적 번들이라 로딩 서스펜스가 필요 없다
  });
  initialized = true;
  return i18next;
}

// 모듈 로드 시 기본 locale로 즉시 초기화한다.
// 이유: errorText(code, category)처럼 React 밖에서 불리는 소비자가 i18next.exists()를
// 안전하게 쓸 수 있어야 한다(미초기화 인스턴스는 항상 false를 돌려줘 "매핑 없음"으로
// 오인된다). LocaleProvider가 사용자 locale을 정하면 changeLanguage로 갈아탄다.
initI18n(DEFAULT_LOCALE);

export default i18next;
