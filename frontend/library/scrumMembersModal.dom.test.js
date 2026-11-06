// @vitest-environment jsdom
//
// 멤버 창(ScrumMembersModal) 키보드 — 실제 ScrumMembersPanel·CustomSelect·DropdownPortal을 그대로 쓴다.
// 열면 닫기 버튼으로 포커스가 옮겨 가고, Tab·Shift+Tab은 창 안(열린 역할 목록 포함)에서만 돈다.
// 역할 목록이 열려 있으면 첫 Esc는 목록만 닫고 역할 선택 버튼으로, 다음 Esc는 창을 닫고 창을 연 버튼으로 돌아간다.
// 역할 목록은 document.body에 포털된다 — 창 DOM 밖에 있어도 Tab 순서·Esc 순서에 들어와야 한다.
// 역할을 고르면 목록이 사라져도 포커스는 역할 선택 버튼으로 돌아오고, 저장 응답·재조회가 그 흐름을 끊거나 빼앗지 않는다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ScrumMembersModal from '@/components/Scrum/ScrumMembersModal';
import { showToast } from '@/components/Layout/Toast';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }));

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal()),
  useTranslation: () => ({ t: (key, o) => (o ? `${key}${JSON.stringify(o)}` : key) }),
}));
vi.mock('next/router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/library/_axios', () => ({ axios: api, getBaseURL: () => '' }));
vi.mock('@/components/Layout/Toast', () => ({ showToast: vi.fn() }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// 관리자(나) + 멤버 한 명 — 멤버 칸에만 역할 선택과 빼기 버튼이 있다(관리자 칸은 마지막 관리자라 글자만)
const MEMBERS = [
  { user_id: 1, username: '관리자', email: 'admin@example.com', role: 'admin' },
  { user_id: 2, username: '이서연', email: 'seoyeon@example.com', role: 'member' },
];
// 이서연을 관리자로 바꾼 뒤의 재조회 응답 — 관리자가 둘이 되어 윗줄에도 역할 선택과 빼기 버튼이 생긴다
const PROMOTED = MEMBERS.map((m) => ({ ...m, role: 'admin' }));

let root;
let container;
let onClose;
let onChanged;

// 보드 머리의 '멤버' 버튼과 그 뒤쪽 보드 조작 요소를 흉내 낸다
function Harness() {
  const [open, setOpen] = useState(false);
  const [, refreshBoard] = useState(0);   // 멤버가 바뀌면 부모(보드)도 다시 그려진다
  return (
    <>
      <button type="button" className="Opener" onClick={() => setOpen(true)}>멤버</button>
      <button type="button" className="Behind">뒤쪽 보드</button>
      <input className="OverlayInput" aria-label="창 위에 뜬 다른 층(명령 팔레트 등)" />
      {open && (
        <ScrumMembersModal
          boardId={4}
          myRole="admin"
          count={MEMBERS.length}
          onClose={() => { onClose(); setOpen(false); }}
          onChanged={() => { onChanged(); refreshBoard((n) => n + 1); }}
        />
      )}
    </>
  );
}

const $ = (sel) => document.querySelector(sel);
const opener = () => $('.Opener');
const dialog = () => $('[role="dialog"]');
const closeBtn = () => $('.ScrumMembers__Close');
const inviteBtn = () => $('.ScrumMembers__InviteBtn');
const roleTrigger = () => $('.ScrumMembers__RoleSelect .CustomSelect__Trigger');
const removeBtn = () => $('.ScrumMembers__RemoveBtn');
const leaveBtn = () => $('.ScrumMembers__LeaveBtn');
const options = () => [...document.querySelectorAll('.CustomSelect__Option')];
const roleTriggerOf = (name) => $(`.CustomSelect__Trigger[aria-label*="${name}"]`);
const removeBtnOf = (name) => [...document.querySelectorAll('.ScrumMembers__Row')]
  .find((row) => row.textContent.includes(name)).querySelector('.ScrumMembers__RemoveBtn');

async function openModal() {
  opener().focus();
  act(() => { opener().click(); });
  await act(async () => {});   // 멤버 목록 조회(가짜 axios) 응답을 흘려보낸다
}

// 지금 포커스가 있는 요소에서 키를 누른다(jsdom은 Tab으로 포커스를 옮기지 않는다 — 옮겨졌다면 창이 옮긴 것)
function press(key, shiftKey = false) {
  const ev = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
  act(() => { (document.activeElement || document.body).dispatchEvent(ev); });
  return ev;
}

function openRoleList() {
  roleTrigger().focus();
  act(() => { roleTrigger().click(); });   // 버튼 위 Enter와 같은 동작
}

// 목록을 열고 Tab으로 '관리자' 항목까지 간 뒤 고른다 — jsdom은 Enter로 click을 만들지 않으므로 항목 위 Enter와 같은 click으로
function chooseAdminByKeyboard() {
  openRoleList();
  press('Tab');
  press('Tab');
  expect(document.activeElement).toBe(options()[1]);
  act(() => { options()[1].click(); });
}

// 저장 응답 → 멤버 재조회 → 부모 갱신까지 흘려보낸다
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

beforeEach(() => {
  sessionStorage.setItem('profile', JSON.stringify({ user_id: 1 }));
  api.get.mockResolvedValue({ data: { status: true, members: MEMBERS } });
  api.patch.mockResolvedValue({ data: { status: true } });
  onClose = vi.fn();
  onChanged = vi.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root.render(<Harness />); });
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
  sessionStorage.clear();
  vi.clearAllMocks();
});

describe('멤버 창 포커스', () => {
  it('열면 포커스가 뒤쪽 멤버 버튼에서 창 안 닫기 버튼으로 옮겨 간다', async () => {
    await openModal();
    expect(dialog()).not.toBeNull();
    expect(document.activeElement).toBe(closeBtn());
  });

  it('Tab은 창 안 조작 요소를 차례로 돌고 끝에서 처음으로, Shift+Tab은 처음에서 끝으로 — 뒤쪽 보드로 빠지지 않는다', async () => {
    await openModal();
    const cycle = [inviteBtn(), roleTrigger(), removeBtn(), leaveBtn(), closeBtn()];
    for (const next of cycle) {
      press('Tab');
      expect(document.activeElement).toBe(next);
    }
    press('Tab', true);
    expect(document.activeElement).toBe(leaveBtn());
    press('Tab', true);
    expect(document.activeElement).toBe(removeBtn());
  });

  it('포커스를 잃어도(창 안 빈 곳 클릭·사라진 버튼) Tab은 창의 처음으로, Shift+Tab은 끝으로 돌아온다', async () => {
    await openModal();
    act(() => { document.activeElement.blur(); });
    expect(document.activeElement).toBe(document.body);
    press('Tab');
    expect(document.activeElement).toBe(closeBtn());

    act(() => { document.activeElement.blur(); });
    press('Tab', true);
    expect(document.activeElement).toBe(leaveBtn());
  });

  it('창 위에 뜬 다른 층에 포커스가 있으면 그 층의 Tab을 가로채지 않는다', async () => {
    await openModal();
    $('.OverlayInput').focus();
    expect(press('Tab').defaultPrevented).toBe(false);
    expect(document.activeElement).toBe($('.OverlayInput'));
  });

  it('역할 목록이 열려 있으면 Tab은 역할 선택 바로 뒤 목록 항목으로 들어갔다가 다음 조작 요소로 이어진다', async () => {
    await openModal();
    openRoleList();
    expect(options().map((o) => o.textContent)).toEqual(['scrum.members.roleMember', 'scrum.members.roleAdmin']);
    expect(dialog().contains(options()[0])).toBe(false);   // 목록은 창 DOM 밖(body 포털)

    press('Tab');
    expect(document.activeElement).toBe(options()[0]);
    press('Tab');
    expect(document.activeElement).toBe(options()[1]);
    press('Tab');
    expect(document.activeElement).toBe(removeBtn());
    press('Tab', true);
    press('Tab', true);
    press('Tab', true);
    expect(document.activeElement).toBe(roleTrigger());
  });

  it('닫기 버튼으로 닫으면 창을 연 버튼으로 돌아가고, 다시 열어 Esc로 닫아도 한 번만 닫힌 뒤 같은 버튼으로 돌아간다', async () => {
    await openModal();
    act(() => { closeBtn().click(); });
    expect(dialog()).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(opener());

    await openModal();
    expect(document.activeElement).toBe(closeBtn());
    press('Escape');
    expect(dialog()).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(document.activeElement).toBe(opener());

    // 닫힌 뒤에는 창의 키 처리가 남지 않는다 — Tab을 가로채지 않고 Esc도 더 닫지 않는다
    expect(press('Tab').defaultPrevented).toBe(false);
    press('Escape');
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(document.activeElement).toBe(opener());
  });

  it('초대 검색 칸은 지금처럼 열자마자 포커스를 받는다', async () => {
    await openModal();
    act(() => { inviteBtn().click(); });
    expect(document.activeElement).toBe($('.ScrumMembers__SearchInput'));
  });
});

describe('멤버 창 Esc 순서', () => {
  it('역할 목록이 열려 있으면 첫 Esc는 목록만 닫고 역할 선택 버튼에 남고, 다음 Esc가 창을 닫는다', async () => {
    await openModal();
    openRoleList();
    expect(options()).toHaveLength(2);

    press('Escape');
    expect(options()).toHaveLength(0);
    expect(dialog()).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(roleTrigger());

    press('Escape');
    expect(dialog()).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(opener());
  });

  it('포커스가 목록 항목에 있을 때 Esc도 목록만 닫고 포커스를 역할 선택 버튼으로 돌린다', async () => {
    await openModal();
    openRoleList();
    press('Tab');
    expect(document.activeElement).toBe(options()[0]);

    press('Escape');
    expect(options()).toHaveLength(0);
    expect(dialog()).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(roleTrigger());
  });

  it('목록을 연 채 다음 조작 요소로 옮겨 갔어도 첫 Esc는 목록만 닫고 역할 선택 버튼으로 돌아간다', async () => {
    await openModal();
    openRoleList();
    press('Tab');
    press('Tab');
    press('Tab');
    expect(document.activeElement).toBe(removeBtn());
    expect(options()).toHaveLength(2);

    press('Escape');
    expect(options()).toHaveLength(0);
    expect(dialog()).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(roleTrigger());
  });
});

describe('역할을 고른 뒤 키보드 이동', () => {
  it('목록이 닫히면 포커스가 역할 선택 버튼으로 돌아오고 Tab·Shift+Tab이 그 버튼에서 이어진다', async () => {
    api.patch.mockReturnValue(new Promise(() => {}));   // 응답을 기다리는 동안에도 이어져야 한다
    await openModal();
    chooseAdminByKeyboard();
    expect(options()).toHaveLength(0);
    expect(document.activeElement).toBe(roleTrigger());

    press('Tab');
    expect(document.activeElement).toBe(removeBtn());
    press('Tab', true);
    expect(document.activeElement).toBe(roleTrigger());
    press('Tab', true);
    expect(document.activeElement).toBe(inviteBtn());
  });

  it('저장 뒤 멤버를 다시 불러오는 동안에도, 반영된 뒤에도 포커스가 역할 선택 버튼에 남아 이동이 이어진다', async () => {
    await openModal();
    let respondRefetch;
    api.get.mockReturnValue(new Promise((r) => { respondRefetch = r; }));
    chooseAdminByKeyboard();
    await settle();   // 저장 응답까지만 — 재조회는 응답을 기다린다

    expect(api.patch).toHaveBeenCalledTimes(1);
    expect(api.patch).toHaveBeenCalledWith('/scrum/4/members/2', { role: 'admin' });
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(document.activeElement).toBe(roleTrigger());

    act(() => { respondRefetch({ data: { status: true, members: PROMOTED } }); });
    await settle();
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(roleTriggerOf('이서연').textContent).toBe('scrum.members.roleAdmin');
    expect(document.activeElement).toBe(roleTriggerOf('이서연'));

    press('Tab');
    expect(document.activeElement).toBe(removeBtnOf('이서연'));
    press('Tab', true);
    expect(document.activeElement).toBe(roleTriggerOf('이서연'));
    press('Tab', true);
    expect(document.activeElement).toBe(removeBtnOf('관리자'));   // 재조회로 새로 생긴 윗줄 버튼
  });

  it('응답 전에 다른 버튼으로 옮겨 갔으면 늦은 응답이 포커스를 되돌리지 않는다', async () => {
    let respond;
    api.patch.mockReturnValue(new Promise((r) => { respond = r; }));
    await openModal();
    api.get.mockResolvedValue({ data: { status: true, members: PROMOTED } });
    chooseAdminByKeyboard();
    press('Tab');
    const moved = removeBtnOf('이서연');
    expect(document.activeElement).toBe(moved);

    act(() => { respond({ data: { status: true } }); });
    await settle();
    expect(roleTriggerOf('이서연').textContent).toBe('scrum.members.roleAdmin');
    expect(document.activeElement).toBe(moved);
  });

  it.each([
    ['실패 응답', () => api.patch.mockResolvedValue({ data: { status: false, code: 'LAST_ADMIN', message: 'LAST_ADMIN' } })],
    ['네트워크 오류', () => api.patch.mockRejectedValue(new Error('network'))],
  ])('%s에도 오류 안내를 띄우고 역할 값을 유지하며, 키보드로 계속 조작할 수 있다', async (_, fail) => {
    fail();
    await openModal();
    chooseAdminByKeyboard();
    await settle();

    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast.mock.calls[0][1]).toBe('error');
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(onChanged).not.toHaveBeenCalled();
    expect(roleTrigger().textContent).toBe('scrum.members.roleMember');
    expect(document.activeElement).toBe(roleTrigger());

    press('Tab');
    expect(document.activeElement).toBe(removeBtn());
    press('Tab', true);
    act(() => { roleTrigger().click(); });
    expect(options()).toHaveLength(2);
  });

  it('마우스로 골라도 값을 한 번만 저장하고 창은 그대로이며, 포커스는 역할 선택 버튼에 놓인다', async () => {
    await openModal();
    api.get.mockResolvedValue({ data: { status: true, members: PROMOTED } });
    act(() => { roleTrigger().click(); });
    act(() => { options()[1].click(); });
    await settle();

    expect(api.patch).toHaveBeenCalledTimes(1);
    expect(api.patch).toHaveBeenCalledWith('/scrum/4/members/2', { role: 'admin' });
    expect(options()).toHaveLength(0);
    expect(dialog()).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(roleTriggerOf('이서연'));
  });
});
