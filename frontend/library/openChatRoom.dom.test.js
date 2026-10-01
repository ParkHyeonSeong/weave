// @vitest-environment jsdom
//
// 종 알림의 채팅 멘션·홈 '읽지 않은 메시지' 위젯·채팅 푸시 주소(/?chat=<방>)가 메신저를 열면서
// 바로 그 방을 연다.
//
// 회귀 원인: Messenger는 패널이 펼쳐져 있을 때만 마운트되고 chat:open_room 리스너도 마운트
// 뒤에 붙는다. 패널이 접힌 상태(모바일은 기본)에서 펼침과 이벤트를 같은 틱에 보내면 이벤트가
// 사라져 패널만 열리고, 마지막에 보던 방(sessionStorage)이나 목록이 떴다. 홈 위젯은 패널을
// 열지도 않았고, 푸시 주소는 '/'라 홈만 열렸다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('next/router', () => ({ useRouter: () => globalThis.__ROUTER }));
// 메신저 안쪽 화면은 "어느 방이 열렸나"만 보이면 된다 — 방·목록 조회와 WS는 이 테스트 밖이다.
vi.mock('@/components/Messenger/MessengerChatRoom', async () => {
  const { createElement } = await import('react');
  return {
    default: ({ roomId }) => createElement('div', { className: 'StubRoom', 'data-room-id': String(roomId) }),
  };
});
vi.mock('@/components/Messenger/MessengerChatList', () => ({ default: () => null }));
vi.mock('@/components/Messenger/MessengerUserList', () => ({ default: () => null }));
vi.mock('@/components/Messenger/MessengerNewChat', () => ({ default: () => null }));

import { axios } from '@/library/_axios';
import { ThemeProvider } from '@/library/theme';
import Layout from '@/components/Layout/Layout';
import UnreadMessages from '@/components/Home/DashboardWidgets/UnreadMessages';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const MENTIONED_ROOM = 5;
const LAST_SEEN_ROOM = 7;
const PHONE_QUERY = '(max-width: 767px)';

// backend routers/ws_chat.py가 만드는 채팅 멘션 알림 모양 그대로(link 없음, entity=chat_room)
const CHAT_MENTION = {
  notification_id: 91,
  type: 'chat_mention',
  actor_id: null,
  actor_name: 'Ann',
  title: 'Ann mentioned you in chat',
  payload: { key: 'chatMention', params: { actor: 'Ann' } },
  link: null,
  entity_type: 'chat_room',
  entity_id: MENTIONED_ROOM,
  is_read: false,
  created_at: '2026-09-30T00:00:00Z',
};
const ROOMS = [{ room_id: MENTIONED_ROOM, room_name: 'Design', room_type: 'group', unread_count: 2 }];

let root;

function setViewport(phone) {
  window.matchMedia = vi.fn((query) => ({
    matches: phone && query === PHONE_QUERY,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  setViewport(false);
  globalThis.requestAnimationFrame = (cb) => { cb(); return 0; };
  globalThis.__ROUTER = {
    pathname: '/', asPath: '/', query: {}, isReady: true,
    push: vi.fn(), replace: vi.fn(async () => true), prefetch: vi.fn(async () => {}),
    events: { on: vi.fn(), off: vi.fn() },
  };
  // 실물 axios 인스턴스에 가짜 전송 계층만 끼운다(인터셉터는 그대로 통과).
  axios.defaults.adapter = async (config) => {
    const url = config.url;
    let data = { status: true };
    if (url.startsWith('/notifications/unread-count')) data = { status: true, count: 1 };
    else if (url.startsWith('/notifications')) data = { status: true, notifications: [CHAT_MENTION] };
    else if (url === '/chat') data = { status: true, rooms: ROOMS };
    return { data, status: 200, statusText: 'OK', headers: {}, config };
  };
  document.body.innerHTML = '<div id="root"></div>';
});

afterEach(() => {
  if (root) act(() => root.unmount());
  root = null;
});

async function mount(children = null) {
  root = createRoot(document.getElementById('root'));
  await act(async () => {
    root.render(<ThemeProvider><Layout>{children}</Layout></ThemeProvider>);
  });
  await act(async () => {});  // refreshCounts(동적 import + 요청 3건)·위젯 조회 해소
}

const messengerOpen = () => !!document.querySelector('.Messenger');
const openedRoom = () => document.querySelector('.Messenger .StubRoom')?.dataset.roomId ?? null;

async function clickChatMentionInBell() {
  await act(async () => { document.querySelector('.Header__NotiWrap .Header__IconBtn').click(); });
  const row = document.querySelector('.Header__NotiItem');
  await act(async () => { row.click(); });
}

describe('종 알림의 채팅 멘션 → 메신저와 그 방이 함께 열린다', () => {
  it.each([['데스크톱', false], ['휴대폰', true]])(
    '%s: 메신저가 접혀 있으면 펼치면서 멘션된 방을 연다(마지막에 보던 방이 아니라)',
    async (_label, phone) => {
      setViewport(phone);
      sessionStorage.setItem('chat_active_room', String(LAST_SEEN_ROOM));
      await mount();
      expect(messengerOpen()).toBe(false);

      await clickChatMentionInBell();

      expect(messengerOpen()).toBe(true);
      expect(openedRoom()).toBe(String(MENTIONED_ROOM));
    },
  );

  it('메신저가 이미 열려 있으면 보던 방에서 멘션된 방으로 바로 바꾼다', async () => {
    sessionStorage.setItem('messenger_open', 'true');
    sessionStorage.setItem('chat_active_room', String(LAST_SEEN_ROOM));
    await mount();
    expect(openedRoom()).toBe(String(LAST_SEEN_ROOM));

    await clickChatMentionInBell();

    expect(openedRoom()).toBe(String(MENTIONED_ROOM));
  });
});

describe("홈 '읽지 않은 메시지' 위젯 → 메신저와 그 방이 함께 열린다", () => {
  it('메신저가 접혀 있어도 방을 누르면 펼치면서 그 방을 연다', async () => {
    await mount(<UnreadMessages />);
    expect(messengerOpen()).toBe(false);

    await act(async () => { document.querySelector('.UnreadMessages__Room').click(); });

    expect(messengerOpen()).toBe(true);
    expect(openedRoom()).toBe(String(MENTIONED_ROOM));
  });
});

describe('채팅 푸시 주소 /?chat=<방> → 그 방을 열고 주소에서 chat을 지운다', () => {
  it.each([['데스크톱', false], ['휴대폰', true]])('%s', async (_label, phone) => {
    setViewport(phone);
    globalThis.__ROUTER.query = { chat: String(MENTIONED_ROOM) };
    globalThis.__ROUTER.asPath = `/?chat=${MENTIONED_ROOM}`;

    await mount();

    // 휴대폰은 진입 시 메신저를 자동으로 접는다 — 그 뒤에도 열린 채로 남아야 한다.
    expect(messengerOpen()).toBe(true);
    expect(openedRoom()).toBe(String(MENTIONED_ROOM));
    expect(globalThis.__ROUTER.replace).toHaveBeenCalledWith(
      { pathname: '/', query: {} }, undefined, { shallow: true },
    );
  });
});
