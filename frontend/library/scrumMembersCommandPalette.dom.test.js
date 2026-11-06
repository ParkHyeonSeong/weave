// @vitest-environment jsdom
//
// 멤버 창 위에 뜬 ⌘K 검색창 — 실제 ScrumMembersModal·ScrumMembersPanel·CommandPalette를 함께 렌더한다.
// 검색창의 Esc는 검색창만 닫고 포커스는 열기 전 버튼으로 돌아오며, 다음 Esc가 멤버 창을 닫는다.
// 검색창은 React(루트) 리스너로, 멤버 창은 window 리스너로 키를 듣는다. 실제 브라우저는 그 사이에 React가 커밋해
// window에 닿을 때 검색창이 이미 없다 — dispatchEvent로는 이 순서가 안 나와서 첫 테스트가 직접 만든다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('@/library/_axios', () => ({
  axios: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  getBaseURL: () => '',
}));
vi.mock('next/router', () => ({ useRouter: () => ({ push }) }));
import { axios } from '@/library/_axios';
import i18next from '@/library/i18n';
import CommandPalette from '@/components/modal/CommandPalette';
import ScrumMembersModal from '@/components/Scrum/ScrumMembersModal';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const MEMBERS = [
  { user_id: 1, username: '관리자', email: 'admin@example.com', role: 'admin' },
  { user_id: 2, username: '이서연', email: 'seoyeon@example.com', role: 'member' },
];

let root;
let container;
let onMembersClose;
let onPaletteClose;

// 보드의 멤버 버튼과 Layout의 검색창 연결(입력 칸 밖 Cmd/Ctrl+K)만 흉내 낸다
function Board() {
  const [showMembers, setShowMembers] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  useEffect(() => {
    const h = (e) => {
      if (e.target.tagName === 'INPUT') return;
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowPalette((prev) => !prev);
      }
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, []);
  return (
    <>
      <button type="button" className="MembersBtn" onClick={() => setShowMembers(true)}>멤버</button>
      {showMembers && (
        <ScrumMembersModal
          boardId={4}
          myRole="admin"
          count={MEMBERS.length}
          onClose={() => { onMembersClose(); setShowMembers(false); }}
        />
      )}
      {showPalette && <CommandPalette onClose={() => { onPaletteClose(); setShowPalette(false); }} />}
    </>
  );
}

const $ = (sel) => document.querySelector(sel);
const membersBtn = () => $('.MembersBtn');
const dialog = () => $('[role="dialog"]');
const closeBtn = () => $('.ScrumMembers__Close');
const inviteBtn = () => $('.ScrumMembers__InviteBtn');
const roleTrigger = () => $('.ScrumMembers__RoleSelect .CustomSelect__Trigger');
const removeBtn = () => $('.ScrumMembers__RemoveBtn');
const palette = () => $('.CommandPalette');
const paletteInput = () => $('.CommandPalette__Input');

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

function press(key, init = {}) {
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  act(() => { (document.activeElement || document.body).dispatchEvent(ev); });
  return ev;
}

async function openMembers() {
  membersBtn().focus();
  act(() => { membersBtn().click(); });
  await flush();
  expect(document.activeElement).toBe(closeBtn());
}

async function openPalette() {
  press('k', { metaKey: true });
  await flush();
  expect(document.activeElement).toBe(paletteInput());
}

async function type(value) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(paletteInput(), value);
    paletteInput().dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  sessionStorage.setItem('profile', JSON.stringify({ user_id: 1, role: 'member' }));
  axios.get.mockImplementation((url) => {
    if (url === '/scrum/4/members') return Promise.resolve({ data: { status: true, members: MEMBERS } });
    return Promise.resolve({ data: { status: true, items: [] } });
  });
  onMembersClose = vi.fn();
  onPaletteClose = vi.fn();
  // jsdom에는 scrollIntoView가 없다 (활성 항목 스크롤 effect가 부른다)
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
  await i18next.changeLanguage('en');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<Board />); });
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
  sessionStorage.clear();
});

describe('멤버 창 위 검색창의 Esc 순서', () => {
  it('첫 Esc는 검색창만 닫고 열기 전 버튼으로 돌아와 Tab이 이어지고, 다음 Esc가 멤버 창을 닫는다', async () => {
    await openMembers();
    press('Tab');
    press('Tab');
    expect(document.activeElement).toBe(roleTrigger());
    await openPalette();

    // 실제 브라우저처럼 window 리스너보다 먼저 커밋시킨다(리스너 사이 마이크로태스크 대신 flushSync)
    let paletteBeforeWindow;
    const commit = () => { flushSync(() => {}); paletteBeforeWindow = palette(); };
    document.addEventListener('keydown', commit);
    press('Escape');
    document.removeEventListener('keydown', commit);
    expect(paletteBeforeWindow).toBeNull();

    expect(onPaletteClose).toHaveBeenCalledTimes(1);
    expect(dialog()).not.toBeNull();
    expect(onMembersClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(roleTrigger());

    press('Tab');
    expect(document.activeElement).toBe(removeBtn());

    press('Escape');
    expect(dialog()).toBeNull();
    expect(onMembersClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(membersBtn());
  });

  it('검색창이 열린 동안 Tab은 검색창 몫이다 — 멤버 창이 가로채거나 포커스를 끌어오지 않는다', async () => {
    await openMembers();
    await openPalette();
    expect(press('Tab').defaultPrevented).toBe(false);
    expect(press('Tab', { shiftKey: true }).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(paletteInput());
  });

  it('열고 닫기를 반복해도 Esc는 한 층씩만 닫고, 멤버 창이 닫힌 뒤에는 키 처리가 남지 않는다', async () => {
    await openMembers();
    for (let n = 1; n <= 3; n += 1) {
      await openPalette();
      press('Escape');
      expect(onPaletteClose).toHaveBeenCalledTimes(n);
      expect(onMembersClose).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(closeBtn());
    }

    press('Escape');
    expect(onMembersClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(membersBtn());
    press('Escape');
    expect(onMembersClose).toHaveBeenCalledTimes(1);
    expect(onPaletteClose).toHaveBeenCalledTimes(3);
  });

  it('한글 조합 중 Esc는 검색창도 멤버 창도 닫지 않고, 조합이 끝난 뒤 Esc는 검색창만 닫는다', async () => {
    await openMembers();
    press('Tab');
    await openPalette();

    press('Escape', { isComposing: true });
    expect(palette()).not.toBeNull();
    expect(dialog()).not.toBeNull();
    expect(onMembersClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(paletteInput());

    press('Escape');
    expect(palette()).toBeNull();
    expect(dialog()).not.toBeNull();
    expect(onMembersClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(inviteBtn());
  });

  it('검색해 고른 항목을 Enter로 실행하면 열기 전 버튼으로 포커스를 돌리지 않는다', async () => {
    await openMembers();
    press('Tab');
    await openPalette();
    await type('profile');

    press('Enter');
    expect(push).toHaveBeenCalledWith('/profile');
    expect(palette()).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });
});

describe('검색창 단독 사용', () => {
  it('Esc는 검색창을 닫을 뿐 포커스를 옮기지 않는다 — 복귀는 뒤에 멤버 창이 있을 때만이다', async () => {
    membersBtn().focus();
    await openPalette();
    press('Escape');
    expect(palette()).toBeNull();
    expect(onPaletteClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(document.body);
  });
});
