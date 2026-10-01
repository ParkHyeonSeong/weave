// @vitest-environment jsdom
// 이 기기 푸시 구독의 생애를 사용자 흐름으로 본다.
//   1) 로그아웃 3경로(Header · Command Palette · auth-expired)에서 이 기기 구독이 끊긴다.
//      서버 행 삭제(DELETE /push/unsubscribe)는 로그인이 필요하므로 /auth/logout보다 먼저 간다.
//   2) 페이지 로드가 알림 권한 창을 스스로 띄우지 않는다(이미 허용한 기기는 조용히 구독).
//   3) 종 드롭다운에서 사용자가 직접 켠다 — 권한 요청은 클릭 안에서 시작돼야 한다.
// jsdom에는 serviceWorker · PushManager · Notification이 없어 최소 가짜를 세운다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import i18next from '@/library/i18n';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const replace = vi.fn();
vi.mock('next/router', () => ({
  useRouter: () => ({ replace, push: vi.fn(), pathname: '/', query: {}, asPath: '/',
    events: { on: vi.fn(), off: vi.fn() } }),
}));
// Layout 마운트에서 보는 것은 권한·구독 effect뿐이다 — 그리지 않는 무거운 자식은 비운다.
vi.mock('@/components/Messenger/Messenger', () => ({ default: () => null }));
vi.mock('@/components/Layout/Sidebar', () => ({ default: () => null }));
vi.mock('@/components/Layout/Footer', () => ({ default: () => null }));
vi.mock('@/components/modal/CreateBranch', () => ({ default: () => null }));
vi.mock('@/components/modal/CreateCanvas', () => ({ default: () => null }));
vi.mock('@/components/modal/CreateTrack', () => ({ default: () => null }));
vi.mock('@/components/modal/CreateScrumBoard', () => ({ default: () => null }));

const ENDPOINT = 'https://push.example.test/ep-1';

let root = null;
let calls = [];     // 브라우저·서버 호출을 일어난 순서대로 적는다
let bodies = {};    // 서버 요청 본문(마지막 값)
let push = null;    // 가짜 푸시 환경 핸들
const OriginalWebSocket = globalThis.WebSocket;

// holdSubscribe: 브라우저 구독 생성(pushManager.subscribe)을 push.releaseSubscribe()가 불릴 때까지 붙잡는다
function installPush({
  permission = 'granted', subscribed = true, onRequest = 'granted', registered = true, holdSubscribe = false,
} = {}) {
  let current = null;
  const subscription = {
    endpoint: ENDPOINT,
    getKey: () => new Uint8Array([1, 2, 3]).buffer,
    unsubscribe: vi.fn(async () => { calls.push('browser unsubscribe'); current = null; return true; }),
  };
  if (subscribed) current = subscription;
  const create = () => { calls.push('browser subscribe'); current = subscription; return subscription; };
  const pushManager = {
    getSubscription: vi.fn(async () => current),
    subscribe: vi.fn(() => (holdSubscribe
      ? new Promise((resolve) => { push.releaseSubscribe = () => resolve(create()); })
      : Promise.resolve(create()))),
  };
  const registration = registered ? { pushManager } : undefined;
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      // 활성 서비스워커가 없으면 ready는 끝나지 않는다(실제 브라우저와 같다)
      ready: registration ? Promise.resolve(registration) : new Promise(() => {}),
      getRegistration: vi.fn(async () => registration),
    },
  });
  window.PushManager = function PushManager() {};
  const Notification = {
    permission,
    requestPermission: vi.fn(async () => {
      calls.push('permission request');
      Notification.permission = onRequest;
      return onRequest;
    }),
  };
  window.Notification = Notification;
  push = { subscription, pushManager, Notification };
  return push;
}

function uninstallPush() {
  delete navigator.serviceWorker;
  delete window.PushManager;
  delete window.Notification;
}

async function stubServer(overrides = {}) {
  const { axios } = await import('@/library/_axios');
  axios.defaults.adapter = async (config) => {
    const key = `${config.method.toUpperCase()} ${config.url}`;
    calls.push(key);
    bodies[key] = config.data;
    if (overrides[key]) return overrides[key](config);
    const data = { status: true, notifications: [], count: 0, rooms: [] };
    if (key === 'GET /push/vapid-key') data.vapid_key = 'BAAA';
    return { data, status: 200, statusText: 'OK', headers: {}, config };
  };
  return axios;
}

// 동적 import·프라미스 체인·React 갱신이 가라앉을 때까지 매크로태스크를 몇 번 돌린다.
async function settle(rounds = 6) {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
}

async function mount(element) {
  root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(element); });
}

beforeEach(async () => {
  calls = [];
  bodies = {};
  replace.mockClear();
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  localStorage.clear();
  sessionStorage.clear();
  sessionStorage.setItem('profile', JSON.stringify({ user_id: 1, username: 'ann' }));
  document.body.innerHTML = '<div id="root"></div>';
  await i18next.changeLanguage('en');
  // 앞 테스트가 남긴 이 페이지의 등록 확인 기록을 비운다(푸시 환경을 세우기 전이라 상태만 비우고 끝난다)
  const { unsubscribeFromPush } = await import('@/library/pushSubscription');
  await unsubscribeFromPush({ server: false });
});

afterEach(async () => {
  if (root) { await act(async () => root.unmount()); root = null; }
  uninstallPush();
  globalThis.WebSocket = OriginalWebSocket;
  vi.restoreAllMocks();
});

describe('로그아웃하면 이 기기의 푸시 구독을 끊는다', () => {
  async function logoutFromHeader() {
    const { default: Header } = await import('@/components/Layout/Header');
    await mount(<Header isMobile={false} />);
    await act(async () => { document.querySelector('.Header__Avatar').click(); });
    await act(async () => { document.querySelector('.Header__SettingsItem--danger').click(); });
    await settle();
  }

  it('L1 Header — 서버 구독 삭제를 /auth/logout보다 먼저 보내고 브라우저 구독도 끊는다', async () => {
    installPush({ subscribed: true });
    await stubServer();

    await logoutFromHeader();

    expect(calls).toContain('DELETE /push/unsubscribe');
    expect(calls.indexOf('DELETE /push/unsubscribe')).toBeLessThan(calls.indexOf('POST /auth/logout'));
    expect(JSON.parse(bodies['DELETE /push/unsubscribe'])).toEqual({ endpoint: ENDPOINT });
    expect(push.subscription.unsubscribe).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalled();
  });

  it('L1 Header — 서버 삭제가 실패해도 브라우저 구독은 끊고 로그아웃은 계속된다', async () => {
    installPush({ subscribed: true });
    await stubServer({
      'DELETE /push/unsubscribe': (config) => {
        const err = new Error('server down');
        err.config = config;
        err.response = { status: 500, data: {}, config };
        throw err;
      },
    });

    await logoutFromHeader();

    expect(push.subscription.unsubscribe).toHaveBeenCalledTimes(1);
    expect(calls).toContain('POST /auth/logout');
    expect(sessionStorage.getItem('profile')).toBeNull();
    expect(replace).toHaveBeenCalled();
  });

  it('L1 Header — 이 기기에 구독이 없으면 서버 삭제를 보내지 않고 그대로 로그아웃한다', async () => {
    installPush({ subscribed: false });
    await stubServer();

    await logoutFromHeader();

    expect(calls).not.toContain('DELETE /push/unsubscribe');
    expect(calls).toContain('POST /auth/logout');
    expect(replace).toHaveBeenCalled();
  });

  it('L2 Command Palette — 서버 구독 삭제가 /auth/logout보다 먼저 가고 브라우저 구독도 끊긴다', async () => {
    installPush({ subscribed: true });
    await stubServer();
    const { default: CommandPalette } = await import('@/components/modal/CommandPalette');
    await mount(<CommandPalette isOpen onClose={() => {}} />);

    const logout = [...document.querySelectorAll('.CommandPalette__Item')]
      .find((el) => el.textContent.includes(i18next.t('auth.signOut')));
    await act(async () => { logout.click(); });
    await settle();

    expect(calls).toContain('DELETE /push/unsubscribe');
    expect(calls.indexOf('DELETE /push/unsubscribe')).toBeLessThan(calls.indexOf('POST /auth/logout'));
    expect(push.subscription.unsubscribe).toHaveBeenCalledTimes(1);
    // 화면 정리·이동은 지금처럼 네트워크를 기다리지 않는다
    expect(sessionStorage.getItem('profile')).toBeNull();
    expect(replace).toHaveBeenCalled();
  });

  it('L3 auth-expired — 인증이 이미 없으니 서버 삭제 없이 브라우저 구독만 끊는다 (실물 인터셉터)', async () => {
    installPush({ subscribed: true });
    const { axios } = await import('@/library/_axios');
    axios.defaults.adapter = async (config) => {
      calls.push(`${config.method.toUpperCase()} ${config.url}`);
      const err = new Error('unauthorized');
      err.config = config;
      err.response = { status: 401, data: {}, config };
      throw err;
    };

    await expect(axios.get('/anything', { _skipAuthRetry: true })).rejects.toBeTruthy();
    await settle();

    expect(push.subscription.unsubscribe).toHaveBeenCalledTimes(1);
    expect(calls).not.toContain('DELETE /push/unsubscribe');
  });

  it('로그아웃이 구독을 확인한 뒤에 늦게 끝난 자동 구독은 서버에 등록하지 않고 브라우저에서도 지운다', async () => {
    installPush({ permission: 'granted', subscribed: false, holdSubscribe: true });
    await stubServer();
    globalThis.WebSocket = class { close() {} send() {} };
    const { default: Layout } = await import('@/components/Layout/Layout');
    await mount(<Layout><div /></Layout>);   // 로드 때 자동 구독 — 브라우저 구독 생성에서 멈춰 있다
    await settle();
    expect(push.pushManager.subscribe).toHaveBeenCalledTimes(1);

    await act(async () => { document.querySelector('.Header__Avatar').click(); });
    await act(async () => { document.querySelector('.Header__SettingsItem--danger').click(); });
    await settle();
    expect(calls).toContain('POST /auth/logout');          // 로그아웃은 이 기기에 구독이 없다고 보고 끝났다

    await act(async () => { push.releaseSubscribe(); });   // 그 뒤에 브라우저 구독이 생긴다
    await settle();
    expect(calls).not.toContain('POST /push/subscribe');   // 이전 계정으로 서버에 등록하지 않는다
    expect(push.subscription.unsubscribe).toHaveBeenCalledTimes(1);   // 이 기기에도 남기지 않는다
  });

  it('서비스워커 등록이 없는 브라우저에서 구독 해제가 멈추지 않는다 (로그아웃이 끝나야 한다)', async () => {
    installPush({ registered: false });
    await stubServer();
    const { unsubscribeFromPush } = await import('@/library/pushSubscription');

    const outcome = await Promise.race([
      unsubscribeFromPush().then(() => 'done'),
      new Promise((r) => setTimeout(() => r('hung'), 300)),
    ]);

    expect(outcome).toBe('done');
    expect(calls).not.toContain('DELETE /push/unsubscribe');
  });
});

describe('페이지 로드가 알림 권한을 스스로 묻지 않는다', () => {
  class FakeWebSocket {
    constructor(url) { this.url = url; }
    close() {}
    send() {}
  }

  async function mountLayout() {
    globalThis.WebSocket = FakeWebSocket;
    const { default: Layout } = await import('@/components/Layout/Layout');
    await mount(<Layout><div /></Layout>);
    await settle();
  }

  it('권한을 아직 정하지 않은 기기 — 마운트해도 권한 창을 띄우지 않고 구독도 만들지 않는다', async () => {
    installPush({ permission: 'default', subscribed: false });
    await stubServer();

    await mountLayout();

    expect(push.Notification.requestPermission).not.toHaveBeenCalled();
    expect(push.pushManager.subscribe).not.toHaveBeenCalled();
    expect(calls).not.toContain('POST /push/subscribe');
  });

  it('이미 허용한 기기 — 묻지 않고 조용히 구독해 서버에 등록한다', async () => {
    installPush({ permission: 'granted', subscribed: false });
    await stubServer();

    await mountLayout();

    expect(push.Notification.requestPermission).not.toHaveBeenCalled();
    expect(push.pushManager.subscribe).toHaveBeenCalledTimes(1);
    expect(JSON.parse(bodies['POST /push/subscribe']).endpoint).toBe(ENDPOINT);
  });
});

describe('종 드롭다운 — 이 기기에서 알림 켜기', () => {
  async function openBell() {
    const { default: Header } = await import('@/components/Layout/Header');
    await mount(<Header isMobile={false} />);
    await act(async () => { document.querySelector('.Header__NotiWrap .Header__IconBtn').click(); });
    await settle();
    return document.querySelector('.Header__NotiPush');
  }

  it.each([
    ['en', 'Turn on notifications on this device'],
    ['ko', '이 기기에서 알림 켜기'],
  ])('%s · 권한 default → "%s" 버튼, 클릭 안에서 권한 요청 → 구독 → 안내가 사라진다', async (lng, label) => {
    await i18next.changeLanguage(lng);
    installPush({ permission: 'default', subscribed: false, onRequest: 'granted' });
    await stubServer();

    const row = await openBell();
    const btn = row?.querySelector('.Header__NotiPushBtn');
    expect(btn?.textContent).toBe(label);

    // Safari·iOS 홈 화면 앱·Firefox는 사용자 동작 안에서 시작된 요청만 받는다 —
    // 권한 요청은 클릭 처리와 같은 동기 구간에서 이미 불렸어야 한다(앞에 await 금지).
    act(() => { btn.click(); });
    expect(push.Notification.requestPermission).toHaveBeenCalledTimes(1);
    await settle();

    expect(calls.indexOf('permission request')).toBeLessThan(calls.indexOf('browser subscribe'));
    expect(JSON.parse(bodies['POST /push/subscribe']).endpoint).toBe(ENDPOINT);
    expect(document.querySelector('.Header__NotiPush')).toBeNull();
  });

  it('권한은 허용인데 이 기기 구독이 없다 → 다시 연결: 권한은 묻지 않고 구독만 한다', async () => {
    installPush({ permission: 'granted', subscribed: false });
    await stubServer();

    const row = await openBell();
    const btn = row?.querySelector('.Header__NotiPushBtn');
    expect(btn?.textContent).toBe('Reconnect this device');

    await act(async () => { btn.click(); });
    await settle();

    expect(push.Notification.requestPermission).not.toHaveBeenCalled();
    expect(push.pushManager.subscribe).toHaveBeenCalledTimes(1);
    expect(calls).toContain('POST /push/subscribe');
    expect(document.querySelector('.Header__NotiPush')).toBeNull();
  });

  it.each([
    ['en', 'Notifications are blocked in this browser'],
    ['ko', '이 브라우저에서 알림이 차단돼 있어요'],
  ])('%s · 권한 denied → 브라우저 설정 안내만 보이고 버튼은 없다', async (lng, text) => {
    await i18next.changeLanguage(lng);
    installPush({ permission: 'denied', subscribed: false });
    await stubServer();

    const row = await openBell();

    expect(row?.textContent).toContain(text);
    expect(row.querySelector('button')).toBeNull();
  });

  it('이미 구독된 기기 → 아무 안내도 그리지 않는다', async () => {
    installPush({ permission: 'granted', subscribed: true });
    await stubServer();
    const { subscribeToPush } = await import('@/library/pushSubscription');
    expect(await subscribeToPush()).toBe(true);   // 로드 때 Layout의 자동 등록이 서버까지 끝났다

    expect(await openBell()).toBeNull();
  });

  it('관리자 화면(Layout 없이 종을 그린다)도 로드 때 등록을 확인해, 이미 등록된 기기에 다시 연결을 띄우지 않는다', async () => {
    installPush({ permission: 'granted', subscribed: true });
    await stubServer();
    const { default: AdminLayout } = await import('@/components/Admin/AdminLayout');
    await mount(<AdminLayout><div /></AdminLayout>);
    await settle();
    await act(async () => { document.querySelector('.Header__NotiWrap .Header__IconBtn').click(); });
    await settle();

    expect(document.querySelector('.Header__NotiPush')).toBeNull();
    expect(calls).toContain('POST /push/subscribe');                 // 권한은 묻지 않고 조용히 갱신한다
    expect(push.Notification.requestPermission).not.toHaveBeenCalled();
  });

  it('브라우저 구독은 됐지만 서버 등록이 실패하면, 종을 닫았다 다시 열어도 다시 연결이 남고 서버 등록이 성공해야 사라진다', async () => {
    installPush({ permission: 'default', subscribed: false, onRequest: 'granted' });
    let serverAccepts = false;
    await stubServer({
      'POST /push/subscribe': (config) => ({
        data: serverAccepts ? { status: true } : { status: false, code: 'INVALID_ENDPOINT', message: 'INVALID_ENDPOINT' },
        status: 200, statusText: 'OK', headers: {}, config,
      }),
    });
    const bell = () => document.querySelector('.Header__NotiWrap .Header__IconBtn');
    const reopen = async () => {
      await act(async () => { bell().click(); });   // 닫고
      await act(async () => { bell().click(); });   // 다시 연다
      await settle();
    };

    const row = await openBell();
    await act(async () => { row.querySelector('.Header__NotiPushBtn').click(); });
    await settle();
    expect(push.pushManager.subscribe).toHaveBeenCalledTimes(1);   // 브라우저 구독은 생겼다

    await reopen();
    const retry = document.querySelector('.Header__NotiPush .Header__NotiPushBtn');
    expect(retry?.textContent).toBe('Reconnect this device');

    serverAccepts = true;
    await act(async () => { retry.click(); });
    await settle();
    expect(push.Notification.requestPermission).toHaveBeenCalledTimes(1);   // 다시 연결은 권한을 다시 묻지 않는다
    expect(document.querySelector('.Header__NotiPush')).toBeNull();
    await reopen();
    expect(document.querySelector('.Header__NotiPush')).toBeNull();
  });

  it('Web Push를 지원하지 않는 브라우저 → 아무 안내도 그리지 않는다', async () => {
    await stubServer();   // installPush 없음: serviceWorker·PushManager·Notification 전부 없다

    expect(await openBell()).toBeNull();
  });

  it('서비스워커 등록이 없으면(설치 실패 등) 권한이 default여도 켜기 버튼을 그리지 않는다', async () => {
    // 등록이 없으면 구독이 serviceWorker.ready에서 끝나지 않아 버튼이 비활성으로 굳는다 — 아예 안내하지 않는다.
    installPush({ permission: 'default', subscribed: false, registered: false });
    await stubServer();

    expect(await openBell()).toBeNull();
  });

  it('권한은 허용됐지만 서버 등록이 실패하면 실패 문구와 다시 연결 버튼을 남긴다', async () => {
    installPush({ permission: 'default', subscribed: false, onRequest: 'granted' });
    await stubServer({
      'POST /push/subscribe': (config) => ({
        data: { status: false, code: 'INVALID_ENDPOINT', message: 'INVALID_ENDPOINT' },
        status: 200, statusText: 'OK', headers: {}, config,
      }),
    });

    const row = await openBell();
    await act(async () => { row.querySelector('.Header__NotiPushBtn').click(); });
    await settle();

    const after = document.querySelector('.Header__NotiPush');
    expect(after?.querySelector('[role="alert"]')?.textContent).toBe("Couldn't turn on notifications. Please try again in a moment.");
    expect(after.querySelector('.Header__NotiPushBtn')?.textContent).toBe('Reconnect this device');
  });

  it('권한 창을 그냥 닫으면(default 그대로) 실패 문구 없이 켜기 버튼이 남는다', async () => {
    installPush({ permission: 'default', subscribed: false, onRequest: 'default' });
    await stubServer();

    const row = await openBell();
    await act(async () => { row.querySelector('.Header__NotiPushBtn').click(); });
    await settle();

    const after = document.querySelector('.Header__NotiPush');
    expect(after?.querySelector('[role="alert"]')).toBeNull();
    expect(after.querySelector('.Header__NotiPushBtn')?.textContent).toBe('Turn on notifications on this device');
    expect(calls).not.toContain('POST /push/subscribe');
  });

  it('권한 창에서 차단을 고르면 브라우저 설정 안내로 바뀐다', async () => {
    installPush({ permission: 'default', subscribed: false, onRequest: 'denied' });
    await stubServer();

    const row = await openBell();
    await act(async () => { row.querySelector('.Header__NotiPushBtn').click(); });
    await settle();

    const after = document.querySelector('.Header__NotiPush');
    expect(after?.textContent).toContain('Notifications are blocked in this browser');
    expect(after.querySelector('button')).toBeNull();
    expect(after.querySelector('[role="alert"]')).toBeNull();
  });
});
