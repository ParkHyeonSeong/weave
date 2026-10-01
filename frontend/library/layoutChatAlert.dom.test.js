// @vitest-environment jsdom
//
// 열어 둔 채팅방에 새 메시지가 오면, 그 방을 실제로 보고 있지 않을 때(탭 숨김·창 포커스 없음)는
// 다른 방처럼 토스트·소리·OS 알림·헤더 배지를 띄운다(예전에는 방이 열려 있기만 하면 모두 생략했다).
// PiP로 띄운 메신저는 PiP 창의 문서로 판단한다.
// 채팅 WebSocket이 끊겼다 다시 붙으면(두 번째 연결부터) 열린 방이 놓친 메시지를 채우도록 chat:reconnected를 알린다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('next/router', () => ({ useRouter: () => ({ pathname: '/', asPath: '/', push: () => {} }) }));
vi.mock('@/library/_axios', () => ({
  axios: { get: async () => ({ data: { status: true, notifications: [], count: 0, rooms: [] } }) },
  getWsBaseURL: () => 'ws://weave.test',
  getBaseURL: () => '',
  refreshAccessToken: async () => {},
}));
vi.mock('@/library/notification', () => ({
  requestNotificationPermission: async () => {},
  showNotification: vi.fn(),
  playNotificationSound: vi.fn(),
  chatMessagePreview: (message) => message.content,
}));
vi.mock('@/library/pushSubscription', () => ({ subscribeToPush: () => {} }));
vi.mock('@/components/Layout/Toast', () => ({ showToast: vi.fn() }));
vi.mock('@/hooks/useMobile', () => ({ default: () => ({ isMobile: false }) }));
// 헤더는 채팅 배지 숫자만 보이게 한다.
vi.mock('@/components/Layout/Header', async () => {
  const React = await import('react');
  return {
    default: ({ chatUnreadCount }) => React.createElement('output', { className: 'ChatBadge' }, String(chatUnreadCount)),
  };
});
vi.mock('@/components/Layout/Sidebar', () => ({ default: () => null }));
vi.mock('@/components/Layout/Footer', () => ({ default: () => null }));
// 메신저는 방 7을 연 상태만 흉내 낸다(실제 Messenger가 activeRoomRef에 하는 일과 같다).
vi.mock('@/components/Messenger/Messenger', async () => {
  const React = await import('react');
  function StubMessenger({ activeRoomRef, onPopOut, isPip }) {
    React.useEffect(() => {
      activeRoomRef.current = 7;
      globalThis.__messengerPopOut = onPopOut;
      return () => { activeRoomRef.current = null; };
    }, []);
    return React.createElement('div', { className: 'StubMessenger', 'data-pip': isPip ? 'yes' : 'no' });
  }
  return { default: StubMessenger };
});
vi.mock('@/components/modal/CreateBranch', () => ({ default: () => null }));
vi.mock('@/components/modal/CreateCanvas', () => ({ default: () => null }));
vi.mock('@/components/modal/CreateTrack', () => ({ default: () => null }));
vi.mock('@/components/modal/CreateScrumBoard', () => ({ default: () => null }));
vi.mock('@/components/modal/CommandPalette', () => ({ default: () => null }));

import '@/library/i18n';
import { showToast } from '@/components/Layout/Toast';
import { showNotification, playNotificationSound } from '@/library/notification';
import Layout from '@/components/Layout/Layout';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ROOM = 7;
const ME = 1;
const OTHER = 2;

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor(url) {
    this.url = url;
    this.readyState = FakeWebSocket.CONNECTING;
    this.send = vi.fn();
    sockets.push(this);
  }

  close() { this.readyState = FakeWebSocket.CLOSED; }
}

let sockets;
let root;
let container;
let pipFrame;

function setViewState(doc, { visible, focused }) {
  Object.defineProperty(doc, 'visibilityState', {
    configurable: true,
    get: () => (visible ? 'visible' : 'hidden'),
  });
  doc.hasFocus = () => focused;
}

async function settle() {
  for (let i = 0; i < 3; i += 1) {
    await act(async () => { await new Promise((r) => { setTimeout(r, 0); }); });
  }
}

const socket = () => sockets[sockets.length - 1];
const badge = () => Number(container.querySelector('.ChatBadge').textContent);

async function renderLayout() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<Layout><main /></Layout>); });
  await act(async () => {
    socket().readyState = FakeWebSocket.OPEN;
    socket().onopen?.();
  });
  await settle();
}

async function receiveMessage(roomId) {
  await act(async () => {
    socket().onmessage({
      data: JSON.stringify({
        type: 'new_message',
        room_id: roomId,
        message: { message_id: 100, room_id: roomId, sender_id: OTHER, sender_name: 'Ann', content: 'hello' },
      }),
    });
  });
}

const alertCount = () => showToast.mock.calls.length;

beforeEach(() => {
  sockets = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
  sessionStorage.setItem('profile', JSON.stringify({ user_id: ME }));
  sessionStorage.setItem('messenger_open', 'true');
  setViewState(document, { visible: true, focused: true });
});

afterEach(async () => {
  if (root) { await act(async () => root.unmount()); root = null; }
  container?.remove();
  pipFrame?.remove();
  pipFrame = null;
  delete window.documentPictureInPicture;
  delete globalThis.documentPictureInPicture;
  delete globalThis.__messengerPopOut;
  delete document.visibilityState;
  delete document.hasFocus;
  sessionStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('Layout — 열어 둔 방이라도 보고 있지 않으면 알린다', () => {
  it('보고 있는 방에 온 메시지는 알리지 않는다(기존 동작 유지)', async () => {
    await renderLayout();
    await receiveMessage(ROOM);
    expect(alertCount()).toBe(0);
    expect(playNotificationSound).not.toHaveBeenCalled();
    expect(badge()).toBe(0);
  });

  it.each([
    ['탭이 숨었다', { visible: false, focused: false }],
    ['탭은 보이지만 창에 포커스가 없다', { visible: true, focused: false }],
  ])('%s → 열어 둔 방이라도 토스트·소리·OS 알림·배지를 띄운다', async (_label, state) => {
    await renderLayout();
    setViewState(document, state);
    await receiveMessage(ROOM);
    expect(alertCount()).toBe(1);
    expect(playNotificationSound).toHaveBeenCalledTimes(1);
    expect(showNotification).toHaveBeenCalledTimes(1);
    expect(badge()).toBe(1);
  });

  it('PiP로 띄운 메신저는 PiP 창의 포커스로 판단한다', async () => {
    pipFrame = document.createElement('iframe');
    document.body.appendChild(pipFrame);
    const pip = pipFrame.contentWindow;
    const fakeApi = { requestWindow: async () => pip };
    window.documentPictureInPicture = fakeApi;
    globalThis.documentPictureInPicture = fakeApi;

    await renderLayout();
    await act(async () => { await globalThis.__messengerPopOut(); });
    expect(pip.document.querySelector('.StubMessenger')?.dataset.pip).toBe('yes');

    // 메인 창에서 일하는 중 — PiP 창은 떠 있지만 포커스가 없다
    setViewState(document, { visible: true, focused: true });
    setViewState(pip.document, { visible: true, focused: false });
    await receiveMessage(ROOM);
    expect(alertCount()).toBe(1);

    // PiP 창에 포커스 — 메인 창이 포커스를 잃었어도 보는 중이다
    setViewState(document, { visible: true, focused: false });
    setViewState(pip.document, { visible: true, focused: true });
    await receiveMessage(ROOM);
    expect(alertCount()).toBe(1);
  });
});

describe('Layout — 채팅 WebSocket 재연결 알림', () => {
  it('첫 연결에는 알리지 않고, 끊겼다 다시 붙을 때마다 chat:reconnected를 알린다', async () => {
    const heard = vi.fn();
    window.addEventListener('chat:reconnected', heard);
    try {
      await renderLayout();
      expect(heard).not.toHaveBeenCalled();

      vi.useFakeTimers();
      act(() => { socket().onclose(); });
      act(() => { vi.advanceTimersByTime(3000); }); // Layout은 3초 뒤 다시 연결한다
      expect(sockets).toHaveLength(2);
      vi.useRealTimers();

      await act(async () => {
        socket().readyState = FakeWebSocket.OPEN;
        socket().onopen();
      });
      expect(heard).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('chat:reconnected', heard);
    }
  });
});
