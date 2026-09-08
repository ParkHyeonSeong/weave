// 개인 언어·시간대(language_region) 결정 로직 단일 소스 — 부트스트랩(public/locale-boot.js)·
// 런타임(LocaleProvider)·Setup Wizard·Profile이 모두 이 모듈만 본다.
//
// 저장 계층은 셋이고 역할이 다르다:
//   · 서버 user.ui_prefs.language_region {locale, time_zone} — 로그인한 계정의 유일한 권위.
//   · localStorage['locale'] — **익명 표시 언어**. 로그인 전 화면(로그인·설치)이 마지막 언어로
//     뜨게 하는 기기 편의값이다. 시간대는 절대 여기에 저장하지 않는다 — 공유 브라우저에서
//     이전 계정의 개인 시간대가 다음 계정의 선택으로 둔갑하는 경로를 만들기 때문이다.
//   · 감지값(navigator.languages / Intl) — 제안일 뿐. 사용자가 확정하기 전에는 어디에도 쓰지 않는다.
//
// 서버에 값이 없는 로그인 사용자는 **반드시** 최초 선택 게이트에서 Continue를 눌러야 저장된다.
// 기기값을 서버로 자동 승격하는 경로는 없다(이전 사용자의 시간대 상속 금지).
//
// 저장 단위는 top-level namespace 하나('language_region')다. locale과 time_zone을 별도
// 키로 쪼개면 setNamespaceChecked가 두 번 나가 한쪽만 성공하는 상태가 생긴다 —
// 객체 하나를 통째로 보내야 원자적 성공/롤백이 성립한다.

export const SUPPORTED_LOCALES = ['en', 'ko'];
export const DEFAULT_LOCALE = 'en';
export const FALLBACK_TIME_ZONE = 'UTC';

// 기존(마이그레이션 이전) 서비스의 사실상 동작. 064 백필과 setup 기본값이 같은 값을 쓴다.
export const COMPAT_LOCALE = 'ko';
export const COMPAT_TIME_ZONE = 'Asia/Seoul';

// 익명 표시 언어 키. 값은 'en' | 'ko' 문자열 하나뿐이다.
export const LOCALE_STORAGE_KEY = 'locale';
// 이전 구현이 {locale, time_zone} 객체를 통째로 넣던 키. 읽을 때 locale만 옮기고 지운다 —
// 시간대가 기기에 남아 다음 계정에 상속되는 것을 막는다.
export const LEGACY_LANGUAGE_REGION_KEY = 'language_region';

export function normalizeLocale(raw) {
  return SUPPORTED_LOCALES.includes(raw) ? raw : null;
}

// IANA timezone ID를 canonical 형태로 정규화한다. 유효하지 않으면 null.
//
// ⚠️ Intl.supportedValuesOf('timeZone')만으로 검증하면 안 된다 — 그 목록에 'UTC'가
// 없다(Node 20/브라우저 실측). 그래서 (a) Intl.DateTimeFormat try/catch로 canonical
// 값을 얻고 (b) 그 결과가 supportedValuesOf ∪ {'UTC'}에 있을 때만 통과시킨다.
//
// 이 경로는 별칭도 canonical로 접는다: 'utc'→'UTC', 'Etc/UTC'→'UTC',
// 'US/Eastern'→'America/New_York', 'asia/seoul'→'Asia/Seoul'.
// 'KST' / '+09:00' / 'Asia/Bogus'는 Intl이 throw 해서 거부된다.
// 저장되는 값은 항상 canonical IANA ID이므로 약어나 숫자 offset은 DB에 들어가지 않는다.
let _zoneSet = null;
function zoneSet() {
  if (_zoneSet) return _zoneSet;
  let list = [];
  try {
    list = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  } catch { list = []; }
  _zoneSet = new Set(list);
  _zoneSet.add('UTC');   // supportedValuesOf에 없다 — 명시적으로 넣는다
  return _zoneSet;
}

export function canonicalTimeZone(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let canonical;
  try {
    canonical = new Intl.DateTimeFormat('en-US', { timeZone: raw.trim() })
      .resolvedOptions().timeZone;
  } catch {
    return null;
  }
  if (!canonical) return null;
  // supportedValuesOf를 못 쓰는 런타임(구형)에서는 Intl 통과만으로 인정한다 —
  // 여기서 전부 거부하면 그런 브라우저는 시간대를 아예 못 고른다.
  const zones = zoneSet();
  if (zones.size <= 1) return canonical;
  return zones.has(canonical) ? canonical : null;
}

// language_region 객체 정규화. locale·time_zone **둘 다** 유효할 때만 값을 돌려준다.
// 한쪽만 유효한 반쪽 상태를 통과시키면 소비자마다 폴백이 갈린다.
export function normalizeLanguageRegion(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const locale = normalizeLocale(raw.locale);
  const timeZone = canonicalTimeZone(raw.time_zone);
  if (!locale || !timeZone) return null;
  return { locale, time_zone: timeZone };
}

export function sameLanguageRegion(a, b) {
  return !!a && !!b && a.locale === b.locale && a.time_zone === b.time_zone;
}

// ---------------------------------------------------------------------------
// 감지 — 제안일 뿐이다. 사용자가 확정하기 전에는 미러에도 서버에도 쓰지 않는다.
// ---------------------------------------------------------------------------

// BCP-47 태그의 기본 언어 서브태그('en-US'→'en', 'ko_KR'→'ko', 'kok'→'kok').
function baseLanguage(tag) {
  if (typeof tag !== 'string') return '';
  return tag.trim().toLowerCase().split(/[-_]/, 1)[0];
}

// 브라우저 언어 감지의 **단일 규칙** — public/locale-boot.js(buildLocaleBootstrapScript)와
// 정확히 같은 결론을 내야 한다(i18nCatalog.test.js가 복수 목록으로 대조한다).
//   navigator.languages 순서대로 보면서 첫 번째 **지원 언어**를 고른다:
//   en 계열 → 'en', ko 계열 → 'ko', 지원 언어가 하나도 없으면 'en'.
//   ['en-US','ko-KR'] → 'en'   ['fr-FR','ko-KR'] → 'ko'   ['fr-FR','de'] → 'en'
export function detectLocale(languages) {
  const list = Array.isArray(languages) ? languages : (languages ? [languages] : []);
  for (const raw of list) {
    const base = baseLanguage(raw);
    if (base === 'ko') return 'ko';
    if (base === 'en') return 'en';
  }
  return DEFAULT_LOCALE;
}

export function detectTimeZone() {
  try {
    return canonicalTimeZone(new Intl.DateTimeFormat().resolvedOptions().timeZone)
      || FALLBACK_TIME_ZONE;
  } catch {
    return FALLBACK_TIME_ZONE;
  }
}

export function detectLanguageRegion(languages) {
  return { locale: detectLocale(languages), time_zone: detectTimeZone() };
}

// ---------------------------------------------------------------------------
// 익명 표시 언어(localStorage) — locale 문자열만
// ---------------------------------------------------------------------------

export function readLocaleMirror(storage) {
  let store;
  try { store = storage || window.localStorage; } catch { return null; }
  try {
    const direct = normalizeLocale(store.getItem(LOCALE_STORAGE_KEY));
    if (direct) return direct;
  } catch { /* fallthrough */ }
  // 레거시 객체 키에서 locale만 회수하고 키를 지운다 — 시간대는 버린다(상속 금지).
  try {
    const raw = store.getItem(LEGACY_LANGUAGE_REGION_KEY);
    if (raw == null) return null;
    let migrated = null;
    try { migrated = normalizeLocale(JSON.parse(raw)?.locale); } catch { migrated = null; }
    try { store.removeItem(LEGACY_LANGUAGE_REGION_KEY); } catch {}
    if (migrated) {
      try { store.setItem(LOCALE_STORAGE_KEY, migrated); } catch {}
    }
    return migrated;
  } catch {
    return null;
  }
}

export function writeLocaleMirror(locale, storage) {
  const norm = normalizeLocale(locale);
  if (!norm) return;
  try {
    const store = storage || window.localStorage;
    store.setItem(LOCALE_STORAGE_KEY, norm);
  } catch { /* private 모드 등 — 무시 */ }
}

// ---------------------------------------------------------------------------
// 부트스트랩 — 첫 페인트 전에 <html lang>을 맞춘다
// ---------------------------------------------------------------------------
//
// public/locale-boot.js의 생성원(자족 IIFE). ⚠️ 인라인 <script nonce>로 넣으면 안 된다 —
// custom _document.getInitialProps는 정적 최적화(ASO)를 끄지 않아 prod 정적 HTML의 nonce가
// 빈 값이 되고, middleware는 요청마다 새 nonce를 CSP에 넣으므로 인라인은 차단된다.
// 외부 파일은 script-src 'self'로 통과한다(theme-boot.js와 같은 이유·같은 패턴).
//
// 부트스트랩은 서버 값을 알 수 없다 — 익명 표시 언어(확정값) → 브라우저 감지 순으로만
// 해석하며, 서버 값 채택은 LocaleServerSync가 나중에 <html lang>을 교정한다.
// 감지 규칙은 detectLocale과 동일하다(navigator.languages 순서대로 첫 지원 언어).
// i18nCatalog.test.js가 이 함수와 파일의 바이트 parity + 런타임과의 동치를 강제한다.
export function buildLocaleBootstrapScript() {
  // storage 읽기만 try — 정규화·해석은 항상 실행한다(theme-boot.js와 같은 규율).
  const readStored = `var v=null;try{var s=localStorage.getItem('${LOCALE_STORAGE_KEY}');if(s==='en'||s==='ko')v=s;}catch(e){}`;
  // 레거시 객체 키는 읽기만 한다(정리는 런타임 readLocaleMirror가 한다).
  const readLegacy = `if(!v){try{var o=JSON.parse(localStorage.getItem('${LEGACY_LANGUAGE_REGION_KEY}'));if(o&&(o.locale==='en'||o.locale==='ko'))v=o.locale;}catch(e){}}`;
  const detect = `if(!v){var L=(navigator.languages&&navigator.languages.length)?navigator.languages:[navigator.language||''];for(var i=0;i<L.length&&!v;i++){var b=String(L[i]||'').trim().toLowerCase().split(/[-_]/)[0];if(b==='ko')v='ko';else if(b==='en')v='en';}}`;
  return `(function(){${readStored}${readLegacy}${detect}document.documentElement.lang=v||'${DEFAULT_LOCALE}';})();`;
}

// ---------------------------------------------------------------------------
// 전이표. 이 함수 하나만이 우선순위를 안다.
// ---------------------------------------------------------------------------
//
// 입력:
//   loadStatus    UiPrefsContext의 'loading'|'success'|'error'|'skipped'
//   serverValue   prefs.language_region (검증 전 원시값)
//   deviceLocale  localStorage의 익명 표시 언어('en'|'ko'|null)
//   detected      {locale, time_zone} 감지값
//   confirmed     마지막으로 **인증 조회 성공**으로 채택한 계정 값 (없으면 null)
// 반환:
//   value             현재 화면에 적용할 {locale, time_zone} (항상 유효)
//   localeMirrorWrite localStorage['locale']에 써야 할 값 (없으면 null)
//   showGate          최초 선택 게이트를 띄워야 하는가
//   nextConfirmed     호출부가 새로 기억할 confirmed 값 (null이면 잊는다)
//
// 서버 권위는 'success'에만 적용된다 — 'error'에서 "서버 값이 없다"고 단정하면 다음 PATCH가
// 사용자의 실제 서버 설정을 덮어쓴다. 서버 값이 없을 때 기기값을 서버로 올리는 경로는 없다:
// 사용자가 게이트에서 Continue를 눌러야만 저장된다.
//
// confirmed가 필요한 이유: 라우트가 바뀔 때마다 _app.js의 appReady 게이트가 UiPrefsProvider를
// 리마운트해 loadStatus가 'loading'으로 되돌아간다. 그때 감지값을 다시 채택하면 저장된 개인
// 시간대가 페이지 이동마다 한 번씩 기기 시간대로 튄다 → 확인된 계정 값이 있으면 'loading'·'error'
// 동안 그대로 유지한다. 반대로 'skipped'(로그아웃·공개 화면)에서는 계정 값을 **버린다** —
// 이전 계정의 시간대가 다음 사용자에게 상속되면 안 된다.
export function mergeServerLanguageRegion({ loadStatus, serverValue, deviceLocale, detected, confirmed }) {
  const server = normalizeLanguageRegion(serverValue);
  const device = normalizeLocale(deviceLocale);
  const det = normalizeLanguageRegion(detected)
    || { locale: DEFAULT_LOCALE, time_zone: FALLBACK_TIME_ZONE };
  // 서버 값이 없을 때의 화면값: 언어는 익명 표시 언어(있으면), 시간대는 **감지값**.
  // 이전 계정의 시간대는 어디에도 남아 있지 않으므로 상속될 수 없다.
  const local = { locale: device || det.locale, time_zone: det.time_zone };
  const kept = normalizeLanguageRegion(confirmed);

  if (loadStatus === 'success') {
    if (server) {
      // 서버가 권위. 익명 표시 언어가 다르면 서버 언어로 맞춘다(다음 로그인 화면이 이 언어로 뜬다).
      return {
        value: server,
        localeMirrorWrite: server.locale === device ? null : server.locale,
        showGate: false,
        nextConfirmed: server,
      };
    }
    // 서버에 값이 없다 → 최초 선택 게이트. 기기값은 초안일 뿐 저장되지 않는다.
    return { value: local, localeMirrorWrite: null, showGate: true, nextConfirmed: null };
  }

  if (loadStatus === 'skipped') {
    // 미인증(로그아웃·공개 화면): 계정 값을 여기서 버린다 — 다음 사용자에게 상속 금지.
    return { value: local, localeMirrorWrite: null, showGate: false, nextConfirmed: null };
  }

  // 조회 중(loading) · 조회 실패(error): 절대 앱을 막지 않고 쓰지도 않는다.
  // 확인된 계정 값이 있으면 그대로 유지한다(라우트 이동마다 기기 시간대로 튀지 않게).
  return { value: kept || local, localeMirrorWrite: null, showGate: false, nextConfirmed: kept || null };
}
