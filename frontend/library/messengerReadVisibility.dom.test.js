// @vitest-environment jsdom
//
// 메신저에 방을 열어 둔 채 다른 탭·다른 앱으로 가면, 그 방에 온 새 메시지가 곧바로 "읽음"이 되어
// 보낸 사람 화면의 안 읽음 숫자가 사라지던 문제. 방은 실제로 보일 때(탭이 보이고 창에 포커스)만
// 읽음 처리하고, 안 보이는 동안 온 메시지는 다시 볼 때 읽음 처리한다.
// 채팅 WebSocket이 다시 붙으면 끊긴 사이 놓친 메시지를 다시 불러온다 — 조회 API
// (GET /chat/{room}/messages)가 서버에서 읽음 처리를 하므로, 보고 있을 때만 부르고 아니면 다시 보일 때로 미룬다.
// PiP 창에 띄운 방은 메인 창이 아니라 PiP 창의 문서로 판단한다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('@/library/_axios', () => ({ axios: { get: vi.fn(), patch: vi.fn() }, getBaseURL: () => '' }));
// 컴포저는 입력·검색 팝업 체인이 커서 이 테스트와 무관하다 — 빈 자리로 둔다.
vi.mock('@/components/Messenger/MessengerComposer', () => ({ default: () => null }));
import { axios } from '@/library/_axios';
import '@/library/i18n';
import MessengerChatRoom from '@/components/Messenger/MessengerChatRoom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ROOM = 7;
const ME = 1;
const OTHER = 2;
const msg = (id, sender = OTHER) => ({
  message_id: id,
  room_id: ROOM,
  sender_id: sender,
  sender_name: sender === ME ? 'Me' : 'Ann',
  content: `m${id}`,
  created_at: `2026-09-30T10:00:${String(id).padStart(2, '0')}+00:00`,
  attachments: [],
});

let serverMessages; // 서버에 있는 이 방의 메시지(오래된 것 → 최신)
let ws;
let root;
let container;
let pipFrame;

// 문서마다 보이기·포커스 상태를 테스트가 정한다(jsdom 기본값에 기대지 않는다).
function setViewState(doc, { visible, focused }) {
  Object.defineProperty(doc, 'visibilityState', {
    configurable: true,
    get: () => (visible ? 'visible' : 'hidden'),
  });
  doc.hasFocus = () => focused;
}

const markReads = () => ws.send.mock.calls
  .map(([raw]) => JSON.parse(raw))
  .filter((frame) => frame.action === 'mark_read');
const messageGets = () => axios.get.mock.calls.filter(([url]) => url === `/chat/${ROOM}/messages`).length;
const shownMessages = () => [...container.querySelectorAll('.MessengerChatRoom__MsgBubble')].map((el) => el.textContent);

async function settle() {
  for (let i = 0; i < 3; i += 1) {
    await act(async () => { await new Promise((r) => { setTimeout(r, 0); }); });
  }
}

async function mount(doc = document) {
  container = doc.createElement('div');
  doc.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<MessengerChatRoom roomId={ROOM} wsRef={{ current: ws }} onBack={() => {}} />);
  });
  await settle();
  // 방을 연 순간의 조회·읽음 알림(기존 동작)은 여기서 끊고, 이후에 일어나는 것만 센다.
  ws.send.mockClear();
}

function deliver(message) {
  act(() => {
    window.dispatchEvent(new CustomEvent('chat:ws_message', {
      detail: { type: 'new_message', room_id: ROOM, message },
    }));
  });
}

beforeEach(() => {
  serverMessages = [msg(1), msg(2, ME), msg(3)];
  ws = { readyState: WebSocket.OPEN, send: vi.fn() };
  axios.get.mockImplementation(async (url) => {
    if (url === `/chat/${ROOM}/messages`) {
      return {
        data: {
          status: true,
          messages: [...serverMessages].reverse(), // 서버는 최신순으로 준다
          room_type: 'dm',
          members: [{ user_id: OTHER, username: 'Ann', last_read_at: null }],
          my_last_read_at: null,
        },
      };
    }
    return { data: { status: false } };
  });
  sessionStorage.setItem('profile', JSON.stringify({ user_id: ME }));
  Element.prototype.scrollIntoView = vi.fn(); // jsdom에는 없다
  setViewState(document, { visible: true, focused: true });
});

afterEach(async () => {
  if (root) { await act(async () => root.unmount()); root = null; }
  container?.remove();
  pipFrame?.remove();
  pipFrame = null;
  delete document.visibilityState;
  delete document.hasFocus;
  sessionStorage.clear();
  vi.clearAllMocks();
});

describe('MessengerChatRoom — 실제로 볼 때만 읽음', () => {
  it('보고 있을 때 온 새 메시지는 바로 읽음 처리한다(기존 동작 유지)', async () => {
    await mount();
    deliver(msg(4));
    expect(shownMessages()).toContain('m4');
    expect(markReads()).toEqual([{ action: 'mark_read', room_id: ROOM }]);
  });

  it('탭이 숨은 동안 온 새 메시지는 읽음 처리하지 않고, 탭이 다시 보이면 한 번 읽음 처리한다', async () => {
    await mount();
    setViewState(document, { visible: false, focused: false });
    deliver(msg(4));
    expect(shownMessages()).toContain('m4'); // 목록에는 붙는다
    expect(markReads()).toEqual([]);

    setViewState(document, { visible: true, focused: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(markReads()).toHaveLength(1);

    // 뒤이어 오는 focus가 또 보내지 않는다
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(markReads()).toHaveLength(1);
  });

  it('탭은 보여도 창에 포커스가 없으면(다른 앱 사용 중) 미루고, 창이 포커스를 되찾을 때 읽음 처리한다', async () => {
    await mount();
    setViewState(document, { visible: true, focused: false });
    deliver(msg(4));
    expect(markReads()).toEqual([]);

    // 탭만 보이게 된 것으로는 아직 읽지 않는다
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(markReads()).toEqual([]);

    setViewState(document, { visible: true, focused: true });
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(markReads()).toHaveLength(1);
  });

  it('PiP 창에 띄운 방은 PiP 창의 포커스로 판단한다', async () => {
    pipFrame = document.createElement('iframe');
    document.body.appendChild(pipFrame);
    const pipDoc = pipFrame.contentDocument;
    const pipWin = pipFrame.contentWindow;
    pipWin.Element.prototype.scrollIntoView = () => {}; // PiP 창 문서의 요소는 그 창의 Element를 쓴다

    // PiP 창에 포커스 — 메인 창이 포커스를 잃었어도 보는 중이다
    setViewState(document, { visible: true, focused: false });
    setViewState(pipDoc, { visible: true, focused: true });
    await mount(pipDoc);
    deliver(msg(4));
    expect(markReads()).toHaveLength(1);

    // 메인 창으로 돌아가 일하는 중 — PiP 창은 떠 있지만 포커스가 없다
    setViewState(document, { visible: true, focused: true });
    setViewState(pipDoc, { visible: true, focused: false });
    deliver(msg(5));
    expect(markReads()).toHaveLength(1);

    // PiP 창을 누르면 읽음 처리한다
    setViewState(document, { visible: true, focused: false });
    setViewState(pipDoc, { visible: true, focused: true });
    act(() => { pipWin.dispatchEvent(new pipWin.Event('focus')); });
    expect(markReads()).toHaveLength(2);
  });
});

describe('MessengerChatRoom — 재연결 뒤 놓친 메시지 보충', () => {
  it('보고 있는 방은 재연결 즉시 다시 불러와 놓친 메시지를 채우고 읽음을 알린다', async () => {
    await mount();
    const before = messageGets();
    serverMessages.push(msg(4), msg(5)); // 끊긴 사이에 온 메시지

    await act(async () => { window.dispatchEvent(new CustomEvent('chat:reconnected')); });
    await settle();

    expect(messageGets()).toBe(before + 1);
    expect(shownMessages()).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
    expect(markReads()).toHaveLength(1);
  });

  it('다시 불러오는 사이 탭을 숨기고 새 메시지가 오면, 응답이 와도 읽음 처리하지 않고 다시 보일 때 한 번 한다', async () => {
    await mount();
    const serve = axios.get.getMockImplementation();
    let release;
    axios.get.mockImplementationOnce((url) => new Promise((resolve) => { release = () => resolve(serve(url)); }));
    await act(async () => { window.dispatchEvent(new CustomEvent('chat:reconnected')); }); // 보는 중 — 바로 조회를 시작한다
    setViewState(document, { visible: false, focused: false });                           // 응답 전에 탭을 숨긴다
    serverMessages.push(msg(4));
    deliver(msg(4));
    expect(markReads()).toEqual([]);

    await act(async () => { release(); });
    await settle();
    expect(shownMessages()).toEqual(['m1', 'm2', 'm3', 'm4']);
    expect(markReads()).toEqual([]);                  // 숨은 채로는 읽음을 보내지 않는다

    setViewState(document, { visible: true, focused: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(markReads()).toHaveLength(1);
  });

  it('안 보이는 동안 재연결되면 조회(=서버 읽음 처리)를 미루고, 다시 보일 때 불러온다', async () => {
    await mount();
    const before = messageGets();
    setViewState(document, { visible: false, focused: false });
    serverMessages.push(msg(4));

    await act(async () => { window.dispatchEvent(new CustomEvent('chat:reconnected')); });
    await settle();
    expect(messageGets()).toBe(before);
    expect(shownMessages()).not.toContain('m4');
    expect(markReads()).toEqual([]);

    setViewState(document, { visible: true, focused: true });
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await settle();
    expect(messageGets()).toBe(before + 1);
    expect(shownMessages()).toEqual(['m1', 'm2', 'm3', 'm4']);
    expect(markReads()).toHaveLength(1);
  });
});
