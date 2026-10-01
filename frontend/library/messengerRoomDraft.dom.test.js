// @vitest-environment jsdom
//
// 메신저에서 방을 바꾸면 쓰던 글·첨부·멘션이 다음 방 입력창으로 따라가던 문제(BL-11).
//
// 분할 보기는 방을 바꿔도 방 화면과 작성부가 새로 만들어지지 않아, A 방에 쓰던 글과 A 방에 올린
// 첨부(파일명이 A 방에 묶여 있다), 멘션 대상이 그대로 B 방으로 넘어가 B 방에 보내졌다. 좁은 보기는
// 반대로 목록으로 나갔다 오거나 패널을 닫았다 열면 쓰던 글이 사라졌다.
// 계약: 방마다 작성부가 새로 시작하고, 같은 세션에서 그 방으로 돌아오면 그 방 초안이 돌아오며,
// 보내면 초안이 지워진다.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('@/library/_axios', () => ({
  axios: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
  getBaseURL: () => '',
}));
vi.mock('next/router', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

import { axios } from '@/library/_axios';
import '@/library/i18n';
import Messenger from '@/components/Messenger/Messenger';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ME = 7;
const ALICE = { user_id: 11, username: 'alice' };
const TASK = {
  task_id: 55, branch_id: 3, display_id: 'WV-55', title: 'Ship drafts', status: 'todo', priority: 'medium',
  assignees: [], status_label: 'To Do', status_color: null, status_category: 'todo',
};
// 초안 저장소는 모듈 수준이라 이 파일 안에서 이어진다 — 테스트마다 다른 방을 쓴다.
const ROOMS = {
  101: 'Room A', 102: 'Room B',
  201: 'Room C', 202: 'Room D',
  301: 'Room E',
  401: 'Room F', 402: 'Room G',
  501: 'Room H',
  601: 'Room I',
};
const SPLIT = { panelWidth: 800, isMobile: false };
const NARROW = { isMobile: true };

let root = null;
let container = null;
let wsRef;

const flush = async () => {
  for (let i = 0; i < 4; i += 1) {
    await new Promise((r) => { setTimeout(r, 0); });
  }
};
const settle = () => act(async () => { await flush(); });

async function waitFor(check, timeout = 2000) {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeout) throw new Error('waitFor: timed out');
    await act(async () => { await new Promise((r) => { setTimeout(r, 20); }); });
  }
}

async function mount(element) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(element); });
  await settle();
}

async function rerender(element) {
  await act(async () => { root.render(element); });
  await settle();
}

const renderMessenger = (props) =>
  mount(<Messenger wsRef={wsRef} activeRoomRef={{ current: null }} {...props} />);

async function unmountMessenger() {
  await act(async () => { root.unmount(); });
  root = null;
  container.remove();
}

const textarea = () => container.querySelector('.MessengerChatRoom__InputField');
const roomTitle = () => container.querySelector('.MessengerChatRoom__Title')?.textContent;
const pendingNames = () =>
  [...container.querySelectorAll('.MessengerChatRoom__PendingName')].map((el) => el.textContent);
const pendingThumbs = () =>
  [...container.querySelectorAll('.MessengerChatRoom__PendingThumb')].map((el) => el.getAttribute('src'));
const attachedTaskTitles = () =>
  [...container.querySelectorAll('.MessengerChatRoom__AttachedTask .TaskRefCard__Title')].map((el) => el.textContent);
const sentMessages = () =>
  wsRef.current.send.mock.calls.map(([raw]) => JSON.parse(raw)).filter((m) => m.action === 'send_message');

async function clickListItem(name) {
  const item = [...container.querySelectorAll('.MessengerChatList__Item')]
    .find((el) => el.textContent.includes(name));
  expect(item, `chat list item "${name}"`).toBeTruthy();
  await act(async () => { item.click(); });
  await settle();
}

// 헤더 알림을 눌렀을 때와 같은 경로(Layout → chat:open_room)
async function openFromNotification(roomId) {
  await act(async () => {
    window.dispatchEvent(new CustomEvent('chat:open_room', { detail: roomId }));
  });
  await settle();
}

async function typeText(value) {
  const el = textarea();
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  await act(async () => {
    setValue.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

// 슬래시 명령(/t)으로 태스크 참조를 붙인다 — 붙이면 입력창은 비워진다
async function attachTask() {
  await typeText('/t ');
  await waitFor(() => container.querySelector('.TaskSearchPopup__Item'));
  await act(async () => { container.querySelector('.TaskSearchPopup__Item').click(); });
  await settle();
}

async function mentionAlice() {
  await typeText('@al');
  await waitFor(() => container.querySelector('.MentionSearchPopup__Item'));
  await act(async () => { container.querySelector('.MentionSearchPopup__Item').click(); });
  await settle();
}

async function attachImage(name) {
  const input = container.querySelector('.MessengerChatRoom__Input input[type="file"]');
  Object.defineProperty(input, 'files', {
    value: [new File(['x'], name, { type: 'image/png' })],
    configurable: true,
  });
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
  await settle();
}

async function clickSend() {
  await act(async () => { container.querySelector('.MessengerChatRoom__SendBtn').click(); });
  await settle();
}

const uploadedResponse = (roomId, name) => ({
  data: {
    status: true,
    url: `/api/uploads/chat/chat_${roomId}_0123456789ab.png`,
    file_name: name,
    file_type: 'image/png',
    file_size: 1,
  },
});

beforeAll(() => {
  // jsdom에는 없는 브라우저 API
  Element.prototype.scrollIntoView = () => {};
});

beforeEach(() => {
  sessionStorage.clear();
  sessionStorage.setItem('profile', JSON.stringify({ user_id: ME }));
  wsRef = { current: { readyState: WebSocket.OPEN, send: vi.fn() } };
  URL.createObjectURL = vi.fn((file) => `blob:${file.name}`);
  URL.revokeObjectURL = vi.fn();
  axios.get.mockImplementation(async (url) => {
    if (url === '/chat') {
      return {
        data: {
          status: true,
          rooms: Object.entries(ROOMS).map(([id, name]) => ({
            room_id: Number(id), room_type: 'group', room_name: name,
          })),
        },
      };
    }
    if (url === '/chat/online') return { data: { status: true, user_ids: [] } };
    if (url === '/chat/mention-search') return { data: { status: true, users: [ALICE] } };
    if (url === '/chat/task-search') return { data: { status: true, tasks: [TASK] } };
    const messages = url.match(/^\/chat\/(\d+)\/messages$/);
    if (messages) {
      return {
        data: {
          status: true,
          messages: [],
          room_type: 'group',
          room_name: ROOMS[messages[1]],
          members: [ALICE],
          my_last_read_at: null,
        },
      };
    }
    return { data: { status: false } };
  });
  axios.post.mockImplementation(async (url, formData) => {
    const upload = url.match(/^\/chat\/upload\?room_id=(\d+)$/);
    if (!upload) return { data: { status: false } };
    return uploadedResponse(upload[1], formData.get('file').name);
  });
});

afterEach(async () => {
  if (root) await unmountMessenger();
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('메신저 방별 초안', () => {
  it('분할 보기: 방을 바꾸면 쓰던 글·첨부·참조·멘션이 따라가지 않고, 돌아오면 그 방 초안이 돌아오며, 보내면 지워진다', async () => {
    await renderMessenger(SPLIT);
    await clickListItem('Room A');
    expect(roomTitle()).toBe('Room A');
    await attachTask();
    await mentionAlice();
    await typeText('@alice draft for A');
    await attachImage('shot.png');
    expect(attachedTaskTitles()).toEqual(['Ship drafts']);
    expect(pendingNames()).toEqual(['shot.png']);

    await clickListItem('Room B');
    expect(roomTitle()).toBe('Room B');
    expect(textarea().value).toBe('');
    expect(attachedTaskTitles()).toEqual([]);
    expect(pendingNames()).toEqual([]);
    // A 방 초안의 미리보기는 돌아왔을 때 다시 보여 줘야 하므로 해제하지 않는다
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    // B 방에서 보낸 메시지에 A 방의 첨부·참조·멘션 대상이 섞이지 않는다
    await typeText('hello B');
    await clickSend();
    expect(sentMessages().at(-1)).toEqual({ action: 'send_message', room_id: 102, content: 'hello B' });

    await clickListItem('Room A');
    expect(textarea().value).toBe('@alice draft for A');
    expect(attachedTaskTitles()).toEqual(['Ship drafts']);
    expect(pendingNames()).toEqual(['shot.png']);
    expect(pendingThumbs()).toEqual(['blob:shot.png']);

    await clickSend();
    expect(sentMessages().at(-1)).toEqual({
      action: 'send_message',
      room_id: 101,
      content: '@alice draft for A',
      task_id: TASK.task_id,
      mentioned_user_ids: [ALICE.user_id],
      attachments: [{
        url: '/api/uploads/chat/chat_101_0123456789ab.png',
        file_name: 'shot.png',
        file_type: 'image/png',
        file_size: 1,
      }],
    });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:shot.png');

    // 보낸 뒤에는 돌아와도 초안이 없다
    await clickListItem('Room B');
    await clickListItem('Room A');
    expect(textarea().value).toBe('');
    expect(attachedTaskTitles()).toEqual([]);
    expect(pendingNames()).toEqual([]);
  });

  it('좁은 보기: 목록으로 나갔다 오면 초안이 돌아오고, 방 안에서 알림으로 다른 방을 열면 따라가지 않는다', async () => {
    await renderMessenger(NARROW);
    await openFromNotification(201);
    expect(roomTitle()).toBe('Room C');
    await typeText('narrow draft');

    await act(async () => { container.querySelector('.MessengerChatRoom__BackBtn').click(); });
    await settle();
    expect(textarea()).toBeNull();
    await clickListItem('Room C');
    expect(textarea().value).toBe('narrow draft');

    await openFromNotification(202);
    expect(roomTitle()).toBe('Room D');
    expect(textarea().value).toBe('');

    await openFromNotification(201);
    expect(roomTitle()).toBe('Room C');
    expect(textarea().value).toBe('narrow draft');
  });

  it('패널을 닫았다 다시 열어도(메신저 다시 마운트) 그 방 초안이 돌아온다', async () => {
    await renderMessenger(SPLIT);
    await clickListItem('Room E');
    await typeText('before closing');

    await unmountMessenger();
    await renderMessenger(SPLIT); // 마지막으로 연 방(sessionStorage)이 다시 열린다
    expect(roomTitle()).toBe('Room E');
    expect(textarea().value).toBe('before closing');
  });

  it('팝아웃으로 바꾸거나 패널 폭이 분할 기준을 넘어 같은 방 화면이 한 번에 다시 그려져도 쓰던 글이 남는다', async () => {
    // Layout처럼 패널 메신저와 팝아웃 메신저를 한 렌더에서 맞바꾼다. 옛 작성부가 정리되기 전에
    // 새 작성부가 먼저 그려지므로, 초안은 떠날 때가 아니라 쓰는 동안 남아 있어야 한다.
    const activeRoomRef = { current: null };
    const layout = (pip, panelWidth = 800) => (
      <>
        {!pip && <Messenger wsRef={wsRef} activeRoomRef={activeRoomRef} panelWidth={panelWidth} isMobile={false} />}
        {pip && <Messenger wsRef={wsRef} activeRoomRef={activeRoomRef} isMobile={false} isPip />}
      </>
    );
    await mount(layout(false));
    await clickListItem('Room H');
    await typeText('survives pop-out');
    await attachImage('popout.png');

    await rerender(layout(true)); // 팝아웃
    expect(roomTitle()).toBe('Room H');
    expect(textarea().value).toBe('survives pop-out');
    expect(pendingThumbs()).toEqual(['blob:popout.png']);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    await rerender(layout(false, 800)); // 패널로 복귀
    expect(textarea().value).toBe('survives pop-out');

    await rerender(layout(false, 400)); // 분할 → 좁은 보기
    expect(container.querySelector('.Messenger--split')).toBeNull();
    expect(roomTitle()).toBe('Room H');
    expect(textarea().value).toBe('survives pop-out');
  });

  it('같은 탭에서 다른 계정으로 로그인하면(새로고침 없음) 앞 계정의 초안이 보이지 않는다', async () => {
    await renderMessenger(SPLIT);
    await clickListItem('Room I');
    await typeText('private to user 7');

    // 로그아웃은 로그인 화면으로 라우팅만 한다 — 메신저는 언마운트되지만 모듈 메모리는 남는다
    await unmountMessenger();
    sessionStorage.removeItem('profile');
    sessionStorage.setItem('profile', JSON.stringify({ user_id: ME + 1 }));
    await renderMessenger(SPLIT); // 마지막으로 연 방(sessionStorage)이 다시 열린다
    expect(roomTitle()).toBe('Room I');
    expect(textarea().value).toBe('');
  });

  it('업로드 중에 방을 떠나면 그 파일은 초안에 남지 않아, 돌아와도 전송이 막히지 않는다', async () => {
    let finishUpload;
    axios.post.mockImplementationOnce(() => new Promise((resolve) => { finishUpload = resolve; }));
    await renderMessenger(SPLIT);
    await clickListItem('Room F');
    await typeText('with slow file');
    await attachImage('slow.png');
    expect(container.querySelector('.MessengerChatRoom__PendingProgress')).not.toBeNull();

    await clickListItem('Room G');
    expect(pendingNames()).toEqual([]);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:slow.png');

    await clickListItem('Room F');
    expect(textarea().value).toBe('with slow file');
    expect(pendingNames()).toEqual([]);
    expect(container.querySelector('.MessengerChatRoom__SendBtn').disabled).toBe(false);

    // 늦게 끝난 업로드는 이미 떠난 작성부에만 닿는다
    await act(async () => { finishUpload(uploadedResponse(401, 'slow.png')); });
    await settle();
    expect(pendingNames()).toEqual([]);
  });
});
