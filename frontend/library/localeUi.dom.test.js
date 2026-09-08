// @vitest-environment jsdom
//
// 로그인 언어 메뉴와 Profile 언어·시간대 섹션의 **구조와 키보드 동작**을 고정한다.
// 픽셀 스냅샷은 만들지 않는다 — 배치는 Playwright로 실제 브라우저에서 확인하고,
// 여기서는 그 배치를 가능하게 하는 DOM 계약(부모-자식 관계, 클래스, 포커스 이동)만 본다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('@/library/_axios', () => ({ axios: { get: vi.fn(), patch: vi.fn(), post: vi.fn() } }));
vi.mock('next/router', () => ({
  useRouter: () => ({
    push: vi.fn(), replace: vi.fn(), query: {}, pathname: '/auth/login', asPath: '/auth/login',
  }),
}));
import { axios } from '@/library/_axios';

import { UiPrefsProvider } from '@/library/UiPrefsContext';
import { LocaleProvider } from '@/library/locale';
import { LocaleServerSync } from '@/library/locale';
import i18next from '@/library/i18n';
import Login from '@/components/Auth/Login';
import LanguageRegionSection from '@/components/Profile/LanguageRegionSection';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let activeRoot = null;

async function mount(children, { fetchEnabled = true } = {}) {
  activeRoot = createRoot(document.getElementById('root'));
  await act(async () => {
    activeRoot.render(
      <LocaleProvider>
        <UiPrefsProvider fetchEnabled={fetchEnabled}>
          <LocaleServerSync />
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

const key = (el, k) => act(async () => {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
});
const click = (el) => act(async () => { el.click(); });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  document.body.innerHTML = '<div id="root"></div>';
  axios.get.mockResolvedValue({ data: { status: true, ui_prefs: {} } });
  axios.patch.mockResolvedValue({ data: { status: true } });
  Object.defineProperty(navigator, 'languages', { value: ['en-US'], configurable: true });
  i18next.changeLanguage('en');
});

afterEach(unmount);

// ---------------------------------------------------------------------------
// 로그인 화면: 언어 선택은 카드 **아래**, 카드 옆이 아니다
// ---------------------------------------------------------------------------

describe('로그인 언어 선택의 위치 구조', () => {
  it('카드와 언어 바가 같은 세로 스택 안에 순서대로 들어간다', async () => {
    await mount(<Login />, { fetchEnabled: false });

    const shell = document.querySelector('.Login__Shell');
    const card = document.querySelector('.Login__Card');
    const bar = document.querySelector('.Login__LocaleBar');
    expect(shell).toBeTruthy();
    // 카드와 언어 바는 형제가 아니라 **같은 스택의 자식**이고, 언어 바가 카드 뒤에 온다.
    expect(card.parentElement).toBe(shell);
    expect(bar.parentElement).toBe(shell);
    expect(card.nextElementSibling).toBe(bar);
    // .Login의 직계 자식으로 떠 있으면(수정 전 구조) 카드 옆에 가로로 배치된다 — 그 구조가 아니어야 한다.
    expect(document.querySelector('.Login > .Login__LocaleBar')).toBeNull();
  });

  it('로그인 전에는 시간대 선택을 노출하지 않는다', async () => {
    await mount(<Login />, { fetchEnabled: false });
    await click(document.querySelector('.LanguageRegionMenu__Trigger'));
    expect(document.querySelector('.LanguageRegionMenu__Popover')).toBeTruthy();
    expect(document.querySelector('.TimeZoneSelect')).toBeNull();
  });

  it('팝오버는 trigger 아래 가운데로 열린다 (위쪽 카드를 덮지 않게)', async () => {
    await mount(<Login />, { fetchEnabled: false });
    await click(document.querySelector('.LanguageRegionMenu__Trigger'));
    const pop = document.querySelector('.LanguageRegionMenu__Popover');
    expect(pop.className).toContain('LanguageRegionMenu__Popover--below');
  });
});

describe('로그인 언어 메뉴의 키보드 동작', () => {
  const trigger = () => document.querySelector('.LanguageRegionMenu__Trigger');
  const options = () => [...document.querySelectorAll('.LanguageRegionMenu__Popover [role="radio"]')];

  it('열면 현재 언어로 포커스가 가고, 방향키로 이동하면 즉시 적용된다', async () => {
    localStorage.setItem('locale', 'en');
    await mount(<Login />, { fetchEnabled: false });

    await click(trigger());
    const [en, ko] = options();
    expect(document.activeElement).toBe(en);        // 현재 언어 항목에 포커스
    expect(en.getAttribute('aria-checked')).toBe('true');
    expect(en.tabIndex).toBe(0);                    // roving tabindex — 그룹의 탭 정지는 하나
    expect(ko.tabIndex).toBe(-1);

    await key(en, 'ArrowRight');
    expect(document.activeElement).toBe(ko);
    expect(ko.getAttribute('aria-checked')).toBe('true');
    expect(localStorage.getItem('locale')).toBe('ko');
    expect(document.documentElement.lang).toBe('ko');
    expect(document.querySelector('.LanguageRegionMenu__Popover')).toBeTruthy();  // 방향키로는 안 닫힌다

    await key(ko, 'ArrowLeft');                     // 되돌아온다(순환)
    expect(localStorage.getItem('locale')).toBe('en');
  });

  it('Escape는 팝오버를 닫고 포커스를 trigger로 되돌린다', async () => {
    await mount(<Login />, { fetchEnabled: false });
    await click(trigger());
    await key(options()[0], 'Escape');

    expect(document.querySelector('.LanguageRegionMenu__Popover')).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('언어를 활성화(클릭·Enter)하면 적용하고 닫은 뒤 trigger로 포커스가 돌아온다', async () => {
    localStorage.setItem('locale', 'en');
    await mount(<Login />, { fetchEnabled: false });
    await click(trigger());
    await click(options()[1]);                      // 버튼 click = Enter/Space와 같은 경로

    expect(localStorage.getItem('locale')).toBe('ko');
    expect(document.querySelector('.LanguageRegionMenu__Popover')).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('미인증 화면에서는 언어 선택이 서버로 나가지 않는다', async () => {
    await mount(<Login />, { fetchEnabled: false });
    await click(trigger());
    await click(options()[1]);
    expect(axios.patch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Profile: 두 개의 설정 행 + 한 문장 보조 문구 + 명확한 저장 상태
// ---------------------------------------------------------------------------

const SERVER = { language_region: { locale: 'ko', time_zone: 'America/New_York' } };

async function mountProfile() {
  axios.get.mockResolvedValue({ data: { status: true, ui_prefs: { ...SERVER } } });
  await mount(<LanguageRegionSection />);
}

describe('Profile 언어·시간대 섹션의 구조', () => {
  it('언어와 시간대가 라벨/컨트롤 두 행으로 구성된다 (모바일에서는 SCSS가 세로로 쌓는다)', async () => {
    await mountProfile();
    const rows = [...document.querySelectorAll('.LanguageRegion__Row')];
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.querySelector('.LanguageRegion__RowLabel')).toBeTruthy();
      expect(row.querySelector('.LanguageRegion__RowControl')).toBeTruthy();
    }
    // 라벨이 컨트롤을 실제로 가리켜야 한다(스크린리더에서 행의 의미가 유지된다).
    const group = rows[0].querySelector('[role="radiogroup"]');
    expect(group.getAttribute('aria-labelledby'))
      .toBe(rows[0].querySelector('.LanguageRegion__RowLabel').id);
    expect(rows[1].querySelector('label').htmlFor)
      .toBe(rows[1].querySelector('.TimeZoneSelect__Trigger').id);
  });

  it('언어 선택은 compact segmented control이다 (큰 카드형 버튼이 아니다)', async () => {
    await mountProfile();
    const group = document.querySelector('.LanguageRegion__Row [role="radiogroup"]');
    expect(group.className).toContain('LanguageRegion__Options--segmented');
    expect(group.querySelectorAll('[role="radio"]')).toHaveLength(2);
  });

  it('보조 문구는 제목 아래 한 문장과 범위 설명 한 문장뿐이다', async () => {
    await mountProfile();
    expect(document.querySelectorAll('.LanguageRegion__SectionHint')).toHaveLength(1);
    expect(document.querySelectorAll('.LanguageRegion__Note')).toHaveLength(1);
    // 개인/워크스페이스 구분을 두 문단으로 되풀이하지 않는다.
    expect(document.querySelector('.LanguageRegion__Note--muted')).toBeNull();
  });

  it('시간대 trigger는 도시명과 offset을 먼저, IANA ID는 보조로 보여준다', async () => {
    await mountProfile();
    const trig = document.querySelector('.TimeZoneSelect__Trigger');
    expect(trig.querySelector('.TimeZoneSelect__City').textContent).toBe('New York');
    expect(trig.querySelector('.TimeZoneSelect__Offset').textContent).toMatch(/^GMT[+-]/);
    expect(trig.querySelector('.TimeZoneSelect__Id').textContent).toBe('America/New_York');
  });
});

describe('Profile 저장 상태', () => {
  const saveBtn = () => document.querySelector('.Profile__SaveBtn');
  const pickEnglish = () => click(
    [...document.querySelectorAll('.LanguageRegion__Option')].find((b) => b.textContent === 'English'),
  );

  it('변경 없음 → 저장 비활성, 성공 → 짧은 inline 문구(모달 아님)', async () => {
    await mountProfile();
    expect(saveBtn().disabled).toBe(true);
    expect(document.querySelector('.LanguageRegion__Status')).toBeNull();

    await pickEnglish();
    expect(saveBtn().disabled).toBe(false);

    await click(saveBtn());
    await act(async () => {});
    const saved = document.querySelector('.LanguageRegion__Status--saved');
    expect(saved).toBeTruthy();
    expect(saved.getAttribute('role')).toBe('status');
    // 성공 표시는 저장 버튼 옆에 있고, 모달/오버레이를 열지 않는다.
    expect(saved.closest('.LanguageRegion__Actions')).toBeTruthy();
    expect(saveBtn().disabled).toBe(true);          // 다시 변경 없음 상태
  });

  it('locale과 time_zone은 한 번의 PATCH로 함께 나간다', async () => {
    await mountProfile();
    await pickEnglish();
    await click(saveBtn());
    await act(async () => {});
    const calls = axios.patch.mock.calls.filter((c) => c[0] === '/profile/ui-prefs');
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toEqual({
      language_region: { locale: 'en', time_zone: 'America/New_York' },
    });
  });
});

describe('시간대 선택기 — 검색과 키보드', () => {
  const trigger = () => document.querySelector('.TimeZoneSelect__Trigger');
  const search = () => document.querySelector('.TimeZoneSelect__Search');
  const optionLabels = () => [...document.querySelectorAll('.TimeZoneSelect__Option .TimeZoneSelect__Id')]
    .map((el) => el.textContent);

  const type = (value) => act(async () => {
    const input = search();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

  it('열면 검색창으로 포커스가 가고 현재 값이 활성 항목이다', async () => {
    await mountProfile();
    await click(trigger());
    expect(document.activeElement).toBe(search());
    const active = document.querySelector('.TimeZoneSelect__Option[data-active="true"]');
    expect(active.querySelector('.TimeZoneSelect__Id').textContent).toBe('America/New_York');
    expect(search().getAttribute('aria-activedescendant')).toBe(active.id);
  });

  it('공백과 underscore 어느 쪽으로 검색해도 같은 결과가 나온다', async () => {
    await mountProfile();
    await click(trigger());

    await type('new york');
    const withSpace = optionLabels();
    expect(withSpace).toContain('America/New_York');

    await type('new_york');
    expect(optionLabels()).toEqual(withSpace);
  });

  it('ArrowDown·Enter로 고르고 Escape로 닫으면 포커스가 trigger로 돌아온다', async () => {
    await mountProfile();
    await click(trigger());
    await type('asia/seo');
    await key(search(), 'ArrowDown');               // 한 항목뿐이면 그 자리에 머문다
    await key(search(), 'Enter');

    expect(document.querySelector('.TimeZoneSelect__Popover')).toBeNull();
    expect(trigger().querySelector('.TimeZoneSelect__Id').textContent).toBe('Asia/Seoul');
    expect(document.activeElement).toBe(trigger());

    await click(trigger());
    await key(search(), 'Escape');
    expect(document.querySelector('.TimeZoneSelect__Popover')).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });
});
