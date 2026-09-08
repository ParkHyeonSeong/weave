// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('@/library/_axios', () => ({ axios: { get: vi.fn(), patch: vi.fn() } }));
import { axios } from '@/library/_axios';

import { UiPrefsProvider } from '@/library/UiPrefsContext';
import { LocaleProvider, LocaleServerSync, useLocale } from '@/library/locale';
import { LOCALE_STORAGE_KEY, LEGACY_LANGUAGE_REGION_KEY } from '@/library/localePrefs';
import i18next from '@/library/i18n';
import LanguageRegionSection from '@/components/Profile/LanguageRegionSection';
import LocaleGate from '@/components/common/LocaleGate';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let activeRoot = null;
let seen = null;

function Probe() {
  const { locale, timeZone, gateOpen } = useLocale();
  seen = { locale, timeZone, gateOpen };
  return <span id="probe">{`${locale}|${timeZone}|${gateOpen}`}</span>;
}

async function mount({ fetchEnabled = true, children = null } = {}) {
  activeRoot = createRoot(document.getElementById('root'));
  await act(async () => {
    activeRoot.render(
      <LocaleProvider>
        <UiPrefsProvider fetchEnabled={fetchEnabled}>
          <LocaleServerSync />
          <Probe />
          {children}
        </UiPrefsProvider>
      </LocaleProvider>,
    );
  });
  await act(async () => {});
}

async function unmount() {
  if (activeRoot) { await act(async () => activeRoot.unmount()); activeRoot = null; }
}

const KO_SEOUL = { locale: 'ko', time_zone: 'Asia/Seoul' };
const EN_NY = { locale: 'en', time_zone: 'America/New_York' };

// 서버를 실제처럼 흉내낸다: PATCH가 top-level 네임스페이스를 병합하고 이후 GET이 그 값을 돌려준다.
let serverState = {};
function serverPrefs(prefs) {
  serverState = { ...prefs };
  axios.get.mockImplementation(async () => ({ data: { status: true, ui_prefs: { ...serverState } } }));
  axios.patch.mockImplementation(async (_url, patch) => {
    Object.assign(serverState, patch);
    return { data: { status: true } };
  });
}
const patchCalls = () => axios.patch.mock.calls.filter((c) => c[0] === '/profile/ui-prefs');

// 브라우저 감지 고정: 언어 en-US, 시간대는 이 테스트 환경의 Intl 값
const detectedTz = () => new Intl.DateTimeFormat().resolvedOptions().timeZone;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  document.body.innerHTML = '<div id="root"></div>';
  document.documentElement.lang = '';
  serverState = {};
  axios.patch.mockResolvedValue({ data: { status: true } });
  Object.defineProperty(navigator, 'languages', { value: ['en-US'], configurable: true });
  i18next.changeLanguage('en');
});

afterEach(unmount);

// ---------------------------------------------------------------------------
// 서버 preference 우선순위
// ---------------------------------------------------------------------------

describe('서버 preference 우선순위', () => {
  it('유효한 서버 값이 권위를 갖고 익명 표시 언어를 갱신한다', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'en');
    serverPrefs({ language_region: KO_SEOUL });
    await mount();

    expect(seen.locale).toBe('ko');
    expect(seen.timeZone).toBe('Asia/Seoul');
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('ko');
    expect(seen.gateOpen).toBe(false);
    expect(patchCalls()).toHaveLength(0);
  });

  it('서버 값이 없으면 gate가 열리고, 자동 PATCH는 절대 없다', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'ko');
    serverPrefs({});
    await mount();

    expect(seen.gateOpen).toBe(true);
    expect(seen.locale).toBe('ko');                 // 기기 언어는 초안
    expect(seen.timeZone).toBe(detectedTz());       // 시간대는 감지값 (기기에 저장된 적 없음)
    expect(patchCalls()).toHaveLength(0);
  });

  it('GET 실패는 "서버 값 없음"으로 단정하지 않는다 — 쓰기도 gate도 없다', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'ko');
    axios.get.mockRejectedValue(new Error('network'));
    await mount();

    expect(seen.locale).toBe('ko');
    expect(seen.gateOpen).toBe(false);
    expect(patchCalls()).toHaveLength(0);
  });

  it('미인증(공개 화면)에서는 조회도 쓰기도 하지 않고 gate도 없다', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'ko');
    await mount({ fetchEnabled: false });

    expect(seen.locale).toBe('ko');
    expect(seen.timeZone).toBe(detectedTz());
    expect(seen.gateOpen).toBe(false);
    expect(axios.get).not.toHaveBeenCalled();
    expect(patchCalls()).toHaveLength(0);
  });

  it('손상된 서버 값은 없는 것으로 취급한다 → gate, PATCH 없음', async () => {
    serverPrefs({ language_region: { locale: 'ko', time_zone: 'KST' } });
    await mount();
    expect(seen.gateOpen).toBe(true);
    expect(patchCalls()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 공용 브라우저: A 로그아웃 → B(서버 값 없음)
// ---------------------------------------------------------------------------

describe('공용 브라우저 계정 전환', () => {
  it('A 로그아웃 후 서버 값 없는 B는 gate를 보고, A의 시간대를 상속받지도 PATCH되지도 않는다', async () => {
    // A의 개인 시간대는 이 테스트 기기의 감지값과 **다른** 값으로 잡는다 — 그래야 "B가 감지값을
    // 본다"와 "A의 시간대가 남지 않는다"를 구분해서 단정할 수 있다(기기가 서울이면 뉴욕, 아니면 서울).
    const A_TZ = detectedTz() === 'Asia/Seoul' ? 'America/New_York' : 'Asia/Seoul';
    serverPrefs({ language_region: { locale: 'ko', time_zone: A_TZ } });
    await mount();
    expect(seen.timeZone).toBe(A_TZ);
    await unmount();

    // 로그아웃: 기기에는 언어만 남는다
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('ko');
    expect(localStorage.getItem(LEGACY_LANGUAGE_REGION_KEY)).toBeNull();
    expect(JSON.stringify(localStorage)).not.toContain(A_TZ);

    // 로그인 화면(미인증): A의 언어로 뜨고 시간대는 감지값
    await mount({ fetchEnabled: false });
    expect(seen.locale).toBe('ko');
    expect(seen.timeZone).toBe(detectedTz());
    await unmount();

    // B: 서버 값 없음 → gate, 초안 시간대 = 감지값(서울 아님), PATCH 없음
    vi.clearAllMocks();
    serverPrefs({});
    await mount({ children: <LocaleGate /> });
    expect(seen.gateOpen).toBe(true);
    expect(seen.timeZone).toBe(detectedTz());
    expect(seen.timeZone).not.toBe(A_TZ);           // A의 시간대는 상속되지 않는다
    expect(document.querySelector('.LocaleGate')).toBeTruthy();
    expect(patchCalls()).toHaveLength(0);

    // B가 Continue를 눌러야 저장된다 — 그때 딱 한 번, B가 고른 값으로
    const en = [...document.querySelectorAll('.LocaleGate .LanguageRegion__Option')]
      .find((b) => b.textContent === 'English');
    await act(async () => { en.click(); });
    expect(seen.locale).toBe('en');                 // 라디오 = 즉시 미리보기(저장 아님)
    expect(patchCalls()).toHaveLength(0);
    await act(async () => { document.querySelector('.LocaleGate__Submit').click(); });
    await act(async () => {});
    expect(patchCalls()).toHaveLength(1);
    expect(patchCalls()[0][1]).toEqual({ language_region: { locale: 'en', time_zone: detectedTz() } });
    expect(seen.gateOpen).toBe(false);
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en');
  });

  it('다른 계정으로 로그인하면 그 계정의 서버 값이 기기 언어를 이긴다', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'ko');
    serverPrefs({ language_region: EN_NY });
    await mount();

    expect(seen.locale).toBe('en');
    expect(seen.timeZone).toBe('America/New_York');
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en');
  });

  it('레거시 객체 미러가 남아 있어도 시간대는 버리고 언어만 옮긴다', async () => {
    localStorage.setItem(LEGACY_LANGUAGE_REGION_KEY, JSON.stringify(KO_SEOUL));
    serverPrefs({});
    await mount();
    expect(seen.locale).toBe('ko');
    expect(seen.timeZone).toBe(detectedTz());
    expect(localStorage.getItem(LEGACY_LANGUAGE_REGION_KEY)).toBeNull();
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('ko');
    expect(seen.gateOpen).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 라우트 이동: UiPrefsProvider만 리마운트되고 LocaleProvider는 살아 있다
// ---------------------------------------------------------------------------

describe('라우트 이동 중 개인 시간대 유지', () => {
  // 기기 감지 시간대와 반드시 다른 계정 시간대를 고른다(개발 기기는 Asia/Seoul → America/New_York).
  const DEVICE_TZ = detectedTz();
  const SERVER_TZ = DEVICE_TZ === 'America/New_York' ? 'Europe/Paris' : 'America/New_York';
  const ACCOUNT = { locale: 'en', time_zone: SERVER_TZ };

  // _app.js와 같은 배치: LocaleProvider는 appReady 게이트 **밖**이고 UiPrefsProvider만 안쪽에서
  // 언마운트·리마운트된다. Probe도 게이트 밖에 둬야 리마운트를 넘어 상태를 관찰할 수 있다.
  async function renderShell({ mounted = true, fetchEnabled = true } = {}) {
    if (!activeRoot) activeRoot = createRoot(document.getElementById('root'));
    await act(async () => {
      activeRoot.render(
        <LocaleProvider>
          <Probe />
          {mounted && (
            <UiPrefsProvider key={fetchEnabled ? 'auth' : 'anon'} fetchEnabled={fetchEnabled}>
              <LocaleServerSync />
            </UiPrefsProvider>
          )}
        </LocaleProvider>,
      );
    });
    await act(async () => {});
  }

  // 응답을 보류시켜 loadStatus='loading' 상태를 관찰한다.
  function pendingGet(uiPrefs) {
    let release;
    axios.get.mockImplementation(() => new Promise((res) => {
      release = () => res({ data: { status: true, ui_prefs: uiPrefs } });
    }));
    return () => release();
  }

  it('조회 중(loading)에는 마지막으로 확인된 계정 시간대를 유지한다', async () => {
    serverPrefs({ language_region: ACCOUNT });
    await renderShell();
    expect(seen.timeZone).toBe(SERVER_TZ);

    // 라우트 변경: appReady=false → UiPrefsProvider만 언마운트
    await renderShell({ mounted: false });
    expect(seen.timeZone).toBe(SERVER_TZ);

    // 재마운트 + 응답 보류(loading)
    const release = pendingGet({ language_region: ACCOUNT });
    await renderShell({ mounted: true });
    expect(seen.timeZone).toBe(SERVER_TZ);        // ← 회귀 지점: 기기 시간대로 튀지 않는다
    expect(seen.timeZone).not.toBe(DEVICE_TZ);
    expect(seen.gateOpen).toBe(false);

    await act(async () => { release(); });
    expect(seen.timeZone).toBe(SERVER_TZ);
    expect(patchCalls()).toHaveLength(0);
  });

  it('조회 실패(error) 동안에도 계정 시간대를 유지한다', async () => {
    serverPrefs({ language_region: ACCOUNT });
    await renderShell();
    expect(seen.timeZone).toBe(SERVER_TZ);

    await renderShell({ mounted: false });
    axios.get.mockRejectedValue(new Error('network'));
    await renderShell({ mounted: true });

    expect(seen.timeZone).toBe(SERVER_TZ);
    expect(seen.gateOpen).toBe(false);            // 실패를 "서버 값 없음"으로 단정하지 않는다
    expect(patchCalls()).toHaveLength(0);
  });

  it('로그아웃(미인증)으로 전환하면 기기 시간대로 초기화되고 다음 사용자에게 상속되지 않는다', async () => {
    serverPrefs({ language_region: ACCOUNT });
    await renderShell();
    expect(seen.timeZone).toBe(SERVER_TZ);

    // 로그아웃 → 공개 화면: fetchEnabled=false ⇒ loadStatus 'skipped'
    await renderShell({ mounted: true, fetchEnabled: false });
    expect(seen.timeZone).toBe(DEVICE_TZ);
    expect(seen.timeZone).not.toBe(SERVER_TZ);

    // 다음 사용자(서버 값 없음): 조회 중에도 이전 계정 시간대가 되살아나지 않는다
    const release = pendingGet({});
    await renderShell({ mounted: true, fetchEnabled: true });
    expect(seen.timeZone).toBe(DEVICE_TZ);
    await act(async () => { release(); });
    expect(seen.gateOpen).toBe(true);
    expect(seen.timeZone).toBe(DEVICE_TZ);
    expect(patchCalls()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 게이트: 저장 실패는 게이트를 닫지 않는다
// ---------------------------------------------------------------------------

describe('최초 선택 게이트', () => {
  it('저장 실패 시 게이트는 열린 채 오류를 보이고, 성공해야 닫힌다', async () => {
    serverPrefs({});
    await mount({ children: <LocaleGate /> });
    expect(seen.gateOpen).toBe(true);

    axios.patch.mockRejectedValueOnce(new Error('boom'));
    await act(async () => { document.querySelector('.LocaleGate__Submit').click(); });
    await act(async () => {});
    expect(seen.gateOpen).toBe(true);
    expect(document.querySelector('.LocaleGate__Error')).toBeTruthy();

    await act(async () => { document.querySelector('.LocaleGate__Submit').click(); });
    await act(async () => {});
    expect(seen.gateOpen).toBe(false);
    expect(patchCalls()).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Profile: 원자 저장 · 즉시 반영 · 새로고침 복원 · 롤백
// ---------------------------------------------------------------------------

describe('Profile에서 변경 — 원자 저장과 즉시 반영', () => {
  const clickSave = async () => {
    const btn = [...document.querySelectorAll('.Profile__SaveBtn')].at(-1);
    await act(async () => { btn.click(); });
    await act(async () => {});
  };
  const pickEnglish = async () => {
    const enBtn = [...document.querySelectorAll('.LanguageRegion__Option')]
      .find((b) => b.textContent === 'English');
    await act(async () => { enBtn.click(); });
  };

  it('locale과 time_zone이 한 번의 PATCH로 함께 나간다', async () => {
    serverPrefs({ language_region: KO_SEOUL });
    await mount({ children: <LanguageRegionSection /> });
    await pickEnglish();
    await clickSave();

    expect(patchCalls()).toHaveLength(1);
    expect(patchCalls()[0][1]).toEqual({ language_region: { locale: 'en', time_zone: 'Asia/Seoul' } });
  });

  it('언어 전환이 즉시 반영되고 <html lang>도 따라간다', async () => {
    serverPrefs({ language_region: KO_SEOUL });
    await mount({ children: <LanguageRegionSection /> });
    expect(document.documentElement.lang).toBe('ko');

    await pickEnglish();
    await clickSave();

    expect(seen.locale).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(i18next.language).toBe('en');
    expect(document.querySelector('.Profile__SectionTitle').textContent).toBe('Language and Region');
  });

  it('새로고침(재마운트) 후 선택이 복원된다', async () => {
    serverPrefs({ language_region: KO_SEOUL });
    await mount({ children: <LanguageRegionSection /> });
    await pickEnglish();
    await clickSave();
    await unmount();

    await mount({ children: <LanguageRegionSection /> });
    expect(seen.locale).toBe('en');
    expect(seen.timeZone).toBe('Asia/Seoul');
  });

  it('저장 실패는 두 값을 함께 마지막 서버 확인값으로 되돌린다', async () => {
    serverPrefs({ language_region: KO_SEOUL });
    await mount({ children: <LanguageRegionSection /> });

    axios.patch.mockRejectedValueOnce(new Error('boom'));
    await pickEnglish();
    await clickSave();
    await act(async () => {});

    expect(seen.locale).toBe('ko');
    expect(seen.timeZone).toBe('Asia/Seoul');
    // 실패는 저장 버튼 옆 짧은 문구로 알린다(모달 아님) — role=alert로 읽힌다.
    const status = document.querySelector('.LanguageRegion__Status--error');
    expect(status).toBeTruthy();
    expect(status.getAttribute('role')).toBe('alert');
    expect(document.querySelector('.LanguageRegion__Status--saved')).toBeNull();
  });
});
