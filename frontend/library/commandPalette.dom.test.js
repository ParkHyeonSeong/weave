// @vitest-environment jsdom
//
// ⌘K 팔레트(HN-04·BL-06·UI-04)를 실제로 렌더해 입력 → 목록 → Enter/클릭 결과를 본다.
//   - 두 글자부터 검색 모드가 되면 명령이 통째로 사라졌다('만들'을 쳐도 '브랜치 만들기'가 없음).
//   - 브랜치·캔버스·트랙·스크럼 보드는 이름·키로 찾을 수 없었다.
//   - '멤버' 그룹은 범위 없는 mention-search(항상 빈 결과)에 기대 늘 비어 있었다.
//   - 비관리자에게도 '관리자로 이동'이 보였다.
//   - 만들기 명령은 브랜치·캔버스뿐이었다(홈 '+ 만들기'에는 트랙·스크럼도 있다).
//   - 검색 응답 전에 Enter를 누르면 화면에 없는 이전 검색어의 결과가 열렸다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('@/library/_axios', () => ({
  axios: {
    get: vi.fn(),
    post: vi.fn(() => Promise.resolve({ data: { status: true } })),
    patch: vi.fn(() => Promise.resolve({ data: { status: true } })),
  },
  getBaseURL: () => '',
}));
vi.mock('next/router', () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn(),
    query: {}, pathname: '/', asPath: '/', events: { on: vi.fn(), off: vi.fn() } }),
}));
import { axios } from '@/library/_axios';
import i18next from '@/library/i18n';
import { UiPrefsProvider } from '@/library/UiPrefsContext';
import CommandPalette from '@/components/modal/CommandPalette';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// 사이드바·앱 홈이 쓰는 목록 API의 응답 모양 그대로(필요한 필드만).
const SPACE_LISTS = {
  '/branches': { status: true, branches: [
    { branch_id: 1, branch_name: 'Weave Core', key: 'WV', icon: null, color: '#5E6AD2' },
    { branch_id: 2, branch_name: 'Core Hidden', key: 'HID', icon: null, color: null },
  ] },
  '/canvases': { status: true, canvases: [
    { canvas_id: 5, canvas_name: 'Design Notes', key: 'DSN', icon: 'lucide:rocket', color: null },
  ] },
  '/tracks': { status: true, tracks: [
    { track_id: 7, track_name: 'Release Train', icon: null, color: null },
  ] },
  '/scrum': { status: true, boards: [
    { board_id: 9, name: 'Daily Standup', icon: null, color: null },
  ] },
};

const task = (n, title = `task ${n}`) => ({
  task_id: n, branch_id: 1, display_id: `WV-${n}`, title, status: 'todo', assignees: [],
});

let root = null;
let onClose;

async function flush() {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

// tasks: 검색어 → /chat/task-search 결과(서버 정렬 그대로)
async function mount({ role = 'member', hidden = {}, tasks = {} } = {}) {
  sessionStorage.setItem('profile', JSON.stringify({ user_id: 1, role }));
  axios.get.mockImplementation((url, config) => {
    const q = config?.params?.q;
    if (url === '/profile/ui-prefs') return Promise.resolve({ data: { status: true, ui_prefs: { hidden } } });
    if (url === '/recent-views') return Promise.resolve({ data: { status: true, items: [] } });
    if (SPACE_LISTS[url]) return Promise.resolve({ data: SPACE_LISTS[url] });
    if (url === '/chat/task-search') return Promise.resolve({ data: { status: true, tasks: tasks[q] || [] } });
    if (url === '/chat/doc-search') return Promise.resolve({ data: { status: true, docs: [] } });
    if (url === '/chat/issue-search') return Promise.resolve({ data: { status: true, issues: [] } });
    // 예전 팔레트가 부르던 범위 없는 멘션 검색 — 결과가 와도 팔레트에 나오면 안 된다.
    if (url === '/chat/mention-search') {
      return Promise.resolve({ data: { status: true, users: [{ user_id: 3, username: 'Track Demo' }] } });
    }
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
  onClose = vi.fn();
  root = createRoot(document.getElementById('root'));
  await act(async () => {
    root.render(<UiPrefsProvider fetchEnabled><CommandPalette onClose={onClose} /></UiPrefsProvider>);
  });
  await flush();
}

const input = () => document.querySelector('.CommandPalette__Input');
async function type(value) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input(), value);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function press(key) {
  await act(async () => {
    input().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}
// 300ms 디바운스가 지나고 검색 응답까지 반영될 때까지
async function settle() {
  await act(async () => { await new Promise((r) => setTimeout(r, 350)); });
  await flush();
}

const groupLabels = () => [...document.querySelectorAll('.CommandPalette__GroupLabel')].map((e) => e.textContent);
const itemTexts = () => [...document.querySelectorAll('.CommandPalette__Item')].map((e) => e.textContent);
function groupItems(label) {
  const group = [...document.querySelectorAll('.CommandPalette__Group')]
    .find((g) => g.querySelector('.CommandPalette__GroupLabel').textContent === label);
  return group ? [...group.querySelectorAll('.CommandPalette__Item')] : [];
}
const CREATE_KEYS = ['createBranch', 'createCanvas', 'createTrack', 'createScrum'];

beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  document.body.innerHTML = '<div id="root"></div>';
  // jsdom에는 scrollIntoView가 없다 (활성 항목 스크롤 effect가 부른다)
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
  await i18next.changeLanguage('en');
});

afterEach(async () => {
  if (root) { await act(async () => root.unmount()); root = null; }
});

describe('CommandPalette — 명령은 검색어가 길어져도 남는다', () => {
  it.each([['en', 'create'], ['ko', '만들']])('%s "%s": 맞는 만들기 명령이 결과 맨 앞에 온다(트랙·스크럼 포함)', async (lng, q) => {
    await i18next.changeLanguage(lng);
    await mount({ tasks: { [q]: [task(3, `${q} 관련 태스크`)] } });
    const creates = CREATE_KEYS.map((k) => i18next.t(`modal.palette.actions.${k}`));

    await type(q);
    // 검색 응답을 기다리지 않는다 — 명령은 클라이언트에서 바로 거른다.
    expect(itemTexts().slice(0, 4)).toEqual(creates);

    await settle();
    expect(groupLabels()[0]).toBe(i18next.t('modal.palette.groups.actions'));
    expect(itemTexts().slice(0, 4)).toEqual(creates);
    // 서버 검색 결과는 명령 뒤에 붙는다
    expect(groupLabels()).toContain(i18next.t('modal.palette.groups.tasks'));
    expect(groupItems(i18next.t('modal.palette.groups.tasks'))[0].getAttribute('href')).toBe('/branch/1/task/3');
  });

  it.each([['createTrack', 'layout:create-track'], ['createScrum', 'layout:create-scrum']])(
    '%s는 홈 "+ 만들기"와 같은 %s 이벤트로 모달을 연다',
    async (key, eventName) => {
      await mount();
      const heard = vi.fn();
      window.addEventListener(eventName, heard);
      const label = i18next.t(`modal.palette.actions.${key}`);
      const btn = [...document.querySelectorAll('.CommandPalette__Item')].find((el) => el.textContent === label);
      expect(btn, label).toBeTruthy();
      await act(async () => { btn.click(); });
      window.removeEventListener(eventName, heard);
      expect(heard).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalled();
    },
  );
});

describe('CommandPalette — 한글 조합 중 Enter', () => {
  it('조합을 끝내는 Enter(isComposing)는 맨 위 명령을 실행하지 않고, 조합이 끝난 뒤 Enter는 실행한다', async () => {
    await i18next.changeLanguage('ko');
    await mount();
    const heard = vi.fn();
    window.addEventListener('layout:create-track', heard);
    await type('트랙');
    expect(itemTexts()[0]).toBe(i18next.t('modal.palette.actions.createTrack'));

    await act(async () => {
      input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));
    });
    expect(heard).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    await press('Enter');
    window.removeEventListener('layout:create-track', heard);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });
});

describe('CommandPalette — 관리자로 이동은 관리자에게만', () => {
  it('비관리자에게는 빈 입력에서도, 검색해도 보이지 않는다', async () => {
    const admin = i18next.t('modal.palette.actions.admin');
    await mount({ role: 'member' });
    expect(itemTexts()).toContain(i18next.t('modal.palette.actions.profile'));   // 다른 이동 명령은 그대로
    expect(itemTexts()).not.toContain(admin);
    await type('admin');
    expect(itemTexts()).not.toContain(admin);
  });

  it('관리자에게는 보인다', async () => {
    await mount({ role: 'admin' });
    expect(itemTexts()).toContain(i18next.t('modal.palette.actions.admin'));
  });
});

describe('CommandPalette — 공간 그룹', () => {
  it('내 브랜치·캔버스·트랙·스크럼을 이름·키로 찾고, 개인적으로 숨긴 공간은 뺀다', async () => {
    await mount({ hidden: { branches: [2] } });
    const spaces = i18next.t('modal.palette.groups.spaces');
    const cases = [
      ['core', 'Weave Core', '/branch/1'],        // 이름 — 같은 'core'의 숨긴 브랜치(Core Hidden)는 빠진다
      ['wv', 'Weave Core', '/branch/1'],          // 브랜치 키
      ['dsn', 'Design Notes', '/canvas/5'],       // 캔버스 키
      ['release', 'Release Train', '/tracks/7'],  // 트랙 이름
      ['standup', 'Daily Standup', '/scrum/9'],   // 스크럼 보드 이름
    ];
    for (const [q, name, href] of cases) {
      await type(q);
      const rows = groupItems(spaces);
      expect(rows.map((r) => r.querySelector('.CommandPalette__ItemLabel').textContent), q).toEqual([name]);
      expect(rows[0].getAttribute('href'), q).toBe(href);
    }
  });

  it('Enter를 누르면 그 공간 홈으로 간다', async () => {
    await mount();
    await type('standup');
    await press('Enter');
    expect(push).toHaveBeenCalledWith('/scrum/9');
    expect(onClose).toHaveBeenCalled();
  });
});

describe('CommandPalette — 멤버 그룹 제거', () => {
  it('범위 없는 mention-search를 부르지 않고, 사람 행도 나오지 않는다', async () => {
    await mount();
    await type('track');
    await settle();
    expect(axios.get.mock.calls.map(([url]) => url)).not.toContain('/chat/mention-search');
    expect(itemTexts().some((txt) => txt.includes('Track Demo'))).toBe(false);
  });
});

describe('CommandPalette — 번호로 바로 열기', () => {
  it('WV-12를 치고 Enter: 응답 전에는 이전 검색어(WV-1)의 결과를 열지 않고, 응답 뒤에는 WV-12를 연다', async () => {
    await mount({ tasks: {
      'WV-1': [task(1), task(10), task(11)],
      'WV-12': [task(12), task(120)],       // 서버가 정확히 일치하는 번호를 맨 앞에 준다
    } });
    await type('WV-1');
    await settle();
    await type('WV-12');
    await press('Enter');
    expect(push).not.toHaveBeenCalled();

    await settle();
    await press('Enter');
    expect(push).toHaveBeenCalledWith('/branch/1/task/12');
  });

  it('이전 검색어(WV-1)의 응답이 늦게 도착해도 새 검색어(WV-12) 아래에 끼어들지 않는다', async () => {
    await mount({ tasks: { 'WV-12': [task(12), task(120)] } });
    const tasksLabel = i18next.t('modal.palette.groups.tasks');
    // 'WV-1' 태스크 검색만 응답을 붙잡아 둔다
    let resolveOld;
    const oldResponse = new Promise((r) => { resolveOld = r; });
    const base = axios.get.getMockImplementation();
    axios.get.mockImplementation((url, config) => (
      url === '/chat/task-search' && config?.params?.q === 'WV-1' ? oldResponse : base(url, config)));

    await type('WV-1');
    await settle();                 // 'WV-1' 요청이 나가 응답을 기다리는 중
    await type('WV-12');            // 새 검색어 — 디바운스 대기 중에 옛 응답이 도착한다
    await act(async () => { resolveOld({ data: { status: true, tasks: [task(1), task(10)] } }); });
    await flush();
    expect(groupItems(tasksLabel)).toEqual([]);
    await press('Enter');
    expect(push).not.toHaveBeenCalled();

    await settle();
    expect(groupItems(tasksLabel).map((a) => a.getAttribute('href'))).toEqual(['/branch/1/task/12', '/branch/1/task/120']);
  });
});
