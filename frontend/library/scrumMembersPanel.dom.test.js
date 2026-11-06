// @vitest-environment jsdom
//
// 멤버 목록(ScrumMembersPanel) — 멤버 창과 보드 설정 '멤버' 탭이 같이 쓴다.
// 역할은 번역된 이름으로 보이고(원래 값 'admin' 그대로 쓰지 않음), 바꿀 수 없는 마지막 관리자 칸에는
// 관리자가 볼 때만 자물쇠가 붙는다. 초대 버튼은 열림 상태를 aria-expanded로 알리고,
// withHeader면 머리 줄(제목·인원·초대 버튼)을 그린다(설정 탭용).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import ScrumMembersPanel from '@/components/Scrum/ScrumMembersPanel';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }));

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal()),
  useTranslation: () => ({ t: (key, o) => (o ? `${key}${JSON.stringify(o)}` : key) }),
}));
vi.mock('next/router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/library/_axios', () => ({ axios: api, getBaseURL: () => '' }));
vi.mock('@/components/Layout/Toast', () => ({ showToast: vi.fn() }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const MEMBERS = [
  { user_id: 1, username: '관리자', email: 'admin@example.com', role: 'admin' },
  { user_id: 2, username: '이서연', email: 'seoyeon@example.com', role: 'member' },
];

let root;
let container;

async function renderPanel(props) {
  await act(async () => { root.render(<ScrumMembersPanel boardId={4} {...props} />); });
  await act(async () => {});   // 멤버 목록 조회(가짜 axios) 응답을 흘려보낸다
}
const rowOf = (name) => [...container.querySelectorAll('.ScrumMembers__Row')]
  .find((r) => r.querySelector('.ScrumMembers__NameText').textContent === name);

beforeEach(() => {
  api.get.mockResolvedValue({ data: { status: true, members: MEMBERS } });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
  sessionStorage.clear();
  vi.clearAllMocks();
});

describe('관리자가 볼 때', () => {
  beforeEach(() => { sessionStorage.setItem('profile', JSON.stringify({ user_id: 1 })); });

  it('마지막 관리자 칸은 자물쇠와 번역된 역할 이름, 다른 칸은 역할 선택', async () => {
    await renderPanel({ myRole: 'admin' });
    const me = rowOf('관리자');
    const role = me.querySelector('.ScrumMembers__RoleText');
    expect(role.textContent).toBe('scrum.members.roleAdmin');
    expect(role.querySelector('svg')).not.toBeNull();
    expect(role.getAttribute('title')).toBe('scrum.members.lastAdminRoleLocked');
    expect(me.querySelector('.ScrumMembers__You').textContent).toBe('scrum.you');

    const other = rowOf('이서연');
    expect(other.querySelector('.ScrumMembers__RoleSelect')).not.toBeNull();
    expect(other.querySelector('.CustomSelect__Trigger').getAttribute('aria-label'))
      .toBe('scrum.members.roleAria{"name":"이서연"}');
  });

  it('초대 버튼은 누르면 열림 상태(aria-expanded — 눌린 모양도 이걸로 칠한다)와 검색 칸을 보인다', async () => {
    await renderPanel({ myRole: 'admin' });
    const invite = container.querySelector('.ScrumMembers__InviteBtn');
    expect(invite.getAttribute('aria-expanded')).toBe('false');
    act(() => { invite.click(); });
    expect(invite.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('.ScrumMembers__SearchInput')).not.toBeNull();
  });

  it('withHeader면 머리 줄에 제목·인원·초대 버튼을 그린다(설정 탭)', async () => {
    await renderPanel({ myRole: 'admin', withHeader: true });
    const head = container.querySelector('.ScrumMembers__PanelHead');
    expect(head.querySelector('.ScrumMembers__PanelTitle').textContent).toBe('scrum.members.title2');
    expect(head.querySelector('.ScrumMembers__InviteBtn')).not.toBeNull();
  });
});

describe('멤버가 볼 때', () => {
  beforeEach(() => { sessionStorage.setItem('profile', JSON.stringify({ user_id: 2 })); });

  it('초대 버튼이 없고, 역할은 자물쇠 없이 번역된 이름만 보인다', async () => {
    await renderPanel({ myRole: 'member' });
    expect(container.querySelector('.ScrumMembers__InviteBtn')).toBeNull();
    const admin = rowOf('관리자').querySelector('.ScrumMembers__RoleText');
    expect(admin.textContent).toBe('scrum.members.roleAdmin');
    expect(admin.querySelector('svg')).toBeNull();
    expect(rowOf('이서연').querySelector('.ScrumMembers__RoleText').textContent).toBe('scrum.members.roleMember');
  });
});
