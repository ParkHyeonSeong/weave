// @vitest-environment jsdom
//
// 메신저 '사용자' 탭 검색과 '새 채팅' 받는 사람 검색이 이메일 없는 사용자 목록에서도
// 앱을 오류 화면으로 바꾸지 않고 이름으로만 거르는지 고정한다.
// /chat/users는 보안 수정(47b332b) 이후 email을 주지 않는다 — 그 계약은
// backend/tests/test_mention_scoping.py의 test_directory_strips_email이 고정한다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('@/library/_axios', () => ({ axios: { get: vi.fn(), post: vi.fn() }, getBaseURL: () => '' }));
// 새 채팅 하단 입력창은 이 검사와 무관하다 — 에디터·팝업 체인을 끌어오지 않게 비운다.
vi.mock('@/components/Messenger/MessengerComposer', () => ({ default: () => null }));
import { axios } from '@/library/_axios';
import '@/library/i18n';
import MessengerUserList from '@/components/Messenger/MessengerUserList';
import MessengerNewChat from '@/components/Messenger/MessengerNewChat';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// GET /chat/users의 실제 응답 모양: 행마다 email 키가 없다.
const USERS = [
  { user_id: 1, username: 'me', avatar_url: null, avatar_color: null },
  { user_id: 2, username: 'alice', avatar_url: null, avatar_color: null },
  { user_id: 3, username: 'Bob', avatar_url: null, avatar_color: null },
  { user_id: 4, username: 'bobby', avatar_url: null, avatar_color: null },
];

let root = null;

async function mount(element) {
  root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(element); });
  await act(async () => {});
}

const type = (input, value) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
});

const names = (selector) => [...document.querySelectorAll(selector)].map((el) => el.textContent);

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '<div id="root"></div>';
  sessionStorage.clear();
  sessionStorage.setItem('profile', JSON.stringify({ user_id: 1 }));
  axios.get.mockImplementation(async (url) => {
    if (url === '/chat/users') return { data: { status: true, users: USERS } };
    if (url === '/chat/online') return { data: { status: true, user_ids: [] } };
    return { data: { status: false } };
  });
});

afterEach(async () => {
  if (root) { await act(async () => root.unmount()); root = null; }
});

describe('메신저 사용자 탭 검색', () => {
  const search = () => document.querySelector('.MessengerUserList__SearchInput');

  it('이름 일부를 입력하면 오류 없이 이름에 그 글자가 든 사람만 남는다', async () => {
    await mount(<MessengerUserList onOpenRoom={() => {}} />);
    expect(names('.MessengerUserList__Name')).toEqual(['alice', 'Bob', 'bobby']);

    await type(search(), 'bo');
    expect(names('.MessengerUserList__Name')).toEqual(['Bob', 'bobby']);

    await type(search(), 'ALI');
    expect(names('.MessengerUserList__Name')).toEqual(['alice']);

    await type(search(), 'zzz');
    expect(names('.MessengerUserList__Name')).toEqual([]);
    expect(document.querySelector('.MessengerUserList__Empty')).not.toBeNull();
  });

  it('이름 아래에 늘 비어 있던 이메일 줄을 그리지 않는다', async () => {
    await mount(<MessengerUserList onOpenRoom={() => {}} />);
    expect(document.querySelectorAll('.MessengerUserList__Item')).toHaveLength(3);
    expect(document.querySelector('.MessengerUserList__Email')).toBeNull();
  });
});

describe('새 채팅 받는 사람 검색', () => {
  const search = () => document.querySelector('.MessengerNewChat__SearchInput');
  const renderNewChat = () => mount(
    <MessengerNewChat wsRef={{ current: null }} onBack={() => {}} onOpenRoom={() => {}} />,
  );

  it('이름 일부를 입력하면 오류 없이 이름에 그 글자가 든 사람만 남는다', async () => {
    await renderNewChat();
    expect(names('.MessengerNewChat__UserName')).toEqual(['alice', 'Bob', 'bobby']);

    await type(search(), 'bo');
    expect(names('.MessengerNewChat__UserName')).toEqual(['Bob', 'bobby']);

    await type(search(), 'ALI');
    expect(names('.MessengerNewChat__UserName')).toEqual(['alice']);
  });

  it('이름 아래에 늘 비어 있던 이메일 줄을 그리지 않는다', async () => {
    await renderNewChat();
    expect(document.querySelectorAll('.MessengerNewChat__UserItem')).toHaveLength(3);
    expect(document.querySelector('.MessengerNewChat__UserEmail')).toBeNull();
  });
});
